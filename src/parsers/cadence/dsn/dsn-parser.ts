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

// --- Netlist Assembly ---

/** Union-Find for grouping connected wire endpoints by coordinate. */
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
function buildPageCoordMap(page: PageData, canonicalNetNames: Set<string>): Map<string, string> {
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
  pageIdx: number;
  coord: string; // "x,y"
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
        const coord = `${pin.pointX},${pin.pointY}`;
        const coordNet = coordToNet.get(coord);
        pins.push({ refdes, pinIdx, netId: pin.netId, pageIdx: i, coord, coordNet });
      }
    }
  }
  return pins;
}

/**
 * Disambiguate duplicate net names that appear on multiple pages.
 *
 * When the same net name appears on N pages as separate wire groups, the
 * Cadence DAT export keeps one bare and appends _<dbObjectId> to the rest.
 * The dbObjectId is a Cadence-internal net object ID not directly in the DSN,
 * but the hierarchy stream contains these suffixed names. We match page
 * groups to hierarchy suffixes using sort order: both the Cadence object IDs
 * and the page-local min pin IDs are allocated sequentially, so sorting by
 * either yields the same order.
 *
 * Mutates netIdToName in place to apply suffixed names.
 */
function disambiguateCrossPageNets(
  netIdToName: Map<number, string>,
  netIdGroups: Map<number, PinInfo[]>,
  canonicalNetNames: Set<string>
): void {
  // Group netIds by (resolvedName, pageIdx)
  const nameToPageGroups = new Map<string, Map<number, number[]>>();
  for (const [netId, name] of netIdToName) {
    if (!nameToPageGroups.has(name)) nameToPageGroups.set(name, new Map());
    const pageMap = nameToPageGroups.get(name)!;
    const pageIdx = netIdGroups.get(netId)![0].pageIdx;
    if (!pageMap.has(pageIdx)) pageMap.set(pageIdx, []);
    pageMap.get(pageIdx)!.push(netId);
  }

  for (const [name, pageMap] of nameToPageGroups) {
    if (pageMap.size <= 1) continue;

    // Find all suffixed variants in the hierarchy (e.g., GPIO0_21859572)
    const prefix = name + "_";
    const suffixedHier: { suffix: number; fullName: string }[] = [];
    for (const hierName of canonicalNetNames) {
      if (hierName.startsWith(prefix)) {
        const num = parseInt(hierName.substring(prefix.length));
        if (!isNaN(num)) suffixedHier.push({ suffix: num, fullName: hierName });
      }
    }
    if (suffixedHier.length === 0) continue;
    suffixedHier.sort((a, b) => a.suffix - b.suffix);

    // Sort page groups by min netId
    const pageGroups: { pageIdx: number; minNetId: number; netIds: number[] }[] = [];
    for (const [pageIdx, netIds] of pageMap) {
      pageGroups.push({ pageIdx, minNetId: Math.min(...netIds), netIds });
    }
    pageGroups.sort((a, b) => a.minNetId - b.minNetId);

    // Two-pointer match: hierarchy suffixes track monotonically with page min
    // netIds. The page with no matching suffix keeps the bare name.
    let si = 0;
    for (let pi = 0; pi < pageGroups.length && si < suffixedHier.length; pi++) {
      if (suffixedHier[si].suffix <= pageGroups[pi].minNetId) {
        for (const nid of pageGroups[pi].netIds) {
          netIdToName.set(nid, suffixedHier[si].fullName);
        }
        si++;
      }
    }
  }
}

/**
 * Resolve the net name for a group of pins sharing the same netId.
 * Priority: hierarchy-canonical name > majority vote > fallback N{netId}.
 */
