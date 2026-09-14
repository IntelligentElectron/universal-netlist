/**
 * Altium Schematic Parser
 *
 * Parses Altium Designer .SchDoc files into the unified ParsedNetlist format.
 * Port of the Python Altium-Schematic-Parser library:
 * https://github.com/a3ng7n/Altium-Schematic-Parser
 *
 * Supports output formats:
 * - all-list: All records in a flattened list
 * - all-hierarchy: All records in owner/child hierarchy
 * - parts-list: Components/parts only
 * - net-list: Nets with connected devices
 */

import path from "path";
import type {
  ParsedNetlist,
  NetConnections,
  ComponentDetails,
  PinEntry,
  ParseDesignOptions,
} from "../../types.js";
import { createPinEntry } from "../../types.js";
import { isDnsComponent, hasDnsValueMarker, stripDnsMarkers } from "../../circuit-traversal.js";
import type { AltiumSchematic, AltiumNet, AltiumRecord, OutputFormat } from "./types.js";
import {
  RECORD_TYPES,
  RECORD_TYPE_NAMES,
  PIN_ELECTRICAL_TYPES,
  POWER_PORT_STYLES,
  identifierKey,
} from "./types.js";
import { OleReader, readOleStream, readOptionalOleStream } from "../ole-reader/ole-reader.js";
import { parseRecords, findRecords } from "./record-parser.js";
import { buildHierarchy, getPartsList, flattenHierarchy, findRecordByIndex } from "./hierarchy.js";
import {
  extractNets,
  determineNetList,
  classifyNets,
  isSignalSheetEntry,
  nameRanks,
  NAME_FROM_ANY,
} from "./net-extractor.js";
import type { NetNamingOptions, NetNameSource } from "./net-extractor.js";
import { isBusIdentifier, repeatBaseName } from "./bus.js";
import { duplicateInstanceIndices, pinBelongsToInstance } from "./part-pins.js";
import {
  readHarnessConnectors,
  assignHarnessSignals,
  harnessSignalKey,
  splitHarnessSignalKey,
  portBundle,
  parseHarnessDefinitions,
  resolveHarnessMembers,
  collectNestedHarnessTypes,
} from "./harness.js";
import type { HarnessDefinitions } from "./harness.js";
import {
  parseProjectOptions,
  resolveNetIdentifierScope,
  powerPortsAreGlobal,
} from "./project-options.js";
import type { AltiumProjectOptions, DesignShape, NetIdentifierScope } from "./project-options.js";
import { planLocalNetRenames, applyNetRenames, noNetIdentifiers } from "./net-scoping.js";
import type { NetIdentifierKinds } from "./net-scoping.js";
import {
  applyAltiumVariant,
  listAltiumVariants,
  parseAltiumProjectVariants,
} from "./project-variants.js";

// Re-export types and utilities for external use
export type { AltiumSchematic, AltiumNet, AltiumRecord, OutputFormat };
export { RECORD_TYPES, RECORD_TYPE_NAMES, PIN_ELECTRICAL_TYPES, POWER_PORT_STYLES };
export { OleReader };
export { parseRecords, findRecords };
export { buildHierarchy, getPartsList, flattenHierarchy };
export { extractNets, determineNetList };

/** OLE stream holding signal harness objects, absent unless the sheet uses harnesses. */
const ALTIUM_ADDITIONAL_STREAM = "Additional";

// Re-export schemas for validation
export * from "./schemas.js";

/**
 * Get component designator from a pin's parent.
 */
const getDesignatorFromPin = (pin: AltiumRecord, schematic: AltiumSchematic): string | null => {
  // Look up the parent component using OwnerIndex
  const ownerIndexValue = pin.OwnerIndex ?? pin.OWNERINDEX;
  if (ownerIndexValue !== undefined && ownerIndexValue !== null && ownerIndexValue !== "") {
    const ownerIndex = parseInt(String(ownerIndexValue), 10);
    const parent = findRecordByIndex(schematic, ownerIndex);

    if (parent?.children) {
      // Find the designator child (RECORD=34 with Text field)
      const designatorChild = parent.children.find((c) => c.RECORD === RECORD_TYPES.DESIGNATOR);
      const designatorText =
        designatorChild?.Text ??
        designatorChild?.TEXT ??
        designatorChild?.Name ??
        designatorChild?.NAME;
      if (designatorText !== undefined && designatorText !== null && designatorText !== "") {
        return String(designatorText);
      }
    }
  }

  return null;
};

/**
 * Get pin number from a pin record.
 *
 * Altium uses camelCase: Designator is the pin number (1, 2, 3...)
 * and Name is the pin function (VBAT, VCC, GND...)
 */
const getPinNumber = (pin: AltiumRecord): string | null => {
  // Try Designator first (pin number)
  if (pin.Designator !== undefined && pin.Designator !== null && pin.Designator !== "") {
    return String(pin.Designator);
  }
  if (pin.DESIGNATOR !== undefined && pin.DESIGNATOR !== null && pin.DESIGNATOR !== "") {
    return String(pin.DESIGNATOR);
  }
  // Fallback to Name (pin function name)
  if (pin.Name !== undefined && pin.Name !== null && pin.Name !== "") {
    return String(pin.Name);
  }
  if (pin.NAME !== undefined && pin.NAME !== null && pin.NAME !== "") {
    return String(pin.NAME);
  }

  return null;
};

/**
 * Convert Altium nets to ParsedNetlist NetConnections format.
 *
 * Transform: AltiumNet[] -> { netName: { refdes: [pinNumbers] } }
 */
const convertNets = (nets: AltiumNet[], schematic: AltiumSchematic): NetConnections => {
  const result: NetConnections = {};
  let unnamedNetCounter = 1;

  for (const net of nets) {
    const pinDevices = net.devices.filter((device) => device.RECORD === RECORD_TYPES.PIN);
    const hasNonPinDevices = net.devices.some((device) => device.RECORD !== RECORD_TYPES.PIN);

    if (pinDevices.length === 1 && !hasNonPinDevices) {
      continue;
    }

    // Generate name if not assigned
    const netName = net.name ?? `UnnamedNet${unnamedNetCounter++}`;

    // Group pins by their component (refdes)
    const pinsByComponent: Record<string, string[]> = {};

    for (const device of net.devices) {
      if (device.RECORD === RECORD_TYPES.PIN) {
        // Find the component refdes from parent
        const designator = getDesignatorFromPin(device, schematic);
        const pinNumber = getPinNumber(device);

        if (designator && pinNumber) {
          if (!pinsByComponent[designator]) {
            pinsByComponent[designator] = [];
          }
          if (!pinsByComponent[designator].includes(pinNumber)) {
            pinsByComponent[designator].push(pinNumber);
          }
        }
      }
    }

    // Only add net if it has pin connections
    if (Object.keys(pinsByComponent).length === 0) continue;

    // Two connected groups can end up under one name — a harness member named
    // by its entry alongside a net label of the same text, say. They are one
    // net, so fold them together instead of letting the later one replace the
    // earlier and drop its pins.
    const existing = result[netName];
    if (!existing) {
      result[netName] = pinsByComponent;
      continue;
    }
    for (const [refdes, pins] of Object.entries(pinsByComponent)) {
      existing[refdes] = [...new Set([...(existing[refdes] ?? []), ...pins])];
    }
  }

  return result;
};

/**
 * Populate component pin-to-net mappings from the nets data.
 *
 * The nets structure is: { netName: { refdes: [pinNumbers] } }
 * We need to reverse this to populate: components[refdes].pins[pin] = netName
 */
const populatePinNets = (components: ComponentDetails, nets: NetConnections): void => {
  for (const [netName, connections] of Object.entries(nets)) {
    for (const [refdes, pins] of Object.entries(connections)) {
      const component = components[refdes];
      if (!component) {
        continue;
      }

      for (const pin of pins) {
        const entry = component.pins[pin];
        if (entry === undefined) {
          component.pins[pin] = netName;
        } else if (typeof entry === "string") {
          if (entry === "") component.pins[pin] = netName;
        } else if (entry.net === "") {
          entry.net = netName;
        }
      }
    }
  }
};

/**
 * Fold one component record into another that carries the same designator:
 * the union of their pins, the first record's entry where both declare a pin,
 * and the first record's fields with gaps filled from the second.
 */
const mergeComponentInto = (
  target: ComponentDetails[string],
  source: ComponentDetails[string]
): void => {
  for (const [pin, entry] of Object.entries(source.pins)) {
    if (target.pins[pin] === undefined) target.pins[pin] = entry;
  }
  for (const field of [
    "mpn",
    "internal_pn",
    "manufacturer",
    "description",
    "comment",
    "value",
  ] as const) {
    if (target[field] === undefined && source[field] !== undefined) target[field] = source[field];
  }
  if (source.dns && !target.dns) target.dns = true;
};

const pinNet = (entry: PinEntry): string => (typeof entry === "string" ? entry : entry.net);

/**
 * Make `nets` and `components` exact inverses, with `components` as the
 * authority on where a pin is.
 *
 * Each document's two indices agree when it is parsed, and merging documents
 * keeps the first reading of a pin (see `mergeResult`). What can still disagree
 * is a later document's net listing a pin the first document already placed:
 * the same designator on two sheets, which is a duplicate designator unless the
 * part ids differ. Such a listing is removed here, a net left with no pins is
 * dropped, and a pin a component places on a net that does not list it is
 * added. The result passes the Universal Netlist reader's inverse check.
 */
