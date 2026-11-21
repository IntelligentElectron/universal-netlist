/**
 * Page Wire Groups
 *
 * Resolves one page's wiring into named groups: which coordinates and symbols
 * are one net, what that net is called, and, on a page that is one placement
 * of a hierarchical block, which of the placement's ports each group is on.
 */

import type { PageData } from "./page-parser.js";
import type { GraphicInst } from "./structures.js";
import { CoordUnionFind } from "./coord-union-find.js";
import { parseBusName } from "./bus-name.js";
import { symbolKey } from "./symbol-attachment.js";

/**
 * The name Capture gives a net nobody named: `N` and the segment id, padded to
 * five digits. Its flat net list and DAT export both write it this way.
 */
function autoNetName(segmentId: number): string {
  return `N${String(segmentId).padStart(5, "0")}`;
}

/** Which of a placement's hierarchical ports a wire group belongs to. */
export interface PortMembership {
  /** The port's name as the placement's `ports` map keys it. */
  port: string;
  /** For a member of a bus port, the member's index within the bus. */
  index?: number;
}

/** One connected wire group of a page. */
export interface WireGroup {
  /** The name reported for the group: `base`, suffixed when local to a placement. */
  name: string;
  /** The name the drawing gives the group, before any placement suffix. */
  base: string;
  /** One coordinate of the group, to address it by. */
  rep: string;
  /** The lowest SchematicNet id among the group's wires, unshifted. */
  netId: number | undefined;
  /** Set when the group is on one of the placement's hierarchical ports. */
  port?: PortMembership;
}