function resolveNetIdName(netId: number, pins: PinInfo[], canonicalNetNames: Set<string>): string {
  const nameCounts = new Map<string, number>();
  for (const pin of pins) {
    if (pin.coordNet) {
      nameCounts.set(pin.coordNet, (nameCounts.get(pin.coordNet) || 0) + 1);
    }
  }
  if (nameCounts.size === 0) return `N${netId}`;

  const canonicalMatch = [...nameCounts.keys()].find((n) => canonicalNetNames.has(n));
  if (canonicalMatch) return canonicalMatch;

  return [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Classify pins into categories by netId type.
 *
 * Returns:
 * - noConnect: pins with netId=0 and no wire connection (unconnected)
 * - sentinelWired: sentinel pins (0xFFFFFFFF) touching a wire (have coordNet)
 * - sentinelWireless: sentinel pins grouped by page:coord (pin-to-pin overlaps)
 * - netIdGroups: normal pins grouped by netId
 */
function classifyPins(allPins: PinInfo[]): {
  noConnect: PinInfo[];
  sentinelWired: PinInfo[];
  sentinelWireless: Map<string, PinInfo[]>;
  netIdGroups: Map<number, PinInfo[]>;
} {
  const noConnect: PinInfo[] = [];
  const sentinelWired: PinInfo[] = [];
  const sentinelWireless = new Map<string, PinInfo[]>();
  const netIdGroups = new Map<number, PinInfo[]>();

  for (const pin of allPins) {
    if (pin.netId === 0) {
      if (!pin.coordNet) noConnect.push(pin);
    } else if (pin.netId === 0xffffffff) {
      if (pin.coordNet) {
        sentinelWired.push(pin);
      } else {
        const key = `${pin.pageIdx}:${pin.coord}`;
        if (!sentinelWireless.has(key)) sentinelWireless.set(key, []);
        sentinelWireless.get(key)!.push(pin);
      }
    } else {
      if (!netIdGroups.has(pin.netId)) netIdGroups.set(pin.netId, []);
      netIdGroups.get(pin.netId)!.push(pin);
    }
  }

  return { noConnect, sentinelWired, sentinelWireless, netIdGroups };
}

/**
 * Match pin-to-pin sentinel groups to unmatched hierarchy net names.
 *
 * Pin-to-pin connections (overlapping pins, no wire) have no net name in
 * the DSN page data. The hierarchy stream contains their canonical names
 * as N{dbObjectId} entries. After all wire-based nets are resolved, the
 * remaining unmatched N{number} hierarchy names correspond to these groups.
 *
 * Matching relies on Cadence allocating object IDs sequentially: sorting
 * hierarchy names by numeric value and groups by coordinate produces the
 * same relative order.
 */
function resolveWirelessSentinelNets(
  groups: Map<string, PinInfo[]>,
  canonicalNetNames: Set<string>,
  usedNetNames: Set<string>
): { netName: string; pins: PinInfo[] }[] {
  const multiPinGroups = [...groups.entries()]
    .filter(([, pins]) => pins.length >= 2)
    .sort(([a], [b]) => (a < b ? -1 : 1));

  if (multiPinGroups.length === 0) return [];

  const unmatchedHierNames = [...canonicalNetNames]
    .filter((n) => /^N\d+$/.test(n) && !usedNetNames.has(n))
    .sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));

  return multiPinGroups.map(([key, pins], i) => ({
    netName: i < unmatchedHierNames.length ? unmatchedHierNames[i] : `N${key.replace(":", "_")}`,
    pins,
  }));
}

/**
 * Assemble nets from collected pins.
 *
 * Pins are classified into four categories (see classifyPins), then each
 * category is resolved independently:
 * 1. No-connect pins (netId=0, no wire) -> "NC"
 * 2. Sentinel pins on wires (netId=0xFFFFFFFF, has coordNet) -> use wire name
 * 3. Normal pins (netId>0) -> group by netId, resolve name, disambiguate
 * 4. Sentinel pin-to-pin overlaps (no wire) -> match to hierarchy names
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
  const { noConnect, sentinelWired, sentinelWireless, netIdGroups } = classifyPins(allPins);

  // 1. No-connect pins
  for (const pin of noConnect) {
    addPinToNet(nets, componentPins, "NC", pin.refdes, pin.pinIdx);
  }

  // 2. Sentinel pins connected via wires
  for (const pin of sentinelWired) {
    addPinToNet(nets, componentPins, pin.coordNet!, pin.refdes, pin.pinIdx);
  }

  // 3. Normal pins: resolve names, disambiguate cross-page duplicates, assign
  const netIdToName = new Map<number, string>();
  for (const [netId, pins] of netIdGroups) {
    netIdToName.set(netId, resolveNetIdName(netId, pins, canonicalNetNames));
  }
  disambiguateCrossPageNets(netIdToName, netIdGroups, canonicalNetNames);

  for (const [netId, pins] of netIdGroups) {
    const netName = netIdToName.get(netId)!;
    for (const pin of pins) {
      addPinToNet(nets, componentPins, netName, pin.refdes, pin.pinIdx);
    }
  }

  // 4. Pin-to-pin sentinel connections (wireless overlaps)
  const wirelessNets = resolveWirelessSentinelNets(
    sentinelWireless,
    canonicalNetNames,
    new Set(Object.keys(nets))
  );
  for (const { netName, pins } of wirelessNets) {
    for (const pin of pins) {
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
  canonicalNetNames: Set<string>
): {
  nets: NetConnections;
  componentPins: Map<string, Map<string, string>>;
} {
  const pageCoordMaps = pages.map((page) => buildPageCoordMap(page, canonicalNetNames));

  // Apply cross-page OPC name equivalences (creates new maps to avoid mutation)
  const opcNameMap = buildOpcNameMap(pages, pageCoordMaps, canonicalNetNames);
  const resolvedCoordMaps =
    opcNameMap.size > 0
      ? pageCoordMaps.map((coordMap) => {
          const resolved = new Map(coordMap);
          for (const [coord, name] of resolved) {
            const mapped = opcNameMap.get(name);
            if (mapped) resolved.set(coord, mapped);
          }
          return resolved;
        })
      : pageCoordMaps;

  const allPins = collectPins(pages, resolvedCoordMaps);
  return assembleNets(allPins, canonicalNetNames);
}

/**
 * Build components from PlacedInstances and Packages.
 */
function buildComponents(
  pages: PageData[],
  packages: Map<string, Package>,
  componentPins: Map<string, Map<string, string>>
): ComponentDetails {
  const components: ComponentDetails = {};

  for (const page of pages) {
    for (const inst of page.placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;
      if (components[refdes]) continue; // already processed

      const pkg = packages.get(inst.pkgName);
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

      components[refdes] = { pins };
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

  const packages = new Map<string, Package>();

  // Build netlist from parsed data
  const { nets, componentPins } = buildNetConnectivity(pages, canonicalNetNames);
  const components = buildComponents(pages, packages, componentPins);

  return { nets, components };
}