const reconcileNetlist = ({ nets, components }: ParsedNetlist): void => {
  for (const [netName, connections] of Object.entries(nets)) {
    for (const [refdes, pins] of Object.entries(connections)) {
      const component = components[refdes];
      if (!component) {
        delete connections[refdes];
        continue;
      }
      const kept = pins.filter((pin) => {
        const entry = component.pins[pin];
        if (entry === undefined) {
          component.pins[pin] = netName;
          return true;
        }
        return pinNet(entry) === netName;
      });
      if (kept.length > 0) connections[refdes] = kept;
      else delete connections[refdes];
    }
    if (Object.keys(connections).length === 0) delete nets[netName];
  }

  for (const [refdes, component] of Object.entries(components)) {
    for (const [pin, entry] of Object.entries(component.pins)) {
      const netName = pinNet(entry);
      if (netName === "") continue;
      const connections = (nets[netName] ??= {});
      const listed = (connections[refdes] ??= []);
      if (!listed.includes(pin)) listed.push(pin);
    }
  }
};

const resolveComment = (
  comment: string | undefined,
  parameters: Record<string, string>
): string | undefined => {
  if (!comment) {
    return undefined;
  }

  const trimmed = comment.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("=")) {
    const reference = trimmed.slice(1).trim();
    if (!reference) {
      return undefined;
    }

    const resolved = parameters[reference.toLowerCase()];
    if (resolved && resolved.trim()) {
      return resolved.trim();
    }

    return undefined;
  }

  return trimmed;
};

const getPinName = (pin: AltiumRecord): string | undefined => {
  const name = pin.Name ?? pin.NAME;
  if (name !== undefined && name !== null && name !== "") {
    return String(name);
  }
  return undefined;
};

/**
 * Extract component details from a hierarchical schematic.
 */
export const extractComponents = (schematic: AltiumSchematic): ComponentDetails => {
  const components: ComponentDetails = {};

  // Get all parts (RECORD=1)
  const parts = getPartsList(schematic);
  const duplicates = duplicateInstanceIndices(schematic);

  for (const part of parts) {
    // A second instance of the same designator and part is a duplicate
    // designator; the first instance is the part (see part-pins.ts).
    if (duplicates.has(part.index)) continue;

    // Designator is in a child record with RECORD=34 and Text field
    let refdes: string | undefined;
    if (part.children) {
      const designatorChild = part.children.find((c) => c.RECORD === RECORD_TYPES.DESIGNATOR);
      const designatorText =
        designatorChild?.Text ??
        designatorChild?.TEXT ??
        designatorChild?.Name ??
        designatorChild?.NAME;
      if (designatorText !== undefined && designatorText !== null && designatorText !== "") {
        refdes = String(designatorText);
      }
    }
    if (!refdes) continue;

    // Extract component properties from child RECORD=41 (parameter) records
    // Altium stores MPN in a parameter child with Name="Manufacturer Part Number"
    let mpn: string | undefined;
    let comment: string | undefined;
    const parameters: Record<string, string> = {};

    if (part.children) {
      for (const child of part.children) {
        if (child.RECORD === RECORD_TYPES.PARAMETER) {
          const nameValue = child.Name ?? child.NAME;
          const textValue = child.Text ?? child.TEXT;

          if (
            nameValue === undefined ||
            nameValue === null ||
            nameValue === "" ||
            textValue === undefined ||
            textValue === null ||
            textValue === ""
          ) {
            continue;
          }

          const name = String(nameValue).trim();
          const text = String(textValue).trim();

          if (name) {
            parameters[name.toLowerCase()] = text;
          }

          if (name === "Manufacturer Part Number") {
            mpn = text;
          } else if (name === "Comment") {
            comment = text;
          }
        }
      }
    }

    comment = resolveComment(comment, parameters);
    // An MPN identifies a part only within a manufacturer, so the name is what
    // makes `mpn` a key rather than a string.
    const manufacturer = parameters["manufacturer"]?.trim() || undefined;
    const rawValue = parameters["value"];
    const value = rawValue?.trim() || undefined;
    if (comment && value && comment === value) {
      comment = undefined;
    }

    // Fallback MPN sources from component-level fields
    // Note: LibReference is NOT an MPN - it's a library symbol reference (e.g., "22u" or a hash)
    if (!mpn) {
      mpn =
        (part.PartNumber as string) ||
        (part.Mpn as string) ||
        (part.PARTNUMBER as string) ||
        (part["MPN"] as string) ||
        undefined;
    }

    // Description from component record or parameters (try both camelCase and UPPERCASE variants)
    const extractedDescription =
      (part.ComponentDescription as string) ||
      (part.Description as string) ||
      // Legacy UPPERCASE fallbacks
      (part.DESCRIPTION as string) ||
      undefined;

    // Build pin mapping from children
    const pins: Record<string, PinEntry> = {};

    if (part.children) {
      for (const child of part.children) {
        if (child.RECORD === RECORD_TYPES.PIN) {
          if (!pinBelongsToInstance(child, part)) {
            continue;
          }
          const pinNum = getPinNumber(child);
          const pinName = getPinName(child);
          if (pinNum) {
            // Initialize with empty string or name placeholder; will be populated by populatePinNets()
            pins[pinNum] = createPinEntry(pinNum, pinName, "");
          }
        }
      }
    }

    const component: ComponentDetails[string] = {
      pins,
    };

    if (mpn !== undefined) {
      component.mpn = mpn;
    }

    if (manufacturer !== undefined) {
      component.manufacturer = manufacturer;
    }

    if (extractedDescription !== undefined) {
      component.description = extractedDescription;
    }

    if (comment !== undefined) {
      component.comment = comment;
    }

    if (value !== undefined) {
      component.value = value;
    }

    // Check assembly info parameter for NF/DNS markers (Altium stores these as RECORD=41 parameters)
    const assemblyInfo = parameters["assembly info"];
    // Altium designs conventionally write the marker into Value — a resistor
    // reading `DNP` and nothing else — so that field is read too, against the
    // marker set that leaves out the token a value writes as a unit.
    if (
      isDnsComponent({
        ...component,
        comment: [component.comment, assemblyInfo].filter(Boolean).join(" "),
      }) ||
      hasDnsValueMarker(component.value ?? "")
    ) {
      component.dns = true;
      if (component.mpn) component.mpn = stripDnsMarkers(component.mpn);
      if (component.value) component.value = stripDnsMarkers(component.value);
      if (component.description) component.description = stripDnsMarkers(component.description);
    }

    // A multi-part component is drawn as one instance per part, each with its
    // own pins and the same designator: one component, the union of its pins.
    const existing = components[refdes];
    if (existing) mergeComponentInto(existing, component);
    else components[refdes] = component;
  }

  return components;
};

/**
 * Parse a schematic's records from every stream that carries them.
 *
 * Most objects live in `FileHeader`, but signal harness objects (records
 * 215-218) are written to a separate `Additional` stream. A document parsed from
 * `FileHeader` alone has no harness connectors, entries or types in it at all, so
 * any net reaching a harness simply ends there.
 *
 * The two streams number their records independently, and `buildHierarchy`
 * renumbers the concatenation by position, so an `OwnerIndex` written in the
 * `Additional` stream is shifted by the number of `FileHeader` records to keep
 * pointing at the record it names.
 */
export const readSchematicRecords = (
  schdocPath: string,
  headerBuffer: Buffer
): AltiumSchematic & { bundleLinks?: string[][] } => {
  const schematic = parseRecords(headerBuffer);

  const additional = readOptionalOleStream(schdocPath, ALTIUM_ADDITIONAL_STREAM);
  if (!additional || additional.length === 0) return schematic;

  const extra = parseRecords(additional);
  if (extra.records.length === 0) return schematic;

  const connectors = readHarnessConnectors(extra.records as never);
  const bundleLinks = assignHarnessSignals(connectors, {
    records: schematic.records as never,
    buses: extra.records.filter((record) => record.RECORD === RECORD_TYPES.SIGNAL_HARNESS) as never,
  });

  const ownerOffset = schematic.records.length;
  for (const record of extra.records) {
    const owner = record.OwnerIndex ?? record.OWNERINDEX;
    if (owner === undefined || owner === null || owner === "") continue;
    const ownerIndex = parseInt(String(owner), 10);
    if (!Number.isFinite(ownerIndex)) continue;
    record.OwnerIndex = String(ownerOffset + ownerIndex);
    delete record.OWNERINDEX;
  }

  return {
    header: schematic.header,
    records: [...schematic.records, ...extra.records],
    bundleLinks,
  };
};

