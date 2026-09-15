/**
 * One schematic document: its records, and the netlist and cross-sheet claims it makes.
 */

import path from "path";
import type { NetConnections, ComponentDetails, ParsedNetlist } from "../../types.js";
import { readOleStream, readOptionalOleStream } from "../ole-reader/ole-reader.js";
import { RECORD_TYPES, type AltiumNet, type AltiumSchematic, type NetNameSource } from "./types.js";
import {
  buildHierarchy,
  field,
  fieldText,
  flattenHierarchy,
  ownerIndex,
  parseRecords,
} from "./records.js";
import { assignHarnessSignals, readHarnessConnectors } from "./harness.js";
import { extractComponents, pinDesignator, pinNumber } from "./components.js";
import { extractNets } from "./net-extractor.js";
import { NAME_FROM_ANY, type NetNamingOptions } from "./net-naming.js";
import { collectNetLinks, type NetLinkGroup } from "./links.js";
import { applyNetRenames, reconcileNetlist } from "./netlist.js";
import { noNetIdentifiers, type NetIdentifierKinds } from "./net-scoping.js";

/** A document's records, read once. */
export interface ReadDocument {
  path: string;
  /** Lower-case file name, which is how sheet symbols refer to the document. */
  name: string;
  /** Bundle identities the document's harnesses join, each group one bundle. */
  bundleLinks: string[][];
  hierarchical: AltiumSchematic;
}

/**
 * Read a `.SchDoc`: its `FileHeader` records and, from the `Additional` stream, its
 * harness records. `OwnerIndex` in `Additional` counts that stream's own records, so it
 * is shifted past the `FileHeader` records the two lists are joined after.
 */
export const readDocument = (schdocPath: string): ReadDocument => {
  const schematic = parseRecords(readOleStream(schdocPath));
  const additional = readOptionalOleStream(schdocPath, "Additional");
  const extra = additional && additional.length > 0 ? parseRecords(additional).records : [];

  let bundleLinks: string[][] = [];
  if (extra.length > 0) {
    bundleLinks = assignHarnessSignals(
      readHarnessConnectors(extra),
      schematic.records,
      extra.filter((record) => record.RECORD === RECORD_TYPES.SIGNAL_HARNESS)
    );
    for (const record of extra) {
      const owner = ownerIndex(record);
      if (owner === undefined || !Number.isFinite(owner)) continue;
      record.OwnerIndex = String(schematic.records.length + owner);
      delete record.OWNERINDEX;
    }
  }

  return {
    path: schdocPath,
    name: path.basename(schdocPath).toLowerCase(),
    bundleLinks,
    hierarchical: buildHierarchy({
      header: schematic.header,
      records: [...schematic.records, ...extra],
    }),
  };
};

/** One document, parsed as one instance. */
export interface ParsedDocument {
  /** Lower-case file name. */
  name: string;
  /** The instance the document is read as; see `DocumentInstance.key`. */
  placement: string;
  netlist: ParsedNetlist;
  nets: AltiumNet[];
  /** Cross-sheet identity claims, one group per net. */
  links: NetLinkGroup[];
  /** Where each net name came from. */
  nameSources: Map<string, NetNameSource>;
  bundleLinks: string[][];
  /** The identifier kinds each named net carries. */
  netIdentifiers: Map<string, NetIdentifierKinds>;
  /** The `SheetNumber` document parameter. */
  sheetNumber?: string;
  hasSheetEntries: boolean;
  hasPorts: boolean;
}

/**
 * A document's `SheetNumber` parameter: a number, on the document itself or on its
 * `SHEET` record. An unnumbered sheet writes `*`.
 */
export const readSheetNumber = (schematic: AltiumSchematic): string | undefined => {
  const documentScope = schematic.records.flatMap((record) =>
    record.RECORD === RECORD_TYPES.SHEET ? [record, ...(record.children ?? [])] : [record]
  );
  for (const record of documentScope) {
    if (record.RECORD !== RECORD_TYPES.PARAMETER) continue;
    if (fieldText(record, "Name")?.toLowerCase() !== "sheetnumber") continue;
    const value = fieldText(record, "Text")?.trim();
    if (value && /^\d+$/.test(value)) return value;
  }
  return undefined;
};

/** A sheet's nets as `net -> designator -> pins`. A net with no pins, or one lone pin, is left out. */
const netConnections = (nets: AltiumNet[], schematic: AltiumSchematic): NetConnections => {
  const connections: NetConnections = {};
  for (const net of nets) {
    const pins = net.devices.filter((device) => device.RECORD === RECORD_TYPES.PIN);
    if (!net.name || (pins.length === 1 && pins.length === net.devices.length)) continue;
    const byRefdes: Record<string, string[]> = {};
    for (const pin of pins) {
      const refdes = pinDesignator(pin, schematic);
      const number = pinNumber(pin);
      if (!refdes || !number) continue;
      const listed = (byRefdes[refdes] ??= []);
      if (!listed.includes(number)) listed.push(number);
    }
    if (Object.keys(byRefdes).length > 0) connections[net.name] = byRefdes;
  }
  return connections;
};

