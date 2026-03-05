/**
 * DSN Parser - Top-level parser for OrCAD .DSN files
 *
 * Opens a .DSN CFBF container, parses Page and Package streams,
 * and assembles a ParsedNetlist identical to the .dat parser output.
 */

import { OleReader } from "../../ole-reader/ole-reader.js";
import { BinaryReader } from "./binary-reader.js";
import { StructureType } from "./structure-types.js";
import { FutureDataList, autoReadPrefixes, readPreamble, skipStructure } from "./generic-parser.js";
import type { Wire, PlacedInstance, GraphicInst, Package } from "./structures.js";
import {
  parseWire,
  parsePlacedInstance,
  parseGlobal,
  parsePort,
  parseOffPageConnector,
} from "./structures.js";
import { createPinEntry } from "../../../types.js";
import type { ParsedNetlist, NetConnections, ComponentDetails } from "../../../types.js";
import { isValidRefdes } from "../../../circuit-traversal.js";

// PageSettings is a fixed-size block of 156 bytes
const PAGE_SETTINGS_SIZE = 156;

/**
 * Skip a T0x34 primitive structure.
 * Layout: 9-byte header + id(4) + string + unknownInt(4) + color(4) + lineStyle(4) + lineWidth(4)
 */
function skipT0x34(reader: BinaryReader): void {
  reader.skip(9); // 1 type + 4 structLen + 4 zeros
  reader.skip(4); // id
  reader.readStringLenZeroTerm(); // unknownStr
  reader.skip(4); // unknownInt
  reader.skip(4); // color
  reader.skip(4); // lineStyle
  reader.skip(4); // lineWidth
}

/**
 * Skip a T0x35 primitive structure.
 * Layout: same as T0x34, plus uint16 len + len*4 bytes
 */
function skipT0x35(reader: BinaryReader): void {
  reader.skip(9); // 1 type + 4 structLen + 4 zeros
  reader.skip(4); // id
  reader.readStringLenZeroTerm(); // unknownStr
  reader.skip(4); // unknownInt
  reader.skip(4); // color
  reader.skip(4); // lineStyle
  reader.skip(4); // lineWidth
  const len0 = reader.readUint16();
  reader.skip(len0 * 4);
}

// --- Stream Parsers ---

interface PageData {
  name: string;
  netTable: Map<number, string>;
  wires: Wire[];
  placedInstances: PlacedInstance[];
  ports: GraphicInst[];
  globals: GraphicInst[];
  offPageConnectors: GraphicInst[];
}

/**
 * Parse a single Page stream.
 */
function parsePage(buffer: Buffer): PageData {
  const reader = new BinaryReader(buffer);

  // Page-level prefixes and preamble
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.Page);
  readPreamble(reader);
  futureData.checkpoint();

  const name = reader.readStringLenZeroTerm();
  reader.readStringLenZeroTerm(); // pageSize (skip)
  reader.skip(PAGE_SETTINGS_SIZE); // PageSettings

  // TitleBlocks
  const lenTitleBlocks = reader.readUint16();
  for (let i = 0; i < lenTitleBlocks; i++) {
    skipStructure(reader);
  }

  // T0x34s (primitive structures, no prefix/preamble)
  const lenT0x34s = reader.readUint16();
  for (let i = 0; i < lenT0x34s; i++) {
    skipT0x34(reader);
  }

  // T0x35s (primitive structures, no prefix/preamble)
  const lenT0x35s = reader.readUint16();
  for (let i = 0; i < lenT0x35s; i++) {
    skipT0x35(reader);
  }

  // Net name/ID table (uppercased to match Cadence Allegro export convention)
  const lenNetTable = reader.readUint16();
  const netTable = new Map<number, string>();
  for (let i = 0; i < lenNetTable; i++) {
    const netName = reader.readStringLenZeroTerm().toUpperCase();
    const netId = reader.readUint32();
    netTable.set(netId, netName);
  }

  // Wires
  const lenWires = reader.readUint16();
  const wires: Wire[] = [];
  for (let i = 0; i < lenWires; i++) {
    wires.push(parseWire(reader));
  }

  // PlacedInstances
  const lenPlacedInstances = reader.readUint16();
  const placedInstances: PlacedInstance[] = [];
  for (let i = 0; i < lenPlacedInstances; i++) {
    placedInstances.push(parsePlacedInstance(reader));
  }

  // Ports
  const lenPorts = reader.readUint16();
  const ports: GraphicInst[] = [];
  for (let i = 0; i < lenPorts; i++) {
    ports.push(parsePort(reader));
    reader.skip(5); // 5 unknown bytes after each Port
  }

  // Globals
  const lenGlobals = reader.readUint16();
  const globals: GraphicInst[] = [];
  for (let i = 0; i < lenGlobals; i++) {
    globals.push(parseGlobal(reader));
    reader.skip(5); // 5 unknown bytes after each Global
  }

  // OffPageConnectors
  const lenOffPageConnectors = reader.readUint16();
  const offPageConnectors: GraphicInst[] = [];
  for (let i = 0; i < lenOffPageConnectors; i++) {
    offPageConnectors.push(parseOffPageConnector(reader));
    reader.skip(5); // 5 unknown bytes after each OffPageConnector
  }

  // Remaining sections (ERC, bus entries, graphics, etc.) are skipped

  return { name, netTable, wires, placedInstances, ports, globals, offPageConnectors };
}