/**
 * One net's claims to be the same net as a net on another sheet.
 *
 * Keys are `<kind>|<fields>`:
 *
 * - `port|<name>`: what a port asserts under Flat and Global scope, where
 *   ports join by name across the project.
 * - `hier|<instance>|<name>`: what a port on a document instance asserts about the
 *   sheet symbol channel that placed it (see DocumentInstance.key), and what a sheet
 *   entry of that name on the symbol asserts about it. This pair is how a signal
 *   crosses a sheet boundary under every scope, and the only way under
 *   Hierarchical scope. A plain symbol has the one channel `1`; a `Repeat()`
 *   symbol has one per channel index, which a `Repeat(NAME)` entry's bus member
 *   `NAME<index>` addresses and a plain entry reaches all of.
 * - `entry|<parent instance>|<parent document>|<symbol index>|<name>|<channel index>`:
 *   an entry as written, resolved to the `hier` form once the symbol's channels
 *   are known.
 * - `power|<name>`: a power port, which is one net across the project unless
 *   the scope makes power ports local.
 * - `harness|<bundle signal key>`: a bus member reaching a range identifier
 *   that is a harness entry or a harness-typed port, matched the way harness
 *   signals are.
 *
 * A net that carries no pins, a wire drawn from one sheet entry to another,
 * still links the two and may still name the result.
 */
export interface NetLinkGroup {
  /** The net's name in the sheet's netlist, absent when it carries no pins. */
  net?: string;
  /**
   * The name a pinless net was given by a sheet entry or a label, which the
   * nets it links may take: a wire between two entries carries no pins but
   * still names the net when entries may name nets.
   */
  name?: string;
  keys: string[];
}

interface ParsedDocument {
  /** Lower-case file name, which is how sheet symbols refer to it. */
  name: string;
  /** What this document's ports claim about: the channel that placed it, or its own name. */
  placement: string;
  hierarchical: AltiumSchematic;
  netlist: ParsedNetlist;
  /** The nets as extracted, which channel expansion reads for naming. */
  nets: AltiumNet[];
  /** Cross-sheet identity claims, one group per net on this sheet. */
  links: NetLinkGroup[];
  /** Harness signal key, bundle identity and member, -> the net carrying it on this sheet. */
  harnessSignals: Map<string, string>;
  /** Where each net's name came from, keyed by the name. */
  nameSources: Map<string, NetNameSource>;
  /** Bundle identities this sheet joins, each group being one bundle. */
  bundleLinks: string[][];
  /** Which kinds of net identifier each of this sheet's nets carries. */
  netIdentifiers: Map<string, NetIdentifierKinds>;
  /** The sheet's `SheetNumber` document parameter, when it carries one. */
  sheetNumber?: string;
  /** The sheet draws sheet entries, i.e. it is a parent in a hierarchy. */
  hasSheetEntries: boolean;
  /** The sheet draws ports. */
  hasPorts: boolean;
}

/** A document's records, read once and shared by every pass that needs them. */
interface ReadDocument {
  path: string;
  /** Lower-case file name, which is how sheet symbols refer to it. */
  name: string;
  bundleLinks: string[][];
  hierarchical: AltiumSchematic;
}

const readDocument = (schdocPath: string): ReadDocument => {
  const schematic = readSchematicRecords(schdocPath, readOleStream(schdocPath));
  return {
    path: schdocPath,
    name: path.basename(schdocPath).toLowerCase(),
    bundleLinks: schematic.bundleLinks ?? [],
    hierarchical: buildHierarchy(schematic),
  };
};

/**
 * The sheet's `SheetNumber`, which Altium appends to local net names.
 *
 * It is a document parameter, so it hangs off the sheet record rather than off
 * any component. A project that has never been through Tools » Annotation »
 * Number Schematic Sheets has none, and Altium leaves such a sheet's local
 * nets unsuffixed.
 */
export const readSheetNumber = (schematic: AltiumSchematic): string | undefined => {
  // Document scope only. A component's properties are parameter records too, so
  // walking the whole tree would let a part carrying its own `SheetNumber`
  // parameter stand in for the sheet's. Which records count as document scope
  // varies with how the file was written: the parameters sit at the root of the
  // hierarchy, or hang off the SHEET record that carries the document's own
  // settings, so both are read and nothing deeper is.
  const documentScoped: AltiumRecord[] = [];
  for (const record of schematic.records) {
    documentScoped.push(record);
    if (record.RECORD === RECORD_TYPES.SHEET && record.children) {
      documentScoped.push(...record.children);
    }
  }

  for (const record of documentScoped) {
    if (record.RECORD !== RECORD_TYPES.PARAMETER) continue;
    const name = record.Name ?? record.NAME;
    if (name === undefined || name === null || String(name).toLowerCase() !== "sheetnumber") {
      continue;
    }
    const value = record.Text ?? record.TEXT;
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const trimmed = String(value).trim();
    // An unnumbered sheet carries the literal `*` placeholder rather than a
    // number, and suffixing every sheet with it would merge them right back.
    if (!/^\d+$/.test(trimmed)) continue;
    return trimmed;
  }
  return undefined;
};

/**
 * What a sheet is drawn with, which is what an Automatic scope reads to decide
 * how the project's sheets connect.
 */
const readDesignShape = (schematic: AltiumSchematic): DesignShape => {
  let hasSheetEntries = false;
  let hasPorts = false;
  for (const record of flattenHierarchy(schematic)) {
    if (record.RECORD === RECORD_TYPES.SHEET_ENTRY) hasSheetEntries = true;
    else if (record.RECORD === RECORD_TYPES.PORT) hasPorts = true;
  }
  return { hasSheetEntries, hasPorts };
};

/** Record, per net name, which identifier kinds the sheet draws on it. */
const collectNetIdentifiers = (nets: AltiumNet[]): Map<string, NetIdentifierKinds> => {
  const identifiers = new Map<string, NetIdentifierKinds>();

  for (const net of nets) {
    // A named net is recorded even when it carried no pins of its own and so
    // never reached the netlist. A signal labelled on a parent sheet and wired
    // straight into a sheet entry looks exactly like that: the pins are on the
    // child sheet, but the name, and the sheet it belongs to, are here.
    if (!net.name) continue;
    const kinds = identifiers.get(net.name) ?? noNetIdentifiers();
    for (const device of net.devices) {
      if (device.RECORD === RECORD_TYPES.PORT) {
        kinds.port = true;
      } else if (device.RECORD === RECORD_TYPES.SHEET_ENTRY) {
        kinds.entry = true;
      } else if (device.RECORD === RECORD_TYPES.POWER_PORT) {
        kinds.powerPort = true;
      } else if (device.RECORD === RECORD_TYPES.NET_LABEL) {
        kinds.label = true;
      } else if (device.RECORD === RECORD_TYPES.HARNESS_ENTRY) {
        // The bundle this entry belongs to is matched across sheets by signal
        // key, so the net it names is not confined to this one.
        kinds.harness = true;
      }
    }
    if (net.nameSource === "harness") kinds.harness = true;
    // A bus member leaves the sheet through whatever range identifier its bus
    // reaches, just as a plain wire leaves through a port.
    for (const { device } of net.busCarriers ?? []) {
      if (device.RECORD === RECORD_TYPES.HARNESS_ENTRY || device.HarnessType) kinds.harness = true;
      else if (device.RECORD === RECORD_TYPES.PORT) kinds.port = true;
      else if (device.RECORD === RECORD_TYPES.SHEET_ENTRY) kinds.entry = true;
    }
    identifiers.set(net.name, kinds);
  }

  return identifiers;
};

/**
 * Collect, for each harness signal drawn on a sheet, the net that carries it.
 *
 * Only nets that survived into the netlist are reported: a signal whose net has
 * no pins on this sheet connects nothing here.
 */
const collectHarnessSignals = (
  nets: AltiumNet[],
  parsedNets: NetConnections
): Map<string, string> => {
  const signals = new Map<string, string>();

  for (const net of nets) {
    if (!net.name || !parsedNets[net.name]) continue;
    for (const device of net.devices) {
      if (device.RECORD !== RECORD_TYPES.HARNESS_ENTRY) continue;
      const signal = device.harnessSignal;
      if (typeof signal === "string" && signal && !signals.has(signal)) {
        signals.set(signal, net.name);
      }
    }
  }

  return signals;
};

/**
 * The document a sheet symbol instantiates, as its file name in lower case.
 */
const sheetSymbolChild = (symbol: AltiumRecord | undefined): string | undefined => {
  const children = symbol?.children ?? [];
  const fileName = recordText(children.find((c) => c.RECORD === RECORD_TYPES.SHEET_FILE_NAME));
  if (!fileName) return undefined;
  return path.basename(fileName.replace(/\\/g, "/")).toLowerCase();
};

const getDeviceName = (device: AltiumRecord): string | undefined => {
  const value = device.Name ?? device.NAME;
  return value === undefined || value === null || value === "" ? undefined : String(value);
};

const hasHarnessType = (device: AltiumRecord): boolean =>
  Boolean(device.HarnessType ?? device.HARNESSTYPE);

/**
 * Collect every net's cross-sheet identity claims (see NetLinkGroup).
 *
 * `placement` is the document instance this sheet is read as (see
 * DocumentInstance.key).
 */
