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
import type { ParsedNetlist, NetConnections, ComponentDetails, PinEntry } from "../../types.js";
import { createPinEntry } from "../../types.js";
import { isDnsComponent, stripDnsMarkers } from "../../circuit-traversal.js";
import type { AltiumSchematic, AltiumNet, AltiumRecord, OutputFormat } from "./types.js";
import {
  RECORD_TYPES,
  RECORD_TYPE_NAMES,
  PIN_ELECTRICAL_TYPES,
  POWER_PORT_STYLES,
} from "./types.js";
import { OleReader, readOleStream, readOptionalOleStream } from "../ole-reader/ole-reader.js";
import { parseRecords, findRecords } from "./record-parser.js";
import { buildHierarchy, getPartsList, flattenHierarchy, findRecordByIndex } from "./hierarchy.js";
import { extractNets, determineNetList, classifyNets } from "./net-extractor.js";
import {
  readHarnessConnectors,
  assignHarnessSignals,
  harnessSignalKey,
  splitHarnessSignalKey,
  parseHarnessDefinitions,
  resolveHarnessMembers,
  collectNestedHarnessTypes,
} from "./harness.js";
import type { HarnessDefinitions } from "./harness.js";

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
        if (typeof entry === "string") {
          component.pins[pin] = netName;
        } else if (entry) {
          entry.net = netName;
        } else {
          component.pins[pin] = netName;
        }
      }
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