/**
 * Parse the Library stream to extract the string list.
 * The string list is used to resolve SymbolDisplayProp nameIdx values.
 */
function parseLibraryStrLst(buffer: Buffer): string[] {
  const reader = new BinaryReader(buffer);

  // Introduction: 32-byte zero-padded string
  reader.skip(32);

  // Version
  reader.skip(2); // versionMajor
  reader.skip(2); // versionMinor

  // Dates
  reader.skip(4); // createDate
  reader.skip(4); // modifyDate

  // 4 bytes assumed zero
  reader.skip(4);

  // Text fonts: uint16 count, then (count-1) LOGFONTA structs
  // LOGFONTA is a Windows struct; from the C++ code we need to figure out its size.
  // Each LOGFONTA: 28 bytes of fixed fields + 32 bytes face name = 60 bytes
  const textFontLen = reader.readUint16();
  if (textFontLen > 0) {
    reader.skip((textFontLen - 1) * 60);
  }

  // someLen (always 24) + 24 x uint16
  const someLen = reader.readUint16();
  reader.skip(someLen * 2);

  // 4 + 4 bytes unknown
  reader.skip(8);

  // 8 part field strings
  for (let i = 0; i < 8; i++) {
    reader.readStringLenZeroTerm();
  }

  // PageSettings
  reader.skip(PAGE_SETTINGS_SIZE);

  // String list: uint16 or uint32 length depending on version
  // Try uint16 first (most common)
  const strLstLen = reader.readUint16();
  const strLst: string[] = [];

  for (let i = 0; i < strLstLen; i++) {
    strLst.push(reader.readStringLenZeroTerm());
  }

  return strLst;
}

// --- Netlist Assembly ---

/**
 * Build pin-to-net mapping using T0x10 net IDs with coordinate-based name resolution.
 *
 * Strategy: Each T0x10 pin instance has a netId (Cadence database net object ID).
 * Pins sharing the same netId are on the same net. The net name is resolved by:
 * 1. Matching pin coordinates to wire endpoints/globals/ports (for named nets)
 * 2. Synthesizing N{netId} for unnamed nets (matching Cadence's convention)
 *
 * This replaces pure coordinate matching, which suffered from cross-page
 * coordinate collisions and couldn't handle unnamed wires.
 */
/**
 * Simple Union-Find for grouping connected wire endpoints by coordinate.
 */
class CoordUnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let curr = x;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  groups(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!result.has(root)) result.set(root, []);
      result.get(root)!.push(key);
    }
    return result;
  }
}

function addPinToNet(
  nets: NetConnections,
  componentPins: Map<string, Map<string, string>>,
  netName: string,
  refdes: string,
  pinIdx: number
): void {
  const pinNumber = String(pinIdx + 1);
  if (!nets[netName]) nets[netName] = {};
  const existing = nets[netName][refdes];
  if (!existing) {
    nets[netName][refdes] = pinNumber;
  } else if (Array.isArray(existing)) {
    if (!existing.includes(pinNumber)) existing.push(pinNumber);
  } else if (existing !== pinNumber) {
    nets[netName][refdes] = [existing, pinNumber];
  }
  if (!componentPins.has(refdes)) componentPins.set(refdes, new Map());
  componentPins.get(refdes)!.set(pinNumber, netName);
}

/**
 * Build a coordinate -> net name map for a single page using wire graph connectivity.
 *
 * Wire endpoints are grouped via Union-Find so a net name on any wire in a
 * connected group propagates to all endpoints. Name resolution rules:
 *
 * 1. All wire aliases and net table entries are collected as candidates.
 * 2. When a group has multiple candidate names, the alphabetically first name
 *    wins (matches Cadence CIS export behavior).
 * 3. Unnamed groups get a synthesized N{minSegmentId} name, matching the
 *    auto-generated naming convention in Cadence's DAT export.
 *
 * Global/port/OPC symbols are NOT used for naming: their `.name` field is the
 * schematic symbol type (e.g. "VCC_BAR", "GND_SIGNAL"), not the net name.
 * They are registered in the Union-Find for connectivity only.
 */