const collectNetLinks = (
  nets: AltiumNet[],
  schematic: AltiumSchematic,
  parsedNets: NetConnections,
  documentName: string,
  placement: string
): NetLinkGroup[] => {
  const groups: NetLinkGroup[] = [];

  const entryKey = (entry: AltiumRecord, name: string, channel = ""): string | undefined => {
    const owner = entry.OwnerIndex ?? entry.OWNERINDEX;
    if (owner === undefined || owner === null || owner === "") return undefined;
    const symbolIndex = parseInt(String(owner), 10);
    if (!sheetSymbolChild(findRecordByIndex(schematic, symbolIndex))) return undefined;
    return `entry|${placement}|${documentName}|${symbolIndex}|${name}|${channel}`;
  };

  for (const net of nets) {
    const keys = new Set<string>();
    const port = (name: string): void => {
      keys.add(`port|${name}`);
      keys.add(`hier|${placement}|${name}`);
    };

    for (const device of net.devices) {
      if (device.RECORD === RECORD_TYPES.POWER_PORT) {
        const name = device.Text ?? device.TEXT;
        if (name !== undefined && name !== null && name !== "") keys.add(`power|${String(name)}`);
        continue;
      }
      // A harness-typed port or entry carries a bundle, which the harness
      // code joins; a range identifier is reached through a bus and joins
      // through the carriers below.
      if (hasHarnessType(device) || isBusIdentifier(device)) continue;
      const name = getDeviceName(device);
      if (!name) continue;
      if (device.RECORD === RECORD_TYPES.PORT) {
        port(name);
      } else if (device.RECORD === RECORD_TYPES.SHEET_ENTRY && isSignalSheetEntry(device)) {
        const key = entryKey(device, name);
        if (key) keys.add(key);
      }
    }

    for (const { device, member, channel } of net.busCarriers ?? []) {
      const name = getDeviceName(device);
      if (!name) continue;
      if (device.RECORD === RECORD_TYPES.PORT) {
        // A harness-typed port reached by a bus names a bundle, and the port
        // of that name on the other sheet names the same bundle.
        if (hasHarnessType(device)) {
          keys.add(`harness|${harnessSignalKey(portBundle(name), member)}`);
        } else port(member);
      } else if (device.RECORD === RECORD_TYPES.SHEET_ENTRY) {
        if (hasHarnessType(device)) continue;
        // A `Repeat(NAME)` entry hands the member to the channel it indexes,
        // which the bus code read off the member whatever the bus is called.
        const base = repeatBaseName(name);
        const key = base
          ? entryKey(device, base, String(channel ?? parseInt(member.slice(base.length), 10)))
          : entryKey(device, member);
        if (key) keys.add(key);
      } else if (
        device.RECORD === RECORD_TYPES.HARNESS_ENTRY &&
        typeof device.harnessSignal === "string"
      ) {
        const { bundle } = splitHarnessSignalKey(device.harnessSignal);
        keys.add(`harness|${harnessSignalKey(bundle, member)}`);
      }
    }

    if (keys.size === 0) continue;
    const named = net.name && parsedNets[net.name] ? net.name : undefined;
    // A pinless net named by an entry or a label still offers that name to
    // whatever it links. A pin-derived name cannot arise without pins.
    const candidate =
      !named && net.name && net.nameSource && net.nameSource !== "pin" ? net.name : undefined;
    groups.push({ net: named, name: candidate, keys: [...keys] });
  }
  return groups;
};

/**
 * Join the nets that ports, sheet entries, buses and power ports link from one
 * sheet to another.
 *
 * A port meets the sheet entry of the same name on the symbol that placed its
 * sheet under every scope; under Flat and Global scope ports also meet by name
 * anywhere in the project. Either way the link is an identity between two
 * nets that geometry cannot see, so the groups are resolved with a union-find
 * over their keys and every group of two or more names is folded into one,
 * exactly as a harness signal spanning sheets is.
 *
 * Returns the names each group holds, some of which may be the names of
 * pinless nets (see NetLinkGroup.name).
 */