const pinMatchesCurrentPart = (pin: AltiumRecord, part: AltiumRecord): boolean => {
  const partId = part.CURRENTPARTID ?? part.CurrentPartId ?? part.CurrentPartID;
  const pinPartId = pin.OwnerPartId ?? pin.OWNERPARTID;
  if (
    partId === undefined ||
    partId === null ||
    partId === "" ||
    pinPartId === undefined ||
    pinPartId === null ||
    pinPartId === ""
  ) {
    return true;
  }

  return String(partId) === String(pinPartId);
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

  for (const part of parts) {
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
          if (!pinMatchesCurrentPart(child, part)) {
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
    if (
      isDnsComponent({
        ...component,
        comment: [component.comment, assemblyInfo].filter(Boolean).join(" "),
      })
    ) {
      component.dns = true;
      if (component.mpn) component.mpn = stripDnsMarkers(component.mpn);
      if (component.value) component.value = stripDnsMarkers(component.value);
      if (component.description) component.description = stripDnsMarkers(component.description);
    }

    components[refdes] = component;
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
    buses: extra.records.filter(
      (record) => record.RECORD === RECORD_TYPES.SIGNAL_HARNESS
    ) as never,
    sheetKey: path.basename(schdocPath),
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
 * One document's netlist, plus which net carries each harness signal it draws.
 *
 * A harness signal is keyed by its bundle and member name, and a bundle that
 * leaves the sheet is named after the port it leaves through, so the same key
 * names the same signal on every sheet the bundle reaches. That is what lets a
 * harness be traced from one sheet to another, where geometry cannot reach.
 */
interface ParsedDocument {
  netlist: ParsedNetlist;
  /** Harness signal key -> the name of the net carrying it on this sheet. */
  harnessSignals: Map<string, string>;
  /** Net names that came from the design rather than being derived from a pin. */
  designedNames: Set<string>;
  /** Bundle names this sheet joins, each group being one bundle under many names. */
  bundleLinks: string[][];
}

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
 * Parse one Altium .SchDoc document.
 */
const parseAltiumDocument = (schdocPath: string): ParsedDocument => {
  // 1. Read OLE file and extract FileHeader stream
  const buffer = readOleStream(schdocPath);

  // 2. Parse binary stream into records
  const schematic = readSchematicRecords(schdocPath, buffer);

  // 3. Build hierarchy from flat records
  const hierarchical = buildHierarchy(schematic);

  // 4. Extract nets
  const nets = extractNets(hierarchical);

  // 5. Convert to ParsedNetlist format
  const parsedNets = convertNets(nets, hierarchical);
  const components = extractComponents(hierarchical);

  // 6. Populate component pin-to-net mappings from the nets data
  populatePinNets(components, parsedNets);

  const designedNames = new Set<string>();
  for (const net of nets) {
    if (net.name && net.nameSource && net.nameSource !== "pin") designedNames.add(net.name);
  }

  return {
    netlist: { nets: parsedNets, components },
    harnessSignals: collectHarnessSignals(nets, parsedNets),
    designedNames,
    bundleLinks: schematic.bundleLinks ?? [],
  };
};

/**
 * Parse Altium .SchDoc file into unified ParsedNetlist schema.
 *
 * This is the main entry point for integration with NetlistService.
 */
export const parseAltium = async (schdocPath: string): Promise<ParsedNetlist> =>
  parseAltiumDocument(schdocPath).netlist;

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
  findStructureFile,
  isAltiumFile,
  ALTIUM_EXTENSIONS,
} from "./discovery.js";
import { readFile } from "fs/promises";
import type { EDAProjectFormatHandler } from "../../types.js";
import {
  parseProjectStructure,
  findRepeatedSheets,
  expandRepeatDesignator,
} from "./structure-parser.js";
import type { SheetInstance } from "./structure-parser.js";

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

  for (const [refdes, component] of Object.entries(result.components)) {
    if (!allComponents[refdes]) {
      allComponents[refdes] = component;
    }
  }
};

/**
 * Resolve the many names one bundle goes by into a single one.
 *
 * A bundle is identified by the port it leaves its sheet through, and that port
 * is rarely called the same thing at both ends: a bulkhead sheet takes in
 * `TRANSPONDER_POWER_UL` and passes on `TRANSPONDER_POWER`. The parent sheet is
 * where the two are shown to be one bundle, by a harness line drawn between the
 * sheet entries that name them.
 *
 * Names are matched across the project, as ports already are elsewhere in this
 * parser, so two sheets that reuse one harness port name are read as sharing
 * that bundle.
 */
const resolveBundleNames = (linkGroups: string[][]): Map<string, string> => {
  const parent = new Map<string, string>();
  const find = (name: string): string => {
    const seen = parent.get(name);
    if (seen === undefined) {
      parent.set(name, name);
      return name;
    }
    if (seen === name) return name;
    const root = find(seen);
    parent.set(name, root);
    return root;
  };

  for (const group of linkGroups) {
    for (const name of group) {
      const rootA = find(group[0]);
      const rootB = find(name);
      if (rootA === rootB) continue;
      // Keep the smaller name as the root so the choice is stable whatever
      // order the documents were read in.
      if (rootA < rootB) parent.set(rootB, rootA);
      else parent.set(rootA, rootB);
    }
  }

  const resolved = new Map<string, string>();
  for (const name of parent.keys()) resolved.set(name, find(name));
  return resolved;
};

/**
 * Choose the name a group of merged nets keeps.
 *
 * A name the designer wrote — a label, a port, a power port — beats one the
 * parser derived from a pin, because the derived name says nothing about the
 * signal. Between two written names the one already on more pins wins, so a
 * signal keeps the name most of the design calls it by. Ties go to the first in
 * sort order, so the result does not depend on the order the documents happened
 * to be read in.
 */
const canonicalNetName = (
  names: Iterable<string>,
  designed: ReadonlySet<string>,
  allNets: NetConnections
): string => {
  const pinCount = (name: string): number =>
    Object.values(allNets[name] ?? {}).reduce((total, pins) => total + pins.length, 0);

  return [...names].sort((a, b) => {
    const written = Number(designed.has(b)) - Number(designed.has(a));
    if (written !== 0) return written;
    const pins = pinCount(b) - pinCount(a);
    if (pins !== 0) return pins;
    return a < b ? -1 : a > b ? 1 : 0;
  })[0];
};

/**
 * Join the nets that a signal harness carries from one sheet to another.
 *
 * Within a sheet the two ends of a harness are already one net, because both
 * entries carry the same signal key. Across sheets there is no geometry to join
 * them: each sheet names its end after whatever label its own wires carry, and
 * two different labels leave the ends looking like two nets. Matching the signal
 * keys is what shows they are one, and the surviving name is the same on every
 * sheet so that a component's pins agree with the netlist.
 *
 * Returns the renaming that was applied, empty when no harness spans sheets.
 */
const mergeHarnessSignalNets = (
  allNets: NetConnections,
  allComponents: ComponentDetails,
  signalNets: Map<string, Set<string>>,
  designedNames: ReadonlySet<string>
): Map<string, string> => {
  const renames = new Map<string, string>();

  for (const netNames of signalNets.values()) {
    if (netNames.size < 2) continue;
    // A net already folded into another group joins that group's name, so a
    // signal shared with a third sheet does not split it off again.
    const resolved = new Set([...netNames].map((name) => renames.get(name) ?? name));
    if (resolved.size < 2) continue;

    const canonical = canonicalNetName(resolved, designedNames, allNets);
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
 * Read the ChannelDesignatorFormatString from a PrjPcb file.
 * Default: "$Component_$RoomName"
 */
const readChannelFormat = async (projectPath: string): Promise<string> => {
  try {
    const content = await readFile(projectPath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*ChannelDesignatorFormatString\s*=\s*(.+)$/i);
      if (match) return match[1].trim();
    }
  } catch {
    // fall through
  }
  return "$Component_$RoomName";
};

const recordText = (record: AltiumRecord | undefined): string => {
  const value = record?.Text ?? record?.TEXT ?? record?.Name ?? record?.NAME;
  return value === undefined || value === null ? "" : String(value);
};

/**
 * Derive multi-channel sheets from a parsed schematic, for projects that ship no
 * `.PrjPcbStructure`.
 *
 * A sheet symbol (RECORD=15) owns two children that matter here: its designator
 * (RECORD=32) and the child document it instantiates (RECORD=33). When the
 * designator is a `Repeat(...)` expression, that child document is one channel
 * per repeat index.
 *
 * Altium only writes `.PrjPcbStructure` when a project has been compiled and the
 * file is frequently not committed, so relying on it alone silently collapses
 * every channel in such a project down to a single instance.
 */
export const findRepeatedSheetsInSchematic = (
  schematic: AltiumSchematic,
  sourceDocument: string
): Map<string, SheetInstance[]> => {
  const repeated = new Map<string, SheetInstance[]>();

  for (const record of flattenHierarchy(schematic)) {
    if (record.RECORD !== RECORD_TYPES.SHEET_SYMBOL) continue;

    const children = record.children ?? [];
    const schDesignator = recordText(
      children.find((child) => child.RECORD === RECORD_TYPES.SHEET_NAME)
    );
    const fileName = recordText(
      children.find((child) => child.RECORD === RECORD_TYPES.SHEET_FILE_NAME)
    );
    if (!fileName) continue;

    const designators = expandRepeatDesignator(schDesignator);
    if (designators.length === 0) continue;

    repeated.set(
      fileName.toLowerCase(),
      designators.map((designator) => ({
        sourceDocument,
        designator,
        schDesignator,
        fileName,
      }))
    );
  }

  return repeated;
};

/**
 * Render a 1-based channel number as Altium's alphabetic channel label:
 * 1 → "A", 26 → "Z", 27 → "AA".
 */
const channelAlpha = (channelIndex: number): string => {
  let n = Math.max(1, channelIndex);
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

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
  /** Signal names from Repeat() entries: per-channel */
  repeatNames: Set<string>;
  /** Signal names from non-Repeat entries: shared across channels */
  sharedNames: Set<string>;
}

/**
 * Classify SHEET_ENTRY records on the parent schematic for a given child file.
 * Repeat() entries produce per-channel nets; others are shared.
 * Bus notation (e.g., "AD[0..7]") is expanded into individual signals.
 */
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

const classifySheetEntries = (
  parentSchematic: AltiumSchematic,
  childFileName: string,
  harnessDefinitions: HarnessDefinitions = new Map(),
  nestedHarnessTypes: ReadonlyMap<string, string> = new Map()
): SheetEntryClassification => {
  const repeatNames = new Set<string>();
  const sharedNames = new Set<string>();
  const childBase = childFileName.toLowerCase();

  for (const record of parentSchematic.records) {
    if (record.RECORD !== RECORD_TYPES.SHEET_SYMBOL || !record.children) continue;

    const fileNameChild = record.children.find((c) => c.RECORD === RECORD_TYPES.SHEET_FILE_NAME);
    const fileText = fileNameChild?.Text ?? fileNameChild?.TEXT;
    if (!fileText || String(fileText).toLowerCase() !== childBase) continue;

    for (const child of record.children) {
      if (child.RECORD !== RECORD_TYPES.SHEET_ENTRY) continue;
      const rawName = String(child.Name ?? child.NAME ?? "");
      const repeatMatch = rawName.match(/^Repeat\((.+)\)$/i);

      const target = repeatMatch ? repeatNames : sharedNames;
      const entryName = repeatMatch ? repeatMatch[1] : rawName;

      for (const signal of expandBusNotation(entryName)) {
        target.add(signal);
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
          target.add(member);
          // Members are qualified by the entry that reached them
          // (PGND.OP_OUT); the leaf name is what a net inside the child sheet
          // is actually called.
          const leaf = member.slice(member.lastIndexOf(".") + 1);
          if (leaf) target.add(leaf);
        }
      }
    }

    break;
  }

  return { repeatNames, sharedNames };
};

/**
 * Expand a parsed child sheet into multiple channel instances.
 */
const expandChannels = (
  baseResult: ParsedNetlist,
  baseNets: ReturnType<typeof extractNets>,
  channels: SheetInstance[],
  channelFormat: string,
  entryClassification: SheetEntryClassification
): ParsedNetlist => {
  const netClassification = classifyNets(baseNets);
  const allNets: NetConnections = {};
  const allComponents: ComponentDetails = {};

  for (const [channelOffset, channel] of channels.entries()) {
    const roomName = channel.designator;
    const channelIndex = channelOffset + 1;

    // Classify each net for this channel:
    // 1. Power nets → global (keep name)
    // 2. Shared SHEET_ENTRY signals → global (keep name)
    // 3. Repeat SHEET_ENTRY signals → per-channel (suffix)
    // 4. Other local nets → per-channel (suffix)
    const netNameMap = new Map<string, string>();
    for (const [netName] of Object.entries(baseResult.nets)) {
      if (netClassification.powerNetNames.has(netName)) {
        netNameMap.set(netName, netName);
      } else if (entryClassification.sharedNames.has(netName)) {
        netNameMap.set(netName, netName);
      } else if (entryClassification.repeatNames.has(netName)) {
        netNameMap.set(netName, `${netName}_${roomName}`);
      } else {
        // Local net with no SHEET_ENTRY match → per-channel
        netNameMap.set(netName, `${netName}_${roomName}`);
      }
    }

    // Expand nets with renamed refdes and net names
    for (const [origNetName, connections] of Object.entries(baseResult.nets)) {
      const expandedNetName = netNameMap.get(origNetName) ?? origNetName;

      if (!allNets[expandedNetName]) {
        allNets[expandedNetName] = {};
      }

      for (const [origRefdes, pins] of Object.entries(connections)) {
        const expandedRefdes = applyChannelFormat(
          channelFormat,
          origRefdes,
          roomName,
          channelIndex
        );
        if (!allNets[expandedNetName][expandedRefdes]) {
          allNets[expandedNetName][expandedRefdes] = pins;
        } else {
          const existing = allNets[expandedNetName][expandedRefdes];
          const existingArray = Array.isArray(existing) ? existing : [existing];
          const newPins = Array.isArray(pins) ? pins : [pins];
          allNets[expandedNetName][expandedRefdes] = [...new Set([...existingArray, ...newPins])];
        }
      }
    }

    // Expand components with renamed refdes and net references
    for (const [origRefdes, component] of Object.entries(baseResult.components)) {
      const expandedRefdes = applyChannelFormat(channelFormat, origRefdes, roomName, channelIndex);

      // Deep-clone pins with mapped net names
      const expandedPins: Record<string, PinEntry> = {};
      for (const [pinNum, entry] of Object.entries(component.pins)) {
        if (typeof entry === "string") {
          expandedPins[pinNum] = netNameMap.get(entry) ?? entry;
        } else {
          expandedPins[pinNum] = {
            ...entry,
            net: netNameMap.get(entry.net) ?? entry.net,
          };
        }
      }

      allComponents[expandedRefdes] = {
        ...component,
        pins: expandedPins,
      };
    }
  }

  return { nets: allNets, components: allComponents };
};

/**
 * Parse an Altium project by parsing all its SchDoc files and merging the results.
 * Supports multi-channel expansion via PrjPCBStructure.
 */
const parseAltiumProject = async (projectPath: string): Promise<ParsedNetlist> => {
  const schdocPaths = await findAltiumSchDocs(projectPath);

  if (schdocPaths.length === 0) {
    throw new Error(`No schematic documents found for project ${projectPath}`);
  }

  // Check for multi-channel structure
  const structurePath = await findStructureFile(projectPath);
  let repeatedSheets = new Map<string, SheetInstance[]>();
  let channelFormat = "$Component_$RoomName";
  let parentSchematic: AltiumSchematic | undefined;

  // Parent schematic per repeated child document. A project may repeat different
  // sheets from different parents, and each expansion needs its own parent to
  // classify that sheet symbol's entries.
  const repeatParents = new Map<string, AltiumSchematic>();
  const repeatParentPaths = new Map<string, string>();

  if (structurePath) {
    const structureContent = await readFile(structurePath, "utf-8");
    const structure = parseProjectStructure(structureContent);
    repeatedSheets = findRepeatedSheets(structure);
    channelFormat = await readChannelFormat(projectPath);

    // Parse the top-level document to get SHEET_ENTRY Repeat() info
    if (repeatedSheets.size > 0 && structure.topLevelDocument) {
      const topLevelPath = path.resolve(
        path.dirname(projectPath),
        structure.topLevelDocument.replace(/\\/g, "/")
      );
      const buffer = readOleStream(topLevelPath);
      const schematic = readSchematicRecords(topLevelPath, buffer);
      parentSchematic = buildHierarchy(schematic);
      for (const childFile of repeatedSheets.keys()) {
        repeatParentPaths.set(childFile, topLevelPath);
      }
    }
  } else {
    // No compiled structure file: recover the channels from the sheet symbols
    // themselves. Any document may host a repeated sheet symbol, so scan them
    // all and remember which parent declared each child.
    channelFormat = await readChannelFormat(projectPath);

    for (const candidatePath of schdocPaths) {
      let hierarchical: AltiumSchematic;
      try {
        hierarchical = buildHierarchy(
          readSchematicRecords(candidatePath, readOleStream(candidatePath))
        );
      } catch {
        continue;
      }

      const found = findRepeatedSheetsInSchematic(hierarchical, path.basename(candidatePath));
      for (const [childFile, instances] of found) {
        if (repeatedSheets.has(childFile)) continue;
        repeatedSheets.set(childFile, instances);
        repeatParents.set(childFile, hierarchical);
        repeatParentPaths.set(childFile, candidatePath);
      }
    }
  }

  const allNets: NetConnections = {};
  const allComponents: ComponentDetails = {};
  const expandedFiles = new Set<string>();
  // Harness signal key -> every net name carrying it, across all sheets.
  const signalNets = new Map<string, Set<string>>();
  const designedNames = new Set<string>();
  const bundleLinks: string[][] = [];

  for (const schdocPath of schdocPaths) {
    const schdocBase = path.basename(schdocPath).toLowerCase();

    // Check if this file is a repeated (multi-channel) sheet
    const channels = repeatedSheets.get(schdocBase);
    const channelParent = repeatParents.get(schdocBase) ?? parentSchematic;
    if (channels && channels.length > 1 && channelParent) {
      if (expandedFiles.has(schdocBase)) continue;
      expandedFiles.add(schdocBase);

      // Parse the child sheet once
      const buffer = readOleStream(schdocPath);
      const schematic = readSchematicRecords(schdocPath, buffer);
      const hierarchical = buildHierarchy(schematic);
      const nets = extractNets(hierarchical);
      const parsedNets = convertNets(nets, hierarchical);
      const components = extractComponents(hierarchical);
      populatePinNets(components, parsedNets);
      const baseResult: ParsedNetlist = { nets: parsedNets, components };

      // Classify SHEET_ENTRY records: Repeat() → per-channel, others → shared
      // The bundle definitions live beside the parent document, whose sheet
      // entry declares the harness type; nesting is declared on the entry
      // records of the parent schematic.
      const parentDocument = repeatParentPaths.get(schdocBase);
      const harnessDefinitions = parentDocument
        ? await readHarnessDefinitions(parentDocument)
        : new Map();
      // Entries are nested under their connector once the parent's OwnerIndex
      // values resolve, so the whole tree has to be walked to find them.
      const nestedHarnessTypes = collectNestedHarnessTypes(
        flattenHierarchy(channelParent) as never
      );

      const entryClassification = classifySheetEntries(
        channelParent,
        channels[0].fileName,
        harnessDefinitions,
        nestedHarnessTypes
      );

      // Expand into N channel instances
      const expanded = expandChannels(
        baseResult,
        nets,
        channels,
        channelFormat,
        entryClassification
      );
      mergeResult(expanded, allNets, allComponents);
    } else {
      const document = parseAltiumDocument(schdocPath);
      mergeResult(document.netlist, allNets, allComponents);
      for (const [signal, netName] of document.harnessSignals) {
        const carriers = signalNets.get(signal) ?? new Set<string>();
        carriers.add(netName);
        signalNets.set(signal, carriers);
      }
      for (const name of document.designedNames) designedNames.add(name);
      bundleLinks.push(...document.bundleLinks);
    }
  }

  // One bundle is known by a different port name on each sheet it reaches, so
  // fold every name onto the one the whole project agrees on before matching
  // the signals up.
  const bundleNames = resolveBundleNames(bundleLinks);
  const resolvedSignalNets = new Map<string, Set<string>>();
  for (const [signal, carriers] of signalNets) {
    const { bundle, member } = splitHarnessSignalKey(signal);
    const key = harnessSignalKey(bundleNames.get(bundle) ?? bundle, member);
    const resolved = resolvedSignalNets.get(key) ?? new Set<string>();
    for (const name of carriers) resolved.add(name);
    resolvedSignalNets.set(key, resolved);
  }

  // Channel expansion renames a repeated sheet's nets per channel, so a harness
  // signal collected from one would no longer name the net that carries it.
  // Those sheets reach the rest of the design through their sheet entries,
  // which classifySheetEntries already carries the bundle's members across.
  mergeHarnessSignalNets(allNets, allComponents, resolvedSignalNets, designedNames);

  return {
    nets: allNets,
    components: allComponents,
  };
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

  parse: async (designPath: string): Promise<ParsedNetlist> => {
    const ext = path.extname(designPath).toLowerCase();
    if (ext === ".schdoc") {
      return parseAltium(designPath);
    }
    return parseAltiumProject(designPath);
  },
};
