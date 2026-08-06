/**
 * Net Connectivity Builder
 *
 * Builds the net-to-pin mapping from parsed page data using wire graph
 * connectivity (Union-Find), net name resolution, and cross-page disambiguation.
 */

import type { NetConnections } from "../../../types.js";
import { isValidRefdes } from "../../../circuit-traversal.js";
import type { PinMapData } from "./structure-types.js";
import type { GraphicInst } from "./structures.js";
import type { PageData } from "./page-parser.js";
import { resolvePinNumber, isPinIgnored } from "./pin-resolver.js";

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

  has(x: string): boolean {
    return this.parent.has(x);
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

/**
 * Union-Find key for a global/port symbol.
 *
 * A symbol gets its own key rather than being addressed by its placement
 * origin, because that origin frequently lands exactly on a wire endpoint that
 * belongs to a *different* net. On a rail fan-out the symbols sit one grid step
 * apart while each symbol's drawn box is two steps tall, so a symbol's origin
 * routinely sits on the neighbouring rail. Keying by origin made the symbol and
 * that neighbour the same graph node, and the symbol's own attachment then
 * fused two unrelated rails into one net.
 *
 * With a key of its own a symbol performs at most one union, so it can join a
 * wire group but never bridge two.
 */
export function symbolKey(sym: Pick<GraphicInst, "pairingId" | "dbId">): string {
  return `sym:${sym.pairingId}:${sym.dbId}`;
}

/**
 * The single wire coordinate a global/port symbol is electrically attached to.
 *
 * A power symbol has one pin, so exactly one wire may touch it, but its drawn
 * bounding box covers more than that wire: on a rail fan-out it also covers the
 * rails drawn above and below. Picking whichever coordinate the iteration
 * reached first therefore attached symbols to their neighbours.
 *
 * `symbolNet` is the symbol's own net name, taken from the Library string list.
 * When it is known the choice is unambiguous: the attachment is the coordinate
 * whose wire already carries that name. Otherwise only coordinates with no name
 * of their own are eligible, since claiming an already-named wire would assert a
 * connection the drawing does not show. Among equals the origin wins, then the
 * nearest coordinate, so the result never depends on iteration order.
 */
export function chooseSymbolAttachment(
  sym: Pick<GraphicInst, "x1" | "y1" | "x2" | "y2" | "locX" | "locY">,
  symbolNet: string | undefined,
  wireCoords: Iterable<string>,
  coordNames: Map<string, Set<string>>
): string | undefined {
  const minX = Math.min(sym.x1, sym.x2);
  const maxX = Math.max(sym.x1, sym.x2);
  const minY = Math.min(sym.y1, sym.y2);
  const maxY = Math.max(sym.y1, sym.y2);
  const origin = `${sym.locX},${sym.locY}`;

  let named: string | undefined;
  let unnamed: string | undefined;
  let unnamedDist = Infinity;

  for (const coord of wireCoords) {
    const [cx, cy] = coord.split(",").map(Number);
    if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;

    const names = coordNames.get(coord);
    if (symbolNet && names?.has(symbolNet)) {
      // The symbol's own name on the wire: exact, so nothing can beat it.
      if (coord === origin) return coord;
      if (!named) named = coord;
      continue;
    }
    if (names && names.size > 0) continue; // some other net's wire

    const dist = Math.abs(cx - sym.locX) + Math.abs(cy - sym.locY);
    if (coord === origin) {
      unnamed = coord;
      unnamedDist = -1;
    } else if (dist < unnamedDist || (dist === unnamedDist && coord < unnamed!)) {
      unnamed = coord;
      unnamedDist = dist;
    }
  }

  return named ?? unnamed;
}

function addPinToNet(
  nets: NetConnections,
  componentPins: Map<string, Map<string, string>>,
  netName: string,
  refdes: string,
  pinNumber: string
): void {
  if (!nets[netName]) nets[netName] = {};
  const existing = nets[netName][refdes];
  if (!existing) {
    nets[netName][refdes] = [pinNumber];
  } else if (!existing.includes(pinNumber)) {
    existing.push(pinNumber);
  }
  if (!componentPins.has(refdes)) componentPins.set(refdes, new Map());
  componentPins.get(refdes)!.set(pinNumber, netName);
}

interface PinInfo {
  refdes: string;
  pinNumber: string;
  netId: number;
  pageIdx: number;
  coord: string; // "x,y"
  coordNet?: string;
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
 * They are registered in the Union-Find for connectivity only. `symbolNets`
 * carries their real net names, read from the Library string list, and steers
 * each symbol to the one wire it belongs to (see chooseSymbolAttachment).
 *
 * When canonicalNetNames is provided (from the Hierarchy stream), hierarchy
 * names take priority over non-hierarchy names. This resolves cross-page
 * aliases (e.g., wire alias "PWRSEL" + table "GPIO8" on the same wire;
 * hierarchy contains "PWRSEL", so it wins).
 */
function buildPageCoordMap(
  page: PageData,
  canonicalNetNames: Set<string>,
  symbolNets: Map<number, string>
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

  // Register global/port symbols (connectivity only, not naming)
  for (const sym of [...page.globals, ...page.ports]) uf.find(symbolKey(sym));

  // Candidate names per coordinate, and the minimum segmentId for auto-naming.
  // Built before the symbols are attached because the attachment rule reads it.
  const wireNames = new Map<string, Set<string>>();
  const coordMinSegId = new Map<string, number>();

  for (const wire of page.wires) {
    const s = `${wire.startX},${wire.startY}`;
    const e = `${wire.endX},${wire.endY}`;

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

    const curS = coordMinSegId.get(s);
    if (curS === undefined || wire.segmentId < curS) coordMinSegId.set(s, wire.segmentId);
    const curE = coordMinSegId.get(e);
    if (curE === undefined || wire.segmentId < curE) coordMinSegId.set(e, wire.segmentId);
  }

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

  // Connect global/port symbols to the wire graph.
  // A symbol's locXY is its placement origin, which often differs from its
  // electrical pin position, so the wire it touches is found within its
  // bounding box. Each symbol attaches to exactly one coordinate.
  for (const sym of [...page.globals, ...page.ports]) {
    const attach = chooseSymbolAttachment(
      sym,
      symbolNets.get(sym.pairingId),
      allWireCoords,
      wireNames
    );
    if (attach) uf.union(symbolKey(sym), attach);
  }

  // Connect component pin coordinates to globals and wire bodies.
  // Sentinel pins (netId=0xFFFFFFFF) on power/ground symbols have coordinates
  // inside the global's bbox but not at any wire endpoint. Match them via
  // bbox containment (for globals) and point-on-segment (for wire bodies).
  for (const inst of page.placedInstances) {
    for (const pin of inst.t0x10s) {
      const coord = `${pin.pointX},${pin.pointY}`;
      if (allWireCoords.has(coord)) continue; // already connected via wire endpoint

      // Check global/port bbox containment
      for (const sym of [...page.globals, ...page.ports]) {
        const minX = Math.min(sym.x1, sym.x2);
        const maxX = Math.max(sym.x1, sym.x2);
        const minY = Math.min(sym.y1, sym.y2);
        const maxY = Math.max(sym.y1, sym.y2);
        if (pin.pointX >= minX && pin.pointX <= maxX && pin.pointY >= minY && pin.pointY <= maxY) {
          uf.find(coord);
          uf.union(coord, symbolKey(sym));
          break;
        }
      }

      // Check wire body: point on axis-aligned segment (not at an endpoint)
      if (!uf.has(coord)) {
        for (const wire of page.wires) {
          const sx = wire.startX,
            sy = wire.startY,
            ex = wire.endX,
            ey = wire.endY;
          const onHorizontal =
            sy === ey &&
            pin.pointY === sy &&
            pin.pointX >= Math.min(sx, ex) &&
            pin.pointX <= Math.max(sx, ex);
          const onVertical =
            sx === ex &&
            pin.pointX === sx &&
            pin.pointY >= Math.min(sy, ey) &&
            pin.pointY <= Math.max(sy, ey);
          if (onHorizontal || onVertical) {
            uf.find(coord);
            uf.union(coord, `${sx},${sy}`);
            break;
          }
        }
      }
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

/** Collect all component pins across pages with their coordinate-resolved net names. */
function collectPins(
  pages: PageData[],
  pageCoordMaps: Map<string, string>[],
  pmd: PinMapData,
  deviceIndexMap: Map<number, number>,
  globalPairingNets: Map<number, string>,
  opcPairingNets: Map<number, string>
): PinInfo[] {
  const pins: PinInfo[] = [];
  for (let i = 0; i < pages.length; i++) {
    const coordToNet = pageCoordMaps[i];
    for (const inst of pages[i].placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;
      const deviceIndex = deviceIndexMap.get(inst.dbId);
      for (const pin of inst.t0x10s) {
        // A pin this section of the package has no pad for is not a pin of the
        // component; reporting it would invent a connection on a pad that does
        // not exist. Cadence leaves such pins out of its own netlist.
        if (isPinIgnored(pin, inst, pmd, deviceIndex)) continue;
        const coord = `${pin.pointX},${pin.pointY}`;
        let coordNet = coordToNet.get(coord);

        // Fallback: sentinel pins overlapping global/port power symbols.
        // These pins connect to power nets via the symbol, not via wires.
        // Match by checking if the pin coordinate falls within a symbol's
        // bounding box, then resolve the net via the symbol's pairingId.
        if (!coordNet && pin.netId === 0xffffffff) {
          for (const sym of [...pages[i].globals, ...pages[i].ports]) {
            const minX = Math.min(sym.x1, sym.x2);
            const maxX = Math.max(sym.x1, sym.x2);
            const minY = Math.min(sym.y1, sym.y2);
            const maxY = Math.max(sym.y1, sym.y2);
            if (
              pin.pointX >= minX &&
              pin.pointX <= maxX &&
              pin.pointY >= minY &&
              pin.pointY <= maxY
            ) {
              coordNet = globalPairingNets.get(sym.pairingId);
              if (coordNet) break;
            }
          }
        }

        // Fallback: sentinel pins at OPC connection points (direct pin-to-OPC,
        // no wire). Match by checking if the pin coordinate equals an OPC edge
        // midpoint, then resolve the net name via strLst[pairingId].
        if (!coordNet && pin.netId === 0xffffffff) {
          for (const opc of pages[i].offPageConnectors) {
            const minX = Math.min(opc.x1, opc.x2);
            const maxX = Math.max(opc.x1, opc.x2);
            const minY = Math.min(opc.y1, opc.y2);
            const maxY = Math.max(opc.y1, opc.y2);
            const midX = Math.round((minX + maxX) / 2);
            const midY = Math.round((minY + maxY) / 2);
            if (
              coord === `${maxX},${midY}` ||
              coord === `${minX},${midY}` ||
              coord === `${midX},${maxY}` ||
              coord === `${midX},${minY}` ||
              coord === `${opc.locX},${opc.locY}`
            ) {
              coordNet = opcPairingNets.get(opc.pairingId);
              if (coordNet) break;
            }
          }
        }

        const pinNumber = resolvePinNumber(pin, inst, pmd, deviceIndex);
        pins.push({ refdes, pinNumber, netId: pin.netId, pageIdx: i, coord, coordNet });
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
 * A candidate is only a collision rename if it clears two gates, because a
 * designer's own sibling net must never be mistaken for one:
 *
 * 1. The suffix must be entirely digits. A dbObjectId always is; `parseInt()`
 *    alone is too lenient, since it stops at the first non-digit and reads a
 *    rail-named sibling like `FOO_N_1V8` as suffix 1.
 * 2. The name must not already be some wire group's resolved name. A collision
 *    rename exists only in the hierarchy stream — it is never drawn as a wire
 *    label — so a name a page actually resolved to cannot be one. This is what
 *    catches an entirely-numeric family like `FOO_N_01/_02/_04`, which clears
 *    gate 1 on its own.
 *
 * Without both, the two-pointer condition `suffix <= minNetId` is trivially
 * true for such small suffixes, so every page group of the real `FOO_N` gets
 * renamed into a sibling: the bare net vanishes and its pins are silently
 * merged into unrelated real nets.
 *
 * Mutates netIdToName in place to apply suffixed names.
 */
export function disambiguateCrossPageNets(
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
        // Claimed by a wire group => designer-authored sibling, not a rename.
        if (nameToPageGroups.has(hierName)) continue;
        const rawSuffix = hierName.substring(prefix.length);
        // A dbObjectId is entirely digits. parseInt() alone is too lenient: it
        // stops at the first non-digit, so a rail-named sibling like `_1V8`
        // reads as suffix 1.
        if (!/^\d+$/.test(rawSuffix)) continue;
        suffixedHier.push({ suffix: parseInt(rawSuffix), fullName: hierName });
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
      if (pin.coordNet) {
        sentinelWired.push(pin); // connected via wire geometry despite no netId
      } else {
        noConnect.push(pin);
      }
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
    addPinToNet(nets, componentPins, "NC", pin.refdes, pin.pinNumber);
  }

  // 2. Sentinel pins connected via wires
  for (const pin of sentinelWired) {
    addPinToNet(nets, componentPins, pin.coordNet!, pin.refdes, pin.pinNumber);
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
      addPinToNet(nets, componentPins, netName, pin.refdes, pin.pinNumber);
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
      addPinToNet(nets, componentPins, netName, pin.refdes, pin.pinNumber);
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
export function buildNetConnectivity(
  pages: PageData[],
  canonicalNetNames: Set<string>,
  pmd: PinMapData,
  deviceIndexMap: Map<number, number>,
  strLst: string[]
): {
  nets: NetConnections;
  componentPins: Map<string, Map<string, string>>;
} {
  // A global/port symbol's pairingId indexes the Library string list, which
  // holds its net name. The symbol's own `name` field is the schematic symbol
  // type and is not the net: a symbol drawn as `VDD_1v8` may carry `CAM_CORE`,
  // and two symbols both drawn as `VCC_BAR` carry `VDD_PLL1` and `VDD_PLL2`.
  const symbolNets = new Map<number, string>();
  for (const page of pages) {
    for (const sym of [...page.globals, ...page.ports]) {
      if (symbolNets.has(sym.pairingId)) continue;
      const name = strLst[sym.pairingId];
      if (name) symbolNets.set(sym.pairingId, name.toUpperCase());
    }
  }

  const pageCoordMaps = pages.map((page) =>
    buildPageCoordMap(page, canonicalNetNames, symbolNets)
  );

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

  // Build pairingId -> net name map from global/port symbols.
  // Used as fallback for sentinel pins that overlap power/ground symbols but
  // have no direct wire connection. PairingId groups all instances of the same
  // power symbol (e.g., all GND_SIGNAL globals share one pairingId).
  //
  // The string list is the authority, exactly as it is for off-page connectors
  // below. Resolving through the symbol's wire connection instead let one page's
  // misattached symbol name the pins of every other page sharing that pairingId.
  const globalPairingNets = new Map<number, string>(symbolNets);
  for (let i = 0; i < pages.length; i++) {
    const coordMap = resolvedCoordMaps[i];
    for (const sym of [...pages[i].globals, ...pages[i].ports]) {
      if (globalPairingNets.has(sym.pairingId)) continue;
      const net = coordMap.get(symbolKey(sym));
      if (net) globalPairingNets.set(sym.pairingId, net);
    }
  }

  // Build pairingId -> net name map from OPCs.
  // Primary: resolve from Library strLst (pairingId is a strLst index for the net name).
  // Fallback: resolve from wire connections on other pages (for designs without strLst).
  const opcPairingNets = new Map<number, string>();
  for (let i = 0; i < pages.length; i++) {
    const coordMap = resolvedCoordMaps[i];
    for (const opc of pages[i].offPageConnectors) {
      if (opcPairingNets.has(opc.pairingId)) continue;
      // Try strLst first (always correct when available)
      if (opc.pairingId < strLst.length && strLst[opc.pairingId]) {
        opcPairingNets.set(opc.pairingId, strLst[opc.pairingId].toUpperCase());
        continue;
      }
      // Fallback: wire-based resolution
      const opcKey = `opc:${opc.pairingId}:${opc.dbId}`;
      const net = coordMap.get(opcKey);
      if (net) opcPairingNets.set(opc.pairingId, net);
    }
  }

  const allPins = collectPins(
    pages,
    resolvedCoordMaps,
    pmd,
    deviceIndexMap,
    globalPairingNets,
    opcPairingNets
  );
  return assembleNets(allPins, canonicalNetNames);
}