const linkedNetGroups = (
  links: readonly NetLinkGroup[],
  scope: NetIdentifierScope,
  symbolChannels: ReadonlyMap<string, readonly number[]>
): Map<string, Set<string>> => {
  const portsJoinByName = scope === "flat" || scope === "global";
  const powerIsGlobal = powerPortsAreGlobal(scope);

  // A plain entry reaches every channel the symbol instantiates; a
  // `Repeat(NAME)` entry's bus member reaches the one channel it indexes.
  // Names match ignoring case.
  const resolveKeys = (key: string): string[] => resolveKey(key).map(identifierKey);
  const resolveKey = (key: string): string[] => {
    const [kind] = key.split("|", 1);
    if (kind === "entry") {
      const [, parent, document, symbolIndex, name, channel] = key.split("|");
      const channels = channel
        ? [channel]
        : (symbolChannels.get(`${document}#${symbolIndex}`) ?? []).map(String);
      return channels.map((index) => `hier|${parent}/${symbolIndex}@${index}|${name}`);
    }
    if (kind === "port") return portsJoinByName ? [key] : [];
    if (kind === "power") return powerIsGlobal ? [key] : [];
    return [key];
  };

  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = node;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(node, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const netNodes = new Set<string>();
  for (const group of links) {
    const keys = group.keys.flatMap(resolveKeys);
    if (keys.length === 0) continue;
    const member = group.net ?? group.name;
    const nodes = member ? [`net:${member}`, ...keys] : keys;
    if (member) netNodes.add(`net:${member}`);
    for (const node of nodes) union(nodes[0], node);
  }

  const groups = new Map<string, Set<string>>();
  for (const node of netNodes) {
    const root = find(node);
    const members = groups.get(root) ?? new Set<string>();
    members.add(node.slice("net:".length));
    groups.set(root, members);
  }
  return groups;
};

/**
 * Parse one Altium .SchDoc document.
 *
 * `placement` is the document instance it is read as (see DocumentInstance.key).
 */
const parseAltiumDocument = (
  read: ReadDocument,
  naming: NetNamingOptions = NAME_FROM_ANY,
  placement: string = read.name
): ParsedDocument => {
  const hierarchical = read.hierarchical;

  const nets = extractNets(hierarchical, naming);
  const parsedNets = convertNets(nets, hierarchical);
  const components = extractComponents(hierarchical);
  populatePinNets(components, parsedNets);
  reconcileNetlist({ nets: parsedNets, components });

  const ranks = nameRanks(naming);
  const nameSources = new Map<string, NetNameSource>();
  for (const net of nets) {
    if (!net.name || !net.nameSource) continue;
    const seen = nameSources.get(net.name);
    // Two groups under one name are folded into one net; the stronger claim
    // names it.
    if (seen === undefined || ranks[net.nameSource] < ranks[seen]) {
      nameSources.set(net.name, net.nameSource);
    }
  }

  const { hasSheetEntries, hasPorts } = readDesignShape(hierarchical);

  return {
    name: read.name,
    placement,
    hierarchical,
    netlist: { nets: parsedNets, components },
    nets,
    links: collectNetLinks(nets, hierarchical, parsedNets, read.name, placement),
    harnessSignals: collectHarnessSignals(nets, parsedNets),
    nameSources,
    bundleLinks: read.bundleLinks,
    netIdentifiers: collectNetIdentifiers(nets),
    sheetNumber: readSheetNumber(hierarchical),
    hasSheetEntries,
    hasPorts,
  };
};

/**
 * Parse Altium .SchDoc file into unified ParsedNetlist schema.
 *
 * This is the main entry point for integration with NetlistService.
 */
export const parseAltium = async (schdocPath: string): Promise<ParsedNetlist> =>
  parseAltiumDocument(readDocument(schdocPath)).netlist;

/**
 * Parse Altium file with a specific output format (matching Python API).
 */
export const parse = (
  schdocPath: string,
  format: OutputFormat = "all-hierarchy"
): AltiumSchematic | { records: AltiumRecord[] } | (AltiumSchematic & { nets: AltiumNet[] }) => {
  // Read and parse the file
  const buffer = readOleStream(schdocPath);
  const schematic = parseRecords(buffer);

  switch (format) {
    case "all-list":
      return schematic;

    case "all-hierarchy":
      return buildHierarchy(schematic);

    case "parts-list":
      return {
        records: getPartsList(buildHierarchy(schematic)),
      };

    case "net-list":
      return determineNetList(buildHierarchy(schematic));

    default:
      return buildHierarchy(schematic);
  }
};

// Import discovery functions and handler interface
import {
  discoverAltiumDesigns,
  findAltiumSchDocs,
  isAltiumFile,
  ALTIUM_EXTENSIONS,
} from "./discovery.js";
import { readFile } from "fs/promises";
import type { EDAProjectFormatHandler } from "../../types.js";
import { expandRepeatChannels } from "./structure-parser.js";
import type { RepeatChannel } from "./structure-parser.js";

export { discoverAltiumDesigns, findAltiumSchDocs, isAltiumFile } from "./discovery.js";

/**
 * Merge a ParsedNetlist into accumulator objects.
 */
const mergeResult = (
  result: ParsedNetlist,
  allNets: NetConnections,
  allComponents: ComponentDetails
): void => {
  for (const [netName, connections] of Object.entries(result.nets)) {
    if (!allNets[netName]) {
      allNets[netName] = {};
    }
    for (const [refdes, pins] of Object.entries(connections)) {
      if (!allNets[netName][refdes]) {
        allNets[netName][refdes] = pins;
      } else {
        const existing = allNets[netName][refdes];
        const existingArray = Array.isArray(existing) ? existing : [existing];
        const newPins = Array.isArray(pins) ? pins : [pins];
        allNets[netName][refdes] = [...new Set([...existingArray, ...newPins])];
      }
    }
  }

  // The same designator on two sheets is one multi-part component when the
  // sheets draw different parts of it, and a duplicate designator when they do
  // not. Either way the first sheet's reading of a pin stands, and
  // `reconcileNetlist` removes the later sheet's listing of that pin.
  for (const [refdes, component] of Object.entries(result.components)) {
    const existing = allComponents[refdes];
    if (existing) mergeComponentInto(existing, component);
    else allComponents[refdes] = component;
  }
};

export type { NetNameSource };

/**
 * Choose the name a group of merged nets keeps.
 *
 * The strongest claim wins (see NAME_RANK). Between two names of the same
 * rank the first in sort order wins, which is what the misko3 board shows for
 * a net labelled `NRST` on one sheet and `T_NRST` on another, and which keeps
 * the result independent of the order the documents were read in.
 */
const canonicalNetName = (names: Iterable<string>, rankOf: (name: string) => number): string => {
  return [...names].sort((a, b) => {
    const rank = rankOf(a) - rankOf(b);
    if (rank !== 0) return rank;
    const plainA = displayName(a);
    const plainB = displayName(b);
    return plainA < plainB ? -1 : plainA > plainB ? 1 : 0;
  })[0];
};

/**
 * Marks a name that is provisional: a port or sheet entry named the net, and
 * under Hierarchical scope that name is this sheet's own, so the same name on
 * another sheet is another net. The marker keeps the two apart while the
 * sheets are merged by name, and is stripped once the links have been
 * resolved. It cannot occur in a name Altium writes.
 */
const PROVISIONAL = "\u0000";

/** A name as it will be reported, without any provisional marker. */
const displayName = (name: string): string => {
  const marker = name.indexOf(PROVISIONAL);
  return marker < 0 ? name : name.slice(0, marker);
};

/**
 * Give every provisional name its final form.
 *
 * Most such names never survive: the net is joined to a parent net that a label
 * names. One that does keeps the name the port or entry gave it, and where two
 * distinct nets end up claiming one name, the later in sort order is numbered.
 */
const settleProvisionalNames = (allNets: NetConnections): Map<string, string> => {
  const renames = new Map<string, string>();
  const taken = new Set(Object.keys(allNets).filter((name) => !name.includes(PROVISIONAL)));
  const provisional = Object.keys(allNets)
    .filter((name) => name.includes(PROVISIONAL))
    .sort();
  for (const name of provisional) {
    const plain = displayName(name);
    let candidate = plain;
    for (let n = 2; taken.has(candidate); n++) candidate = `${plain}_${n}`;
    taken.add(candidate);
    renames.set(name, candidate);
  }
  return renames;
};

/**
 * Fold each group of linked nets into one.
 *
 * Within a sheet the two ends of a harness, or of a bus, are already one net.
 * Across sheets there is no geometry to join them: each sheet names its end
 * after whatever its own wires carry, and two different names leave the ends
 * looking like two nets. The groups say which names are one net, and the
 * surviving name is the same on every sheet so that a component's pins agree
 * with the netlist.
 *
 * A group may hold the name of a pinless net (see NetLinkGroup.name). It is a
 * candidate for the surviving name and nothing more: a group with no net that
 * has pins is left alone.
 *
 * Returns the renaming that was applied, empty when nothing spans sheets.
 */
const mergeNetGroups = (
  allNets: NetConnections,
  allComponents: ComponentDetails,
  groups: Iterable<Set<string>>,
  rankOf: (name: string) => number
): Map<string, string> => {
  const renames = new Map<string, string>();

  for (const netNames of groups) {
    if (netNames.size < 2) continue;
    // A net already folded into another group joins that group's name, so a
    // signal shared with a third sheet does not split it off again.
    const resolved = new Set([...netNames].map((name) => renames.get(name) ?? name));
    if (resolved.size < 2) continue;
    if (![...resolved].some((name) => allNets[name] !== undefined)) continue;

    const canonical = canonicalNetName(resolved, rankOf);
    for (const [from, to] of renames) {
      if (resolved.has(to)) renames.set(from, canonical);
    }
    for (const name of resolved) {
      if (name !== canonical) renames.set(name, canonical);
    }
  }

  if (renames.size === 0) return renames;

  for (const [from, to] of renames) {
    const connections = allNets[from];
    if (!connections) continue;
    delete allNets[from];

    const target = (allNets[to] ??= {});
    for (const [refdes, pins] of Object.entries(connections)) {
      target[refdes] = [...new Set([...(target[refdes] ?? []), ...pins])];
    }
  }

  for (const component of Object.values(allComponents)) {
    for (const [pinNumber, entry] of Object.entries(component.pins)) {
      if (typeof entry === "string") {
        const renamed = renames.get(entry);
        if (renamed) component.pins[pinNumber] = renamed;
      } else {
        const renamed = renames.get(entry.net);
        if (renamed) entry.net = renamed;
      }
    }
  }

  return renames;
};

/**
 * Read the netlisting options a PrjPcb records, which say how its sheets join
 * up and how the resulting nets are named.
 */
const readProjectOptions = async (projectPath: string): Promise<AltiumProjectOptions> => {
  try {
    return parseProjectOptions(await readFile(projectPath, "utf-8"));
  } catch {
    // A project we cannot read is netlisted on Altium's own defaults.
    return parseProjectOptions("");
  }
};

const recordText = (record: AltiumRecord | undefined): string => {
  const value = record?.Text ?? record?.TEXT ?? record?.Name ?? record?.NAME;
  return value === undefined || value === null ? "" : String(value);
};

/** One sheet symbol, and the document it places. */
interface SheetPlacement {
  /** The parent document. */
  parent: ReadDocument;
  /** The parent's position in the project, which orders symbols across documents. */
  parentOrder: number;
  symbol: AltiumRecord;
  /** The channels the symbol instantiates: one for a plain symbol, several for `Repeat()`. */
  channels: RepeatChannel[];
  /** `NAME` of a `Repeat(NAME,start,end)` designator. */
  repeatName?: string;
}

/**
 * Every sheet symbol in the project, grouped by the document it places.
 *
 * A sheet symbol (RECORD=15) owns its designator (RECORD=32) and the child
 * document it instantiates (RECORD=33). The compiled `.PrjPcbStructure` records
 * the same symbols but is frequently not committed, so the schematics are read.
 */
const findSheetPlacements = (documents: readonly ReadDocument[]): Map<string, SheetPlacement[]> => {
  const placements = new Map<string, SheetPlacement[]>();
  documents.forEach((parent, parentOrder) => {
    for (const symbol of flattenHierarchy(parent.hierarchical)) {
      if (symbol.RECORD !== RECORD_TYPES.SHEET_SYMBOL) continue;
      const child = sheetSymbolChild(symbol);
      if (!child) continue;
      const designator = recordText(
        (symbol.children ?? []).find((c) => c.RECORD === RECORD_TYPES.SHEET_NAME)
      );
      const repeated = expandRepeatChannels(designator);
      const placed = placements.get(child) ?? [];
      placed.push({
        parent,
        parentOrder,
        symbol,
        channels: repeated.length > 0 ? repeated : [{ designator, index: 1 }],
        repeatName:
          repeated.length > 0
            ? repeated[0].designator.slice(0, -String(repeated[0].index).length)
            : undefined,
      });
      placements.set(child, placed);
    }
  });
  return placements;
};

/** One instance of a document: the sheet symbol channels that place it, from the top. */
interface DocumentInstance {
  /**
   * The unplaced document's name, then `/<symbol index>@<channel index>` per level.
   * Its ports meet the entries of the last level's symbol.
   */
  key: string;
  path: { placement: SheetPlacement; channel: RepeatChannel }[];
  /** The room name, which `$RoomName` and local net names carry. */
  room: string;
  /** 1-based position among the document's instances, for `$ChannelIndex` and `$ChannelAlpha`. */
  ordinal: number;
}

/** Natural order ignoring case: runs of digits compare as numbers, everything else by code. */
const naturalCompare = (a: string, b: string): number => {
  const partsA = a.toUpperCase().match(/\d+|\D+/g) ?? [];
  const partsB = b.toUpperCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    const [x, y] = [partsA[i], partsB[i]];
    const numeric = /^\d/.test(x) && /^\d/.test(y) ? Number(x) - Number(y) : 0;
    if (numeric !== 0) return numeric;
    if (!/^\d/.test(x) || !/^\d/.test(y)) {
      if (x !== y) return x < y ? -1 : 1;
    }
  }
  return partsA.length - partsB.length;
};

/**
 * Every instance of every document, numbered as Altium numbers them.
 *
 * A document is instantiated once per path of sheet symbol channels from an
 * unplaced document, so a sheet inside a repeated sheet repeats with it. Instances
 * are ordered by path, level by level: by channel designator in natural order,
 * then between symbols of one designator, the later in the project first. A room
 * is the last level's channel designator; rooms that repeat are numbered in
 * instance order. Room naming style `1` writes channel and room numbers as letters.
 */