/** A page's resolved wire groups. */
export interface PageCoordMap {
  /** Coordinate or symbol key to the net name of the wire group it is in. */
  coordToNet: Map<string, string>;
  /** Coordinate or symbol key to the wire group it is in. */
  groups: Map<string, WireGroup>;
  /** Unsuffixed name to the wire group that carries it. */
  byBase: Map<string, WireGroup>;
  /**
   * Which bus port of the placement a name is a member of, or undefined: the
   * answer for a member that no wire on this page carries.
   */
  busMemberOf: (base: string) => PortMembership | undefined;
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
 * 3. Unnamed groups get a synthesized N{minSegmentId} name, zero-padded to
 *    five digits, matching the auto-generated naming in Cadence's DAT export.
 *
 * Global/port/OPC symbols are NOT used for naming: their `.name` field is the
 * schematic symbol type (e.g. "VCC_BAR", "GND_SIGNAL"), not the net name.
 * They are registered in the Union-Find for connectivity only, each joined to
 * the wire its trailer names. `symbolNets` carries their real net names, read
 * from the Library string list.
 *
 * When canonicalNetNames is provided (from the Hierarchy stream), hierarchy
 * names take priority over non-hierarchy names. This resolves cross-page
 * aliases (e.g., wire alias "PWRSEL" + table "GPIO8" on the same wire;
 * hierarchy contains "PWRSEL", so it wins).
 *
 * On a page that is one placement of a hierarchical block, a wire group is
 * one of three things. A group on a hierarchical port keeps the port's net
 * and records which port, so the pins on it can be joined to the parent's net
 * (see collectPins): a group attached to a port symbol is on that port, and a
 * group named as a member of a bus port, `DATA3` for the port `DATA[7:0]`, is
 * on that port's member, since Capture's bus members connect by name and the
 * bus entries that draw them are not parsed. A group attached to a global
 * symbol is a power net the whole design shares and keeps its name. Every
 * other group is local to the placement and gets the placement's suffix, which
 * is how two placements of one drawing report two nets rather than one.
 */
export function buildPageCoordMap(
  page: PageData,
  canonicalNetNames: Set<string>,
  symbolNets: Map<number, string>
): PageCoordMap {
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
  const coordMinWireId = new Map<string, number>();

  for (const wire of page.wires) {
    const s = `${wire.startX},${wire.startY}`;
    const e = `${wire.endX},${wire.endY}`;
    for (const coord of [s, e]) {
      const cur = coordMinWireId.get(coord);
      if (cur === undefined || wire.id < cur) coordMinWireId.set(coord, wire.id);
    }

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

  // A connector's trailer names the wire at its connection point (§7.10, §7.11),
  // so it joins that wire's group. A trailer naming no wire (id 0) means no wire
  // touches the connector; pins on it are matched below.
  const wireEnd = new Map<number, string>();
  for (const wire of page.wires) wireEnd.set(wire.segmentId, `${wire.startX},${wire.startY}`);
  const attach = (key: string, sym: GraphicInst) => {
    uf.find(key);
    const coord = sym.wireId ? wireEnd.get(sym.wireId) : undefined;
    if (coord) uf.union(key, coord);
  };

  // Off-page connectors sharing a pairingId are one net.
  const opcPairRep = new Map<number, string>(); // pairingId -> representative key
  for (const opc of page.offPageConnectors) {
    const opcKey = `opc:${opc.pairingId}:${opc.dbId}`;
    attach(opcKey, opc);
    const rep = opcPairRep.get(opc.pairingId);
    if (rep) uf.union(rep, opcKey);
    else opcPairRep.set(opc.pairingId, opcKey);
  }

  for (const sym of [...page.globals, ...page.ports]) attach(symbolKey(sym), sym);

  const allWireCoords = new Set<string>();
  for (const wire of page.wires) {
    allWireCoords.add(`${wire.startX},${wire.startY}`);
    allWireCoords.add(`${wire.endX},${wire.endY}`);
  }

  // Connect component pin coordinates to globals and wire bodies.
  // Sentinel pins (netId=0xFFFFFFFF) on power/ground symbols have coordinates
  // inside the global's bbox but not at any wire endpoint. Match them via
  // bbox containment (for globals) and point-on-segment (for wire bodies).
  // A hierarchical block's pins are wired exactly like a part's, and the
  // placement they open reads its parent net off this same map.
  const pins = [
    ...page.placedInstances.flatMap((inst) => inst.t0x10s),
    ...page.drawnInstances.flatMap((drawn) => drawn.pins),
  ];
  {
    for (const pin of pins) {
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

  // What a placement's groups attach to: a hierarchical port, by the net name
  // the Library string list gives its symbol or by membership of a bus port's
  // range, or a global.
  const portByKey = new Map<string, string>();
  const busMembers = new Map<string, PortMembership>();
  const globalKeys = new Set<string>();
  if (page.placement) {
    for (const sym of page.ports) {
      const portName = symbolNets.get(sym.pairingId);
      if (portName !== undefined && page.placement.ports.has(portName)) {
        portByKey.set(symbolKey(sym), portName);
      }
    }
    for (const port of page.placement.ports.keys()) {
      const bus = parseBusName(port);
      if (!bus) continue;
      for (const index of bus.indices) busMembers.set(bus.base + index, { port, index });
    }
    for (const sym of page.globals) globalKeys.add(symbolKey(sym));
  }
  const busMemberOf = (base: string): PortMembership | undefined => busMembers.get(base);

  // Resolve one canonical name per connected wire group
  const coordToNet = new Map<string, string>();
  const groups = new Map<string, WireGroup>();
  const byBase = new Map<string, WireGroup>();
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
      canonicalName = autoNetName(minSegId);
    }

    let netId: number | undefined;
    for (const m of members) {
      const id = coordMinWireId.get(m);
      if (id !== undefined && (netId === undefined || id < netId)) netId = id;
    }

    const group: WireGroup = {
      name: canonicalName,
      base: canonicalName,
      rep: members[0],
      netId,
    };
    if (page.placement) {
      let port: PortMembership | undefined;
      for (const m of members) {
        const name = portByKey.get(m);
        if (name !== undefined) {
          port = { port: name };
          break;
        }
      }
      for (const name of allNames) if (port === undefined) port = busMembers.get(name);
      if (port !== undefined) {
        group.port = port;
      } else if (!members.some((m) => globalKeys.has(m))) {
        group.name += page.placement.suffix;
      }
    }

    for (const m of members) {
      coordToNet.set(m, group.name);
      groups.set(m, group);
    }
    for (const name of allNames) if (!byBase.has(name)) byBase.set(name, group);
    if (!byBase.has(group.base)) byBase.set(group.base, group);
  }

  return { coordToNet, groups, byBase, busMemberOf };
}

/** A copy of the page map with every group's names passed through `rename`. */
export function renameGroups(map: PageCoordMap, rename: (name: string) => string): PageCoordMap {
  const renamed = new Map<WireGroup, WireGroup>();
  const of = (group: WireGroup): WireGroup => {
    let copy = renamed.get(group);
    if (!copy) {
      copy = { ...group, name: rename(group.name), base: rename(group.base) };
      renamed.set(group, copy);
    }
    return copy;
  };
  const groups = new Map<string, WireGroup>();
  for (const [key, group] of map.groups) groups.set(key, of(group));
  const byBase = new Map<string, WireGroup>();
  for (const [base, group] of map.byBase) byBase.set(rename(base), of(group));
  const coordToNet = new Map<string, string>();
  for (const [key, name] of map.coordToNet) coordToNet.set(key, rename(name));
  return { coordToNet, groups, byBase, busMemberOf: map.busMemberOf };
}