function buildPageCoordMap(page: PageData): Map<string, string> {
  const uf = new CoordUnionFind();

  // Connect wire endpoints into groups
  for (const wire of page.wires) {
    const s = `${wire.startX},${wire.startY}`;
    const e = `${wire.endX},${wire.endY}`;
    uf.find(s);
    uf.find(e);
    uf.union(s, e);
  }

  // Register global/port/OPC coordinates (connectivity only, not naming)
  for (const global of page.globals) uf.find(`${global.locX},${global.locY}`);
  for (const port of page.ports) uf.find(`${port.locX},${port.locY}`);
  for (const opc of page.offPageConnectors) uf.find(`${opc.locX},${opc.locY}`);

  // Collect all candidate names and minimum segmentId per coordinate
  const wireNames = new Map<string, Set<string>>();
  const coordMinSegId = new Map<string, number>();

  for (const wire of page.wires) {
    const s = `${wire.startX},${wire.startY}`;
    const e = `${wire.endX},${wire.endY}`;

    // Aliases
    for (const alias of wire.aliases) {
      const name = alias.name.toUpperCase();
      if (!wireNames.has(s)) wireNames.set(s, new Set());
      if (!wireNames.has(e)) wireNames.set(e, new Set());
      wireNames.get(s)!.add(name);
      wireNames.get(e)!.add(name);
    }

    // Net table entry
    const tableName = page.netTable.get(wire.id);
    if (tableName) {
      if (!wireNames.has(s)) wireNames.set(s, new Set());
      if (!wireNames.has(e)) wireNames.set(e, new Set());
      wireNames.get(s)!.add(tableName);
      wireNames.get(e)!.add(tableName);
    }

    // Track minimum segmentId for auto-generated naming
    const curS = coordMinSegId.get(s);
    if (curS === undefined || wire.segmentId < curS) coordMinSegId.set(s, wire.segmentId);
    const curE = coordMinSegId.get(e);
    if (curE === undefined || wire.segmentId < curE) coordMinSegId.set(e, wire.segmentId);
  }

  // Resolve one canonical name per connected wire group
  const coordToNet = new Map<string, string>();
  for (const [, members] of uf.groups()) {
    const allNames = new Set<string>();
    for (const m of members) {
      const names = wireNames.get(m);
      if (names) for (const n of names) allNames.add(n);
    }

    let canonicalName: string;
    if (allNames.size > 0) {
      canonicalName = [...allNames].sort()[0];
    } else {
      // Unnamed wire group: use minimum segmentId (matches Cadence DAT export)
      let minSegId = Infinity;
      for (const m of members) {
        const segId = coordMinSegId.get(m);
        if (segId !== undefined && segId < minSegId) minSegId = segId;
      }
      if (minSegId === Infinity) continue;
      canonicalName = `N${minSegId}`;
    }

    for (const m of members) {
      coordToNet.set(m, canonicalName);
    }
  }

  return coordToNet;
}

interface PinInfo {
  refdes: string;
  pinIdx: number;
  netId: number;
  coordNet?: string;
}

/** Collect all component pins across pages with their coordinate-resolved net names. */
function collectPins(pages: PageData[], pageCoordMaps: Map<string, string>[]): PinInfo[] {
  const pins: PinInfo[] = [];
  for (let i = 0; i < pages.length; i++) {
    const coordToNet = pageCoordMaps[i];
    for (const inst of pages[i].placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;
      for (let pinIdx = 0; pinIdx < inst.t0x10s.length; pinIdx++) {
        const pin = inst.t0x10s[pinIdx];
        const coordNet = coordToNet.get(`${pin.pointX},${pin.pointY}`);
        pins.push({ refdes, pinIdx, netId: pin.netId, coordNet });
      }
    }
  }
  return pins;
}

/**
 * Assemble nets from collected pins.
 *
 * - netId=0 pins without a coordinate match are mapped to "NC" (no-connect).
 * - netId=0xFFFFFFFF pins are skipped (sentinel).
 * - Remaining pins are grouped by netId; the most common coordNet in each
 *   group becomes the net name, falling back to N{netId} when no coordinate
 *   match exists.
 */