const documentInstances = (
  documents: readonly ReadDocument[],
  placements: ReadonlyMap<string, readonly SheetPlacement[]>,
  roomNamingStyle: string
): Map<string, DocumentInstance[]> => {
  type Path = Pick<DocumentInstance, "key" | "path">;
  const paths = new Map<string, Path[]>();
  const visiting = new Set<string>();
  const pathsOf = (name: string): Path[] => {
    const known = paths.get(name);
    if (known) return known;
    const placed = placements.get(name) ?? [];
    if (placed.length === 0 || visiting.has(name)) return [{ key: name, path: [] }];
    visiting.add(name);
    const result = placed.flatMap((placement) =>
      pathsOf(placement.parent.name).flatMap((parent) =>
        placement.channels.map((channel) => ({
          key: `${parent.key}/${placement.symbol.index}@${channel.index}`,
          path: [...parent.path, { placement, channel }],
        }))
      )
    );
    visiting.delete(name);
    paths.set(name, result);
    return result;
  };

  const compareLevel = (a: Path["path"][number], b: Path["path"][number]): number =>
    naturalCompare(a.channel.designator, b.channel.designator) ||
    (a.placement === b.placement
      ? a.channel.index - b.channel.index
      : b.placement.parentOrder - a.placement.parentOrder ||
        b.placement.symbol.index - a.placement.symbol.index);
  const comparePath = (a: Path, b: Path): number => {
    for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
      const order = compareLevel(a.path[i], b.path[i]);
      if (order !== 0) return order;
    }
    return a.path.length - b.path.length;
  };
  const number = (n: number): string => (roomNamingStyle === "1" ? channelAlpha(n) : String(n));

  const instances = new Map<string, DocumentInstance[]>();
  for (const document of documents) {
    const ordered = [...pathsOf(document.name)].sort(comparePath);
    const rooms = ordered.map(({ path: levels }) => {
      const leaf = levels[levels.length - 1];
      if (!leaf) return document.name;
      const { placement, channel } = leaf;
      return placement.repeatName === undefined
        ? channel.designator
        : `${placement.repeatName}${number(channel.index)}`;
    });
    const repeats = new Map<string, number>();
    for (const room of rooms) repeats.set(room, (repeats.get(room) ?? 0) + 1);
    const seen = new Map<string, number>();
    instances.set(
      document.name,
      ordered.map((instance, i) => {
        const room = rooms[i];
        const n = (seen.get(room) ?? 0) + 1;
        seen.set(room, n);
        return {
          ...instance,
          room: repeats.get(room)! > 1 ? `${room}${number(n)}` : room,
          ordinal: i + 1,
        };
      })
    );
  }
  return instances;
};

/**
 * Render a 1-based channel number as Altium's alphabetic channel label:
 * 1 → "A", 26 → "Z". Past 26 Altium does not roll over to "AA"; it keeps
 * counting through the ASCII characters that follow "Z", so channel 27 is
 * "[" and channel 32 is "\`". FMC_DIO_32ch_lvds_a writes its variant rows
 * that way (`R1[` … `R1\``), which is the only place the spelling can be read.
 */
const channelAlpha = (channelIndex: number): string =>
  String.fromCharCode(64 + Math.max(1, channelIndex));

/**
 * Tokens Altium substitutes into `ChannelDesignatorFormatString`.
 *
 * Ordered longest-first: a plain `$Component` alternative listed before
 * `$ComponentPrefix` would match its prefix and leave a stray "Prefix" behind.
 */
const CHANNEL_FORMAT_TOKEN =
  /\$(ComponentPrefix|ComponentIndex|ChannelIndex|ChannelAlpha|Component|RoomName)/g;

/**
 * Apply a channel designator format to a component refdes.
 *
 * `$Component_$RoomName` with ("DD12", room "AY1") → "DD12_AY1"
 * `$Component$ChannelAlpha` with ("R5", channel 2) → "R5B"
 * `$ComponentPrefix_$ChannelIndex_$ComponentIndex` with ("R5", channel 3) → "R_3_5"
 *
 * An unrecognized token is left as written rather than dropped, so a format we
 * do not model yet produces a visibly wrong designator instead of silently
 * colliding with another channel's.
 */
export const applyChannelFormat = (
  format: string,
  component: string,
  roomName: string,
  channelIndex: number
): string => {
  const prefixMatch = component.match(/^([^0-9]*)([0-9].*)?$/);
  const componentPrefix = prefixMatch?.[1] ?? component;
  const componentIndex = prefixMatch?.[2] ?? "";

  return format.replace(CHANNEL_FORMAT_TOKEN, (_match, token: string) => {
    switch (token) {
      case "Component":
        return component;
      case "ComponentPrefix":
        return componentPrefix;
      case "ComponentIndex":
        return componentIndex;
      case "RoomName":
        return roomName;
      case "ChannelIndex":
        return String(channelIndex);
      case "ChannelAlpha":
        return channelAlpha(channelIndex);
      default:
        return _match;
    }
  });
};

const unescapeAltiumOverbar = (name: string): string =>
  name.includes("\\") ? name.replace(/\\/g, "") : name;

/**
 * Expand Altium bus notation into individual signal names.
 * "AD[0..7]" → ["AD0", "AD1", ..., "AD7"]
 * "C\\S\\[1..5]" → ["CS1", "CS2", ..., "CS5"]
 * "BDIR" → ["BDIR"]
 */
const expandBusNotation = (name: string): string[] => {
  const unescaped = unescapeAltiumOverbar(name);
  const match = unescaped.match(/^(.+)\[(\d+)\.\.(\d+)\]$/);
  if (!match) return [unescaped];

  const prefix = match[1];
  const start = parseInt(match[2], 10);
  const end = parseInt(match[3], 10);
  const result: string[] = [];
  const step = start <= end ? 1 : -1;

  for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
    result.push(`${prefix}${i}`);
  }

  return result;
};

interface SheetEntryClassification {
  /** Signal names from non-Repeat entries: shared across channels */
  sharedNames: Set<string>;
}

/**
 * Load the harness type definitions that apply to a schematic document.
 *
 * Membership is not stored in the `.SchDoc`; each document has a sibling
 * `<name>.Harness` text file. A document that uses no harnesses has none, so a
 * missing file is the normal case.
 */
const readHarnessDefinitions = async (schdocPath: string): Promise<HarnessDefinitions> => {
  const sidecar = schdocPath.replace(/\.SchDoc$/i, ".Harness");
  try {
    return parseHarnessDefinitions(await readFile(sidecar, "utf-8"));
  } catch {
    return new Map();
  }
};

/**
 * Classify the SHEET_ENTRY records of one sheet symbol.
 *
 * A `Repeat()` entry gives each channel its own copy of the signal, which is
 * what a net the parent never reaches gets anyway, so it is simply not
 * collected here. Only what the channels share has to be named. Bus notation
 * (`AD[0..7]`) is expanded into individual signals.
 */
const classifySheetEntries = (
  symbol: AltiumRecord,
  harnessDefinitions: HarnessDefinitions = new Map(),
  nestedHarnessTypes: ReadonlyMap<string, string> = new Map()
): SheetEntryClassification => {
  const sharedNames = new Set<string>();

  for (const child of symbol.children ?? []) {
    if (child.RECORD !== RECORD_TYPES.SHEET_ENTRY) continue;
    const rawName = String(child.Name ?? child.NAME ?? "");
    if (/^Repeat\((.+)\)$/i.test(rawName)) continue;

    for (const signal of expandBusNotation(rawName)) {
      sharedNames.add(signal);
    }

    // A harness-typed entry carries a bundle, not one signal. Every member the
    // bundle resolves to crosses the sheet boundary with it and is classified
    // the same way, so a shared harness keeps its members shared rather than
    // giving each channel a private copy that connects to nothing.
    const harnessType = child.HarnessType;
    if (harnessType) {
      for (const member of resolveHarnessMembers(
        String(harnessType),
        harnessDefinitions,
        nestedHarnessTypes
      )) {
        sharedNames.add(member);
        // Members are qualified by the entry that reached them
        // (PGND.OP_OUT); the leaf name is what a net inside the child sheet
        // is actually called.
        const leaf = member.slice(member.lastIndexOf(".") + 1);
        if (leaf) sharedNames.add(leaf);
      }
    }
  }

  return { sharedNames };
};

/**
 * The pin each auto-named net was named after, keyed by the name it produced.
 *
 * A net the designer never named is called after its lowest pin, and on a
 * repeated sheet that name has to be rebuilt for every channel, so the pieces
 * it was built from are carried alongside it.
 */
const collectPinNamedNets = (nets: AltiumNet[]): Map<string, { refdes: string; pin: string }> => {
  const pinNamed = new Map<string, { refdes: string; pin: string }>();
  for (const net of nets) {
    if (net.name && net.nameSource === "pin" && net.pinNameSource) {
      pinNamed.set(net.name, net.pinNameSource);
    }
  }
  return pinNamed;
};

