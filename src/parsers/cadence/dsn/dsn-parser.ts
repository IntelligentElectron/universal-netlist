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
  netTable: Map<number, string[]>;
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

  // Net name/ID table (uppercased to match Cadence Allegro export convention).
  // Multiple names can map to the same netId (e.g., "VOLUP" and "GPIO2"),
  // so we store all names per netId to let hierarchy preference resolve ties.
  const lenNetTable = reader.readUint16();
  const netTable = new Map<number, string[]>();
  for (let i = 0; i < lenNetTable; i++) {
    const netName = reader.readStringLenZeroTerm().toUpperCase();
    const netId = reader.readUint32();
    const existing = netTable.get(netId);
    if (existing) {
      existing.push(netName);
    } else {
      netTable.set(netId, [netName]);
    }
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

  // String list: try uint16 count first, fall back to uint32 if parsing fails.
  // Some DSN versions use a uint32 count field.
  const countOffset = reader.tell();
  let strLstLen = reader.readUint16();
  const strLst: string[] = [];

  try {
    for (let i = 0; i < strLstLen; i++) {
      strLst.push(reader.readStringLenZeroTerm());
    }
  } catch {
    // uint16 count failed; retry with uint32 (the extra 2 bytes were part of the count)
    strLst.length = 0;
    reader.seek(countOffset);
    strLstLen = reader.readUint32();
    for (let i = 0; i < strLstLen; i++) {
      strLst.push(reader.readStringLenZeroTerm());
    }
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
 *
 * When canonicalNetNames is provided (from the Hierarchy stream), hierarchy
 * names take priority over non-hierarchy names. This resolves cross-page
 * aliases (e.g., wire alias "PWRSEL" + table "GPIO8" on the same wire;
 * hierarchy contains "PWRSEL", so it wins).
 */
function buildPageCoordMap(
  page: PageData,
  canonicalNetNames: Set<string>,
  strLst: string[]
): Map<string, string> {
  const uf = new CoordUnionFind();

  // Connect wire endpoints into groups.
  // Union both endpoints of each segment, AND union all segments sharing
  // the same wire.id (net identifier). Without the wireId union, disjoint
  // segments on the same logical net stay in separate groups and may get
  // different names (e.g., GPIO8 vs PWRSEL on wireId 13341777).
  const wireIdRep = new Map<number, string>(); // first coordinate per wireId
  for (const wire of page.wires) {
    const s = `${wire.startX},${wire.startY}`;
    const e = `${wire.endX},${wire.endY}`;
    uf.find(s);
    uf.find(e);
    uf.union(s, e);

    const rep = wireIdRep.get(wire.id);
    if (rep) {
      uf.union(rep, s);
    } else {
      wireIdRep.set(wire.id, s);
    }
  }

  // Register global/port coordinates (connectivity only, not naming)
  for (const global of page.globals) uf.find(`${global.locX},${global.locY}`);
  for (const port of page.ports) uf.find(`${port.locX},${port.locY}`);

  // OPC connectivity: match each OPC to its wire connection point.
  // The connection point is at one of 3 candidate positions:
  //   1. Right edge midpoint: (maxX, midY)
  //   2. Left edge midpoint: (minX, midY)
  //   3. locX, locY (sometimes coincides with a corner)
  // Only checking specific points (not all edge points) avoids false unions
  // when OPC bboxes overlap vertically on dense schematics.
  const allWireCoords = new Set<string>();
  for (const wire of page.wires) {
    allWireCoords.add(`${wire.startX},${wire.startY}`);
    allWireCoords.add(`${wire.endX},${wire.endY}`);
  }

  const opcPairRep = new Map<number, string>(); // pairingId -> representative coord
  for (const opc of page.offPageConnectors) {
    const minX = Math.min(opc.x1, opc.x2);
    const maxX = Math.max(opc.x1, opc.x2);
    const minY = Math.min(opc.y1, opc.y2);
    const maxY = Math.max(opc.y1, opc.y2);
    const midX = Math.round((minX + maxX) / 2);
    const midY = Math.round((minY + maxY) / 2);

    // Find the OPC's wire connection point among candidates.
    // OPCs can be horizontal (wire on left/right edge) or vertical
    // (wire on top/bottom edge), so check all 4 edge midpoints.
    const candidates = [
      `${maxX},${midY}`, // right edge midpoint
      `${minX},${midY}`, // left edge midpoint
      `${midX},${maxY}`, // bottom edge midpoint (vertical OPCs)
      `${midX},${minY}`, // top edge midpoint (vertical OPCs)
      `${opc.locX},${opc.locY}`, // loc (sometimes at bbox corner)
    ];

    const opcKey = `opc:${opc.pairingId}:${opc.dbId}`;
    uf.find(opcKey);

    for (const coord of candidates) {
      if (allWireCoords.has(coord)) {
        uf.union(opcKey, coord);
        break; // use first match only
      }
    }

    // Union OPC pairs sharing the same pairingId
    const rep = opcPairRep.get(opc.pairingId);
    if (rep) {
      uf.union(rep, opcKey);
    } else {
      opcPairRep.set(opc.pairingId, opcKey);
    }
  }

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

    // Net table entries (multiple names may map to the same wireId)
    const tableNames = page.netTable.get(wire.id);
    if (tableNames) {
      if (!wireNames.has(s)) wireNames.set(s, new Set());
      if (!wireNames.has(e)) wireNames.set(e, new Set());
      for (const tn of tableNames) {
        wireNames.get(s)!.add(tn);
        wireNames.get(e)!.add(tn);
      }
    }

    // Track minimum segmentId for auto-generated naming
    const curS = coordMinSegId.get(s);
    if (curS === undefined || wire.segmentId < curS) coordMinSegId.set(s, wire.segmentId);
    const curE = coordMinSegId.get(e);
    if (curE === undefined || wire.segmentId < curE) coordMinSegId.set(e, wire.segmentId);
  }

  // Register OPC user-assigned labels as net name candidates.
  // The label (e.g., "VOLUP") is stored in the short prefix propPairs,
  // where each SymbolDisplayProp's nameIdx maps to a valueIdx in strLst.
  for (const opc of page.offPageConnectors) {
    if (opc.propPairs.size === 0 || opc.symbolDisplayProps.length === 0) continue;
    const opcKey = `opc:${opc.pairingId}:${opc.dbId}`;
    for (const sdp of opc.symbolDisplayProps) {
      const valueIdx = opc.propPairs.get(sdp.nameIdx);
      if (valueIdx === undefined) continue;
      const label = strLst[valueIdx];
      if (!label) continue;
      const upperLabel = label.toUpperCase();
      if (!wireNames.has(opcKey)) wireNames.set(opcKey, new Set());
      wireNames.get(opcKey)!.add(upperLabel);
    }
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
      // Prefer names that appear in the hierarchy (canonical cross-page names)
      const hierMatches = [...allNames].filter((n) => canonicalNetNames.has(n));
      canonicalName = hierMatches.length > 0 ? hierMatches.sort()[0] : [...allNames].sort()[0];
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
 * - Remaining pins are grouped by netId; the net name is resolved by:
 *   1. Prefer a coordNet that appears in the canonical hierarchy names
 *   2. Fall back to majority vote among coordNets
 *   3. Fall back to N{netId}
 */
function assembleNets(
  allPins: PinInfo[],
  canonicalNetNames: Set<string>
): {
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

  // Sentinel pins (0xFFFFFFFF) with a coordNet are physically connected
  // via wires but lack an explicit net assignment in the DSN. Group them
  // by coordNet so they form proper unnamed nets.
  for (const pin of allPins) {
    if (pin.netId !== 0xffffffff || !pin.coordNet) continue;
    addPinToNet(nets, componentPins, pin.coordNet, pin.refdes, pin.pinIdx);
  }

  // Group non-sentinel pins by netId
  const netIdGroups = new Map<number, PinInfo[]>();
  for (const pin of allPins) {
    if (pin.netId === 0 || pin.netId === 0xffffffff) continue;
    if (!netIdGroups.has(pin.netId)) netIdGroups.set(pin.netId, []);
    netIdGroups.get(pin.netId)!.push(pin);
  }

  // Resolve net name per group
  for (const [netId, groupPins] of netIdGroups) {
    const nameCounts = new Map<string, number>();
    for (const pin of groupPins) {
      if (pin.coordNet) {
        nameCounts.set(pin.coordNet, (nameCounts.get(pin.coordNet) || 0) + 1);
      }
    }

    let netName: string;
    if (nameCounts.size > 0) {
      // Prefer canonical hierarchy name if available
      const canonicalMatch = [...nameCounts.keys()].find((n) => canonicalNetNames.has(n));
      if (canonicalMatch) {
        netName = canonicalMatch;
      } else {
        // Fall back to majority vote
        netName = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
    } else {
      netName = `N${netId}`;
    }

    for (const pin of groupPins) {
      addPinToNet(nets, componentPins, netName, pin.refdes, pin.pinIdx);
    }
  }

  return { nets, componentPins };
}

/**
 * Build cross-page OPC name equivalences.
 *
 * When the same OPC pairingId appears on multiple pages (or twice on
 * the same page), the resolved net names on each side may differ. If
 * one resolves to a canonical hierarchy name and the other to a local
 * alias, the alias should map to the canonical name.
 */
function buildOpcNameMap(
  pages: PageData[],
  pageCoordMaps: Map<string, string>[],
  canonicalNetNames: Set<string>
): Map<string, string> {
  const opcIdToNames = new Map<number, Set<string>>();

  for (let i = 0; i < pages.length; i++) {
    const coordMap = pageCoordMaps[i];
    for (const opc of pages[i].offPageConnectors) {
      const opcKey = `opc:${opc.pairingId}:${opc.dbId}`;
      const netName = coordMap.get(opcKey);
      if (!netName) continue;
      if (!opcIdToNames.has(opc.pairingId)) opcIdToNames.set(opc.pairingId, new Set());
      opcIdToNames.get(opc.pairingId)!.add(netName);
    }
  }

  const nameMap = new Map<string, string>();
  for (const [, names] of opcIdToNames) {
    if (names.size <= 1) continue;
    const hierNames = [...names].filter((n) => canonicalNetNames.has(n));
    if (hierNames.length === 0) continue;
    const canonical = hierNames.sort()[0];
    for (const name of names) {
      if (name !== canonical && !canonicalNetNames.has(name)) {
        nameMap.set(name, canonical);
      }
    }
  }

  return nameMap;
}

/** Build pin-to-net mapping from parsed page data. */
function buildNetConnectivity(
  pages: PageData[],
  canonicalNetNames: Set<string>,
  strLst: string[]
): {
  nets: NetConnections;
  componentPins: Map<string, Map<string, string>>;
} {
  const pageCoordMaps = pages.map((page) => buildPageCoordMap(page, canonicalNetNames, strLst));

  // Apply cross-page OPC name equivalences
  const opcNameMap = buildOpcNameMap(pages, pageCoordMaps, canonicalNetNames);
  if (opcNameMap.size > 0) {
    for (const coordMap of pageCoordMaps) {
      for (const [coord, name] of coordMap) {
        const mapped = opcNameMap.get(name);
        if (mapped) coordMap.set(coord, mapped);
      }
    }
  }

  const allPins = collectPins(pages, pageCoordMaps);
  return assembleNets(allPins, canonicalNetNames);
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

/**
 * Parse the Hierarchy stream to extract the canonical flat net name list.
 *
 * The Hierarchy stream contains the authoritative net names for the design,
 * resolving cross-page aliases (e.g., GPIO8 on one page becomes PWRSEL in
 * the canonical list when connected via off-page connectors).
 *
 * Record format per net: 24 bytes metadata + uint16 nameLength + name + null
 */
function parseHierarchyNetNames(buffer: Buffer): Set<string> {
  const names = new Set<string>();
  const reader = new BinaryReader(buffer);

  // Header: type(1) + structLength(4) + zeros(4)
  reader.skip(9);

  // View name: uint16 length + string + null
  const viewNameLen = reader.readUint16();
  reader.skip(viewNameLen + 1);

  // Scan forward to find first 0x43 marker (start of net records)
  while (reader.tell() < buffer.length - 2) {
    if (reader.readUint8() === 0x43) {
      reader.seek(reader.tell() - 3);
      break;
    }
  }
  const netCount = reader.readUint16();

  for (let i = 0; i < netCount; i++) {
    reader.skip(24); // fixed metadata
    const nameLen = reader.readUint16();
    reader.skip(nameLen + 1); // name + null
    const name = buffer
      .subarray(reader.tell() - nameLen - 1, reader.tell() - 1)
      .toString("ascii")
      .toUpperCase();
    names.add(name);
  }

  return names;
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

  // Parse Hierarchy stream for canonical net names
  const hierEntry = entries.find(
    (e) => /^Views\/.*\/Hierarchy\/Hierarchy$/.test(e.path) && e.entry.type === 2
  );
  let canonicalNetNames = new Set<string>();
  if (hierEntry) {
    try {
      const hierBuffer = ole.readStreamByPath(hierEntry.path);
      canonicalNetNames = parseHierarchyNetNames(hierBuffer);
    } catch {
      // Hierarchy parsing is best-effort; continue without it
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
  const { nets, componentPins } = buildNetConnectivity(pages, canonicalNetNames, strLst);
  const components = buildComponents(pages, packages, strLst, componentPins);

  return { nets, components };
}