function assembleNets(allPins: PinInfo[]): {
  nets: NetConnections;
  componentPins: Map<string, Map<string, string>>;
} {
  const nets: NetConnections = {};
  const componentPins = new Map<string, Map<string, string>>();

  // netId=0: unconnected pins -> NC
  for (const pin of allPins) {
    if (pin.netId !== 0) continue;
    if (pin.coordNet) continue;
    addPinToNet(nets, componentPins, "NC", pin.refdes, pin.pinIdx);
  }

  // Group non-sentinel pins by netId
  const netIdGroups = new Map<number, PinInfo[]>();
  for (const pin of allPins) {
    if (pin.netId === 0 || pin.netId === 0xffffffff) continue;
    if (!netIdGroups.has(pin.netId)) netIdGroups.set(pin.netId, []);
    netIdGroups.get(pin.netId)!.push(pin);
  }

  // Resolve net name per group: majority vote on coordNet, fallback to N{netId}
  for (const [netId, groupPins] of netIdGroups) {
    const nameCounts = new Map<string, number>();
    for (const pin of groupPins) {
      if (pin.coordNet) {
        nameCounts.set(pin.coordNet, (nameCounts.get(pin.coordNet) || 0) + 1);
      }
    }

    const netName =
      nameCounts.size > 0
        ? [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : `N${netId}`;

    for (const pin of groupPins) {
      addPinToNet(nets, componentPins, netName, pin.refdes, pin.pinIdx);
    }
  }

  return { nets, componentPins };
}

/** Build pin-to-net mapping from parsed page data. */
function buildNetConnectivity(pages: PageData[]): {
  nets: NetConnections;
  componentPins: Map<string, Map<string, string>>;
} {
  const pageCoordMaps = pages.map(buildPageCoordMap);
  const allPins = collectPins(pages, pageCoordMaps);
  return assembleNets(allPins);
}

/**
 * Build components from PlacedInstances and Packages.
 */
function buildComponents(
  pages: PageData[],
  packages: Map<string, Package>,
  strLst: string[],
  componentPins: Map<string, Map<string, string>>
): ComponentDetails {
  const components: ComponentDetails = {};

  for (const page of pages) {
    for (const inst of page.placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;
      if (components[refdes]) continue; // already processed

      const pkg = packages.get(inst.pkgName);

      // Extract properties from SymbolDisplayProps using strLst
      let mpn: string | undefined;
      let description: string | undefined;
      let value: string | undefined;

      for (const prop of inst.symbolDisplayProps) {
        const propName = strLst[prop.nameIdx];
        if (!propName) continue;

        // We don't have the prop value directly from SymbolDisplayProp;
        // the value would need to come from the name/value mapping pairs
        // in the short prefix. For now, we extract what we can from packages.
      }

      // Get pin names from package device data
      const pinNets = componentPins.get(refdes);
      const pins: Record<string, import("../../../types.js").PinEntry> = {};

      if (pkg) {
        // Find the device matching this refdes
        for (const device of pkg.devices) {
          if (device.refDes === refdes || device.refDes === pkg.refDes) {
            for (let i = 0; i < device.pinMap.length; i++) {
              const pinName = device.pinMap[i];
              if (pinName === null) continue;
              const pinNumber = String(i + 1);
              const netName = pinNets?.get(pinNumber) ?? "";
              pins[pinNumber] = createPinEntry(pinNumber, pinName, netName);
            }
          }
        }
      }

      // If no package data, still populate pins from connectivity
      if (Object.keys(pins).length === 0 && pinNets) {
        for (const [pinNumber, netName] of pinNets) {
          pins[pinNumber] = netName;
        }
      }

      const component: ComponentDetails[string] = { pins };
      if (mpn) component.mpn = mpn;
      if (description) component.description = description;
      if (value) component.value = value;

      components[refdes] = component;
    }
  }

  return components;
}

// --- Public API ---

/**
 * Parse a .DSN file into a ParsedNetlist.
 */
export function parseDsnFile(dsnPath: string): ParsedNetlist {
  const ole = new OleReader(dsnPath);
  const entries = ole.listAllEntries();

  // Parse Library stream for string list
  const libraryEntry = entries.find((e) => e.path === "Library");
  let strLst: string[] = [];
  if (libraryEntry) {
    try {
      const libraryBuffer = ole.readStreamByPath("Library");
      strLst = parseLibraryStrLst(libraryBuffer);
    } catch {
      // Library parsing is best-effort; continue without it
    }
  }

  // Parse all Page streams
  const pageEntries = entries.filter(
    (e) => /^Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2
  );

  const pages: PageData[] = [];
  for (const pageEntry of pageEntries) {
    const pageBuffer = ole.readStreamByPath(pageEntry.path);
    pages.push(parsePage(pageBuffer));
  }

  // Package data: the Packages/ directory in the CFBF container is empty for
  // this fixture. Package info (pin names, footprints) will be added later
  // if needed. For now, we build components from PlacedInstances only.
  const packages = new Map<string, Package>();

  // Build netlist from parsed data
  const { nets, componentPins } = buildNetConnectivity(pages);
  const components = buildComponents(pages, packages, strLst, componentPins);

  return { nets, components };
}