/** What a repeated sheet's nets are, as the channel naming rule needs to see them. */
export interface ChannelNetScope {
  /** Nets named by a power port, which name one supply across the whole project. */
  powerNetNames: ReadonlySet<string>;
  /** Sheet entry signals shared by every channel. */
  sharedNames: ReadonlySet<string>;
  /** The pin each auto-named net was named after, keyed by that name. */
  pinNamed: ReadonlyMap<string, { refdes: string; pin: string }>;
}

/**
 * What one channel calls each of the repeated sheet's nets.
 *
 * A repeated sheet is drawn once and placed several times, so most of its nets
 * exist once per channel and need a name that says which. What reaches across
 * the channels keeps the one name: a supply, and any sheet entry signal the
 * parent wired to all of them.
 *
 * A net the designer never named is called after one of its pins, and the
 * channel has already renamed the part that pin sits on. Altium expands the
 * designator first and builds the name from the result, so the channel lands
 * inside the name rather than after it: `NetDD12_AY1_1`, where appending would
 * give `NetDD12_1_AY1`. Rebuilding it around the expanded designator makes it
 * unique per channel by itself, which is what the suffix is for elsewhere.
 *
 * A `Repeat()` sheet entry signal needs no branch of its own: it is per-channel,
 * which is what a net the parent never reaches gets anyway.
 */
export const planChannelNetNames = (
  netNames: Iterable<string>,
  scope: ChannelNetScope,
  roomName: string,
  channelIndex: number,
  channelFormat: string
): Map<string, string> => {
  const netNameMap = new Map<string, string>();
  for (const netName of netNames) {
    const pinName = scope.pinNamed.get(netName);
    if (scope.powerNetNames.has(netName)) {
      netNameMap.set(netName, netName);
    } else if (scope.sharedNames.has(netName)) {
      netNameMap.set(netName, netName);
    } else if (pinName) {
      const expanded = applyChannelFormat(channelFormat, pinName.refdes, roomName, channelIndex);
      netNameMap.set(netName, `Net${expanded}_${pinName.pin}`);
    } else {
      // A `Repeat()` sheet entry signal, or a local net the parent never reaches
      // at all. Either way it belongs to this channel alone, named the way the
      // channel's designators are.
      netNameMap.set(netName, applyChannelFormat(channelFormat, netName, roomName, channelIndex));
    }
  }
  return netNameMap;
};

/**
 * One instance of a multi-instance sheet, as its own document.
 *
 * The sheet is drawn once and instantiated several times, so every part and most
 * nets exist once per instance under a name that says which (see
 * planChannelNetNames and applyChannelFormat). Its claims about other sheets name
 * the instance: its ports meet the symbol channel that placed it, and its entries
 * reach the instances of the sheets it places.
 */
const channelDocument = (
  base: ParsedDocument,
  channel: DocumentInstance,
  channelFormat: string,
  scope: ChannelNetScope,
  documentName: string
): ParsedDocument => {
  const names = new Set<string>([
    ...Object.keys(base.netlist.nets),
    ...base.nameSources.keys(),
    ...base.netIdentifiers.keys(),
    ...base.harnessSignals.values(),
  ]);
  for (const group of base.links) {
    if (group.net) names.add(group.net);
    if (group.name) names.add(group.name);
  }
  const netNameMap = planChannelNetNames(
    names,
    scope,
    channel.room,
    channel.ordinal,
    channelFormat
  );
  const rename = (name: string): string => netNameMap.get(name) ?? name;
  const refdes = (name: string): string =>
    applyChannelFormat(channelFormat, name, channel.room, channel.ordinal);

  const nets: NetConnections = {};
  for (const [netName, connections] of Object.entries(base.netlist.nets)) {
    const target = (nets[rename(netName)] ??= {});
    for (const [origRefdes, pins] of Object.entries(connections)) {
      const expanded = refdes(origRefdes);
      target[expanded] = [...new Set([...(target[expanded] ?? []), ...pins])];
    }
  }

  const components: ComponentDetails = {};
  for (const [origRefdes, component] of Object.entries(base.netlist.components)) {
    const pins: Record<string, PinEntry> = {};
    for (const [pinNumber, entry] of Object.entries(component.pins)) {
      pins[pinNumber] =
        typeof entry === "string" ? rename(entry) : { ...entry, net: rename(entry.net) };
    }
    components[refdes(origRefdes)] = { ...component, pins };
  }

  const own = [`hier|${documentName}|`, `entry|${documentName}|`];
  const links: NetLinkGroup[] = base.links.map((group) => ({
    net: group.net === undefined ? undefined : rename(group.net),
    name: group.name === undefined ? undefined : rename(group.name),
    keys: group.keys.map((key) => {
      const prefix = own.find((start) => key.startsWith(start));
      return prefix
        ? `${prefix.slice(0, prefix.indexOf("|") + 1)}${channel.key}|${key.slice(prefix.length)}`
        : key;
    }),
  }));

  const harnessSignals = new Map<string, string>();
  for (const [signal, netName] of base.harnessSignals) harnessSignals.set(signal, rename(netName));
  const nameSources = new Map<string, NetNameSource>();
  for (const [name, source] of base.nameSources) nameSources.set(rename(name), source);
  const netIdentifiers = new Map<string, NetIdentifierKinds>();
  for (const [name, kinds] of base.netIdentifiers) netIdentifiers.set(rename(name), kinds);

  return {
    name: base.name,
    placement: channel.key,
    hierarchical: base.hierarchical,
    netlist: { nets, components },
    nets: base.nets,
    links,
    harnessSignals,
    nameSources,
    bundleLinks: base.bundleLinks,
    netIdentifiers,
    // Local net names already carry the channel's room, so the sheet number
    // has nothing left to tell apart.
    sheetNumber: undefined,
    hasSheetEntries: base.hasSheetEntries,
    hasPorts: base.hasPorts,
  };
};

/**
 * Parse an Altium project by parsing all its SchDoc files and merging the results.
 *
 * A document placed by several sheet symbols, or by one `Repeat()` symbol, is
 * parsed once and instantiated once per channel.
 */