/** Put each component pin on the net that lists it. */
const placePins = (components: ComponentDetails, nets: NetConnections): void => {
  for (const [netName, connections] of Object.entries(nets)) {
    for (const [refdes, pins] of Object.entries(connections)) {
      const component = components[refdes];
      for (const pin of component ? pins : []) {
        const entry = component.pins[pin];
        if (entry === undefined || entry === "") component.pins[pin] = netName;
        else if (typeof entry !== "string" && entry.net === "") entry.net = netName;
      }
    }
  }
};

/** The identifier kinds on each named net, pinless nets included. */
const collectNetIdentifiers = (nets: AltiumNet[]): Map<string, NetIdentifierKinds> => {
  const identifiers = new Map<string, NetIdentifierKinds>();
  for (const net of nets) {
    if (!net.name) continue;
    const kinds = noNetIdentifiers();
    for (const device of net.devices) {
      if (device.RECORD === RECORD_TYPES.PORT) kinds.port = true;
      else if (device.RECORD === RECORD_TYPES.SHEET_ENTRY) kinds.entry = true;
      else if (device.RECORD === RECORD_TYPES.POWER_PORT) kinds.powerPort = true;
      else if (device.RECORD === RECORD_TYPES.NET_LABEL) kinds.label = true;
      else if (device.RECORD === RECORD_TYPES.HARNESS_ENTRY) kinds.harness = true;
    }
    if (net.nameSource === "harness") kinds.harness = true;
    for (const { device } of net.busCarriers ?? []) {
      if (device.RECORD === RECORD_TYPES.HARNESS_ENTRY || field(device, "HarnessType"))
        kinds.harness = true;
      else if (device.RECORD === RECORD_TYPES.PORT) kinds.port = true;
      else if (device.RECORD === RECORD_TYPES.SHEET_ENTRY) kinds.entry = true;
    }
    identifiers.set(net.name, kinds);
  }
  return identifiers;
};

/** Parse a document as the instance `placement`. */
export const parseDocument = (
  read: ReadDocument,
  naming: NetNamingOptions = NAME_FROM_ANY,
  placement: string = read.name
): ParsedDocument => {
  const schematic = read.hierarchical;
  const nets = extractNets(schematic, naming);
  const connections = netConnections(nets, schematic);
  const components = extractComponents(schematic);
  placePins(components, connections);
  reconcileNetlist({ nets: connections, components });

  const nameSources = new Map<string, NetNameSource>();
  for (const { name, nameSource } of nets)
    if (name && nameSource) nameSources.set(name, nameSource);

  const records = flattenHierarchy(schematic);
  return {
    name: read.name,
    placement,
    netlist: { nets: connections, components },
    nets,
    links: collectNetLinks(nets, schematic, connections),
    nameSources,
    bundleLinks: read.bundleLinks,
    netIdentifiers: collectNetIdentifiers(nets),
    sheetNumber: readSheetNumber(schematic),
    hasSheetEntries: records.some((record) => record.RECORD === RECORD_TYPES.SHEET_ENTRY),
    hasPorts: records.some((record) => record.RECORD === RECORD_TYPES.PORT),
  };
};

/** Rename a document's nets and every name referring to them; nets renamed alike merge. */
export const renameDocumentNets = (
  document: ParsedDocument,
  renames: ReadonlyMap<string, string>,
  ranks: Readonly<Record<NetNameSource, number>>
): void => {
  if (renames.size === 0) return;
  const rename = (name: string): string => renames.get(name) ?? name;
  applyNetRenames(document.netlist, renames);
  const nameSources = new Map<string, NetNameSource>();
  for (const [name, source] of document.nameSources) {
    const known = nameSources.get(rename(name));
    nameSources.set(
      rename(name),
      known !== undefined && ranks[known] < ranks[source] ? known : source
    );
  }
  document.nameSources = nameSources;
  const netIdentifiers = new Map<string, NetIdentifierKinds>();
  for (const [name, kinds] of document.netIdentifiers) {
    const known = netIdentifiers.get(rename(name)) ?? noNetIdentifiers();
    netIdentifiers.set(rename(name), {
      port: known.port || kinds.port,
      entry: known.entry || kinds.entry,
      powerPort: known.powerPort || kinds.powerPort,
      label: known.label || kinds.label,
      harness: known.harness || kinds.harness,
    });
  }
  document.netIdentifiers = netIdentifiers;
  for (const group of document.links) {
    if (group.net) group.net = rename(group.net);
    if (group.name) group.name = rename(group.name);
  }
};