const parseAltiumProject = async (
  projectPath: string,
  parseOptions?: ParseDesignOptions
): Promise<ParsedNetlist> => {
  const schdocPaths = await findAltiumSchDocs(projectPath);

  if (schdocPaths.length === 0) {
    throw new Error(`No schematic documents found for project ${projectPath}`);
  }

  // How these sheets connect to each other, how the resulting nets are named
  // and what the channels are called are all recorded in the project file
  // rather than in any one schematic.
  const options = await readProjectOptions(projectPath);
  const channelFormat = options.channelFormat;
  const naming: NetNamingOptions = {
    allowPortNetNames: options.allowPortNetNames,
    allowSheetEntryNetNames: options.allowSheetEntryNetNames,
    powerPortNamesTakePriority: options.powerPortNamesTakePriority,
  };
  const ranks = nameRanks(naming);
  // A net whose naming was not recorded ranks below every recorded source.
  const unranked = ranks.pin + 1;

  const documents = schdocPaths.map(readDocument);
  const placements = findSheetPlacements(documents);
  const instances = documentInstances(documents, placements, options.roomNamingStyle);

  // Which scope the project netlists under is only known once every sheet has
  // been read, because Automatic decides it from what the design draws. The
  // sheets are therefore collected first and merged afterwards, in the order
  // they were read, so that naming ties still fall the way they always have.
  const pending: ParsedDocument[] = [];
  for (const read of documents) {
    const channels = instances.get(read.name) ?? [];
    if (channels.length <= 1) {
      pending.push(parseAltiumDocument(read, naming, channels[0]?.key));
      continue;
    }

    const base = parseAltiumDocument(read, naming);
    // The channels of one `Repeat()` symbol in one parent instance share what its
    // plain entries carry; instances placed by different symbols, or under
    // different parent instances, share nothing by name. The bundle definitions
    // live beside the parent document, whose sheet entry declares the harness
    // type; nesting is declared on the parent's entry records.
    const sharedNames = new Set<string>();
    const placed = placements.get(read.name) ?? [];
    const sharing =
      placed.length === 1 && (instances.get(placed[0].parent.name) ?? []).length <= 1 ? placed : [];
    for (const placement of sharing) {
      const harnessDefinitions = await readHarnessDefinitions(placement.parent.path);
      const nestedHarnessTypes = collectNestedHarnessTypes(
        flattenHierarchy(placement.parent.hierarchical) as never
      );
      for (const name of classifySheetEntries(
        placement.symbol,
        harnessDefinitions,
        nestedHarnessTypes
      ).sharedNames) {
        sharedNames.add(name);
      }
    }
    const scope: ChannelNetScope = {
      powerNetNames: classifyNets(base.nets).powerNetNames,
      sharedNames,
      pinNamed: collectPinNamedNets(base.nets),
    };
    for (const channel of channels) {
      pending.push(channelDocument(base, channel, channelFormat, scope, read.name));
    }
  }

  const scope = resolveNetIdentifierScope(options, {
    hasSheetEntries: pending.some((document) => document.hasSheetEntries),
    hasPorts: pending.some((document) => document.hasPorts),
  });

  // Altium tells same-named local nets apart on the board by appending the
  // sheet number, and only when the project asks it to; left off, it merges
  // them into one board net instead, which is what merging by name already
  // reproduces.
  const renamesPerDocument = options.appendSheetNumberToLocalNets
    ? planLocalNetRenames(pending, scope)
    : pending.map(() => new Map<string, string>());

  // Under Hierarchical scope a port or sheet entry names a net for its own
  // sheet only; the same name on another sheet is another net, joined only
  // through the links resolved below. Such names are marked provisional so
  // that merging the sheets by name does not fold them together.
  const namesAreSheetLocal = scope === "hierarchical" || scope === "strict-hierarchical";

  const allNets: NetConnections = {};
  const allComponents: ComponentDetails = {};
  const nameRankOf = new Map<string, number>();
  const rankOf = (name: string): number => nameRankOf.get(name) ?? unranked;

  pending.forEach((document, documentIndex) => {
    const renames = new Map(renamesPerDocument[documentIndex]);
    if (namesAreSheetLocal) {
      for (const [name, source] of document.nameSources) {
        if (source !== "port" && source !== "entry") continue;
        const local = renames.get(name) ?? name;
        renames.set(name, `${local}${PROVISIONAL}${documentIndex}`);
      }
    }

    if (renames.size > 0) {
      applyNetRenames(document.netlist, renames);
      for (const [signal, netName] of document.harnessSignals) {
        document.harnessSignals.set(signal, renames.get(netName) ?? netName);
      }
      const renamedSources = new Map<string, NetNameSource>();
      for (const [name, source] of document.nameSources) {
        renamedSources.set(renames.get(name) ?? name, source);
      }
      document.nameSources = renamedSources;
      for (const group of document.links) {
        if (group.net) group.net = renames.get(group.net) ?? group.net;
        if (group.name) group.name = renames.get(group.name) ?? group.name;
      }
    }

    mergeResult(document.netlist, allNets, allComponents);
    for (const [name, source] of document.nameSources) {
      const rank = ranks[source];
      if (rank < rankOf(name)) nameRankOf.set(name, rank);
    }
  });

  // Names written on different sheets meet ignoring case, as they do on one.
  const spellings = new Map<string, Set<string>>();
  for (const name of Object.keys(allNets)) {
    if (rankOf(name) >= ranks.pin) continue;
    const key = identifierKey(name);
    spellings.set(key, (spellings.get(key) ?? new Set<string>()).add(name));
  }
  const caseRenames = mergeNetGroups(allNets, allComponents, spellings.values(), rankOf);
  const caseRenamed = (name: string): string => caseRenames.get(name) ?? name;

  const symbolChannels = new Map<string, number[]>();
  for (const placed of placements.values()) {
    for (const { parent, symbol, channels } of placed) {
      symbolChannels.set(
        `${parent.name}#${symbol.index}`,
        channels.map((channel) => channel.index)
      );
    }
  }

  // A harness crosses sheets the way a port does: a bundle's port meets the entry
  // of the same name on the channel that placed its sheet, an entry reaches every
  // channel of its symbol, and under Flat and Global scope ports also meet by name.
  // A bundle reaching neither stays within its channel.
  const portsJoinByName = scope === "flat" || scope === "global";
  /** Nested bundle nodes, each with its parent bundle's node and its member. */
  const nestedBundles = new Map<string, { parent: string; member: string }>();
  const bundleNodes = (document: ParsedDocument, identity: string): string[] => {
    const nested = splitHarnessSignalKey(identity);
    if (nested.member !== "") {
      const parents = bundleNodes(document, nested.bundle);
      const member = identifierKey(nested.member);
      const node = harnessSignalKey(parents[0], member);
      if (!nestedBundles.has(node)) {
        nestedBundles.set(node, { parent: parents[0], member });
        joinBundles(parents);
      }
      return [node];
    }
    const separator = identity.indexOf("|");
    const kind = identity.slice(0, separator);
    const rest = identifierKey(identity.slice(separator + 1));
    if (kind === "port") {
      return [`hier|${document.placement}|${rest}`, ...(portsJoinByName ? [`port|${rest}`] : [])];
    }
    if (kind === "entry") {
      const index = rest.slice(0, rest.indexOf("|"));
      const name = rest.slice(index.length + 1);
      const channels = symbolChannels.get(`${document.name}#${index}`) ?? [];
      if (channels.length > 0) {
        return channels.map((c) => `hier|${document.placement}/${index}@${c}|${name}`);
      }
    }
    return [`${document.placement}|${identifierKey(identity)}`];
  };
  const bundleParent = new Map<string, string>();
  const findBundle = (node: string): string => {
    let root = node;
    while (bundleParent.get(root) !== undefined && bundleParent.get(root) !== root) {
      root = bundleParent.get(root)!;
    }
    bundleParent.set(node, root);
    return root;
  };
  const joinBundles = (nodes: readonly string[]): boolean => {
    let joined = false;
    for (const node of nodes) {
      const a = findBundle(nodes[0]);
      const b = findBundle(node);
      if (a !== b) bundleParent.set(b, a);
      joined ||= a !== b;
    }
    return joined;
  };
  const harnessKeyIdentities = (document: ParsedDocument): string[] =>
    document.links.flatMap((group) =>
      group.keys
        .filter((key) => key.startsWith("harness|"))
        .map((key) => splitHarnessSignalKey(key.slice("harness|".length)).bundle)
    );
  for (const document of pending) {
    const identities = [
      ...[...document.harnessSignals.keys()].map((signal) => splitHarnessSignalKey(signal).bundle),
      ...document.bundleLinks.flat(),
      ...harnessKeyIdentities(document),
    ];
    for (const identity of identities) joinBundles(bundleNodes(document, identity));
    for (const group of document.bundleLinks) {
      joinBundles(group.map((identity) => bundleNodes(document, identity)[0]));
    }
  }
  // Members of one name in joined bundles are one nested bundle; joining them can
  // join the parents of deeper ones.
  for (let joined = true; joined; ) {
    joined = false;
    const byMember = new Map<string, string>();
    for (const [node, { parent, member }] of nestedBundles) {
      const key = harnessSignalKey(findBundle(parent), member);
      const met = byMember.get(key);
      if (met === undefined) byMember.set(key, node);
      else joined = joinBundles([met, node]) || joined;
    }
  }
  const resolveSignal = (document: ParsedDocument, signal: string): string => {
    const { bundle, member } = splitHarnessSignalKey(signal);
    return harnessSignalKey(findBundle(bundleNodes(document, bundle)[0]), identifierKey(member));
  };

  const signalNets = new Map<string, Set<string>>();
  for (const document of pending) {
    for (const [signal, netName] of document.harnessSignals) {
      const key = resolveSignal(document, signal);
      const carriers = signalNets.get(key) ?? new Set<string>();
      carriers.add(caseRenamed(netName));
      signalNets.set(key, carriers);
    }
  }
  const harnessRenames = mergeNetGroups(allNets, allComponents, signalNets.values(), rankOf);
  const renamed = (name: string): string =>
    harnessRenames.get(caseRenamed(name)) ?? caseRenamed(name);

  // Ports, sheet entries, buses and power ports link nets across sheets the
  // same way, once the harness merge has settled which name each net goes by.
  // A pinless net named by a port or sheet entry is that net's own: two of them
  // named alike are two nets, so each takes a provisional name of its own.
  let pinless = 0;
  const netLinks: NetLinkGroup[] = pending.flatMap((document) =>
    document.links.map((group) => {
      let name = group.name === undefined ? undefined : renamed(group.name);
      const source = group.name === undefined ? undefined : document.nameSources.get(group.name);
      if (
        group.net === undefined &&
        name !== undefined &&
        (source === "port" || source === "entry")
      ) {
        const own = `${name}${PROVISIONAL}p${pinless++}`;
        nameRankOf.set(own, rankOf(name));
        name = own;
      }
      return {
        net: group.net === undefined ? undefined : renamed(group.net),
        name,
        keys: group.keys.map((key) =>
          key.startsWith("harness|")
            ? `harness|${resolveSignal(document, key.slice("harness|".length))}`
            : key
        ),
      };
    })
  );
  mergeNetGroups(
    allNets,
    allComponents,
    linkedNetGroups(netLinks, scope, symbolChannels).values(),
    rankOf
  );
  applyNetRenames({ nets: allNets, components: allComponents }, settleProvisionalNames(allNets));

  const netlist: ParsedNetlist = { nets: allNets, components: allComponents };
  reconcileNetlist(netlist);
  const variants = parseAltiumProjectVariants(await readFile(projectPath, "utf-8"));
  applyAltiumVariant(netlist.components, variants, parseOptions?.variant);
  return netlist;
};

/**
 * Altium EDA project format handler.
 * Supports Altium Designer projects (.PrjPcb).
 */
export const altiumHandler: EDAProjectFormatHandler = {
  name: "altium",
  extensions: ALTIUM_EXTENSIONS,

  canHandle: isAltiumFile,

  discoverDesigns: discoverAltiumDesigns,

  listVariants: async (designPath) =>
    path.extname(designPath).toLowerCase() === ".schdoc" ? [] : listAltiumVariants(designPath),

  parse: async (designPath: string, options?: ParseDesignOptions): Promise<ParsedNetlist> => {
    const ext = path.extname(designPath).toLowerCase();
    if (ext === ".schdoc") {
      return parseAltium(designPath);
    }
    return parseAltiumProject(designPath, options);
  },
};
