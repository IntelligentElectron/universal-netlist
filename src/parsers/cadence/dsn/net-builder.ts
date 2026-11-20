/**
 * Net Connectivity Builder
 *
 * Builds the net-to-pin mapping from parsed page data: each page's wiring is
 * resolved into named groups (page-groups.ts), every component pin is read off
 * those groups and followed through hierarchical ports (net-pins.ts), and the
 * pins are assembled into nets (net-assembly.ts). This module ties the three
 * together and resolves what spans pages: the names global symbols and
 * off-page connectors carry.
 */

import type {
  NetConnections,
  NetLabelSource,
  BusEntryConnection,
  BusMember,
} from "../../../types.js";
import type { PinMapData } from "./structure-types.js";
import type { PageData } from "./page-parser.js";
import { symbolKey } from "./symbol-attachment.js";
import { buildPageCoordMap, renameGroups, type PageCoordMap } from "./page-groups.js";
import { collectPins, bindThroughPorts } from "./net-pins.js";
import { assembleNets } from "./net-assembly.js";
import { collectPaddedNetLabelSources } from "./net-label-sources.js";

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
  pageCoordMaps: PageCoordMap[],
  canonicalNetNames: Set<string>
): Map<string, string> {
  const opcIdToNames = new Map<number, Set<string>>();

  for (let i = 0; i < pages.length; i++) {
    const coordMap = pageCoordMaps[i].coordToNet;
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
function buildTypedConnectivity(
  pages: PageData[],
  canonicalNetNames: Set<string>,
  pmd: PinMapData,
  deviceIndexMap: Map<number, number>,
  strLst: string[],
  bus = false,
  parentBusMaps?: PageCoordMap[]
): {
  nets: NetConnections;
  componentPins: Map<string, Map<string, string>>;
  pageCoordMaps: PageCoordMap[];
  /** Nets named by text with leading or trailing whitespace, to the objects carrying it. */
  netLabelSources?: Record<string, NetLabelSource[]>;
} {
  // A global/port symbol's pairingId indexes the Library string list, which
  // holds its net name. The symbol's own `name` field is the schematic symbol
  // type and is not the net: a symbol drawn as `VDD_1v8` may carry `CAM_CORE`,
  // and two symbols both drawn as `VCC_BAR` carry `VDD_PLL1` and `VDD_PLL2`.
  const symbolNets = new Map<number, string>();
  for (const page of pages) {
    for (const sym of [...(bus ? [] : page.globals), ...page.ports]) {
      if (symbolNets.has(sym.pairingId)) continue;
      const name = strLst[sym.pairingId];
      if (name) symbolNets.set(sym.pairingId, name.toUpperCase());
    }
  }

  // A placement's own scope names its nets; the root's list names everything else.
  const pageCoordMaps = pages.map((page) =>
    buildPageCoordMap(page, page.placement?.canonicalNetNames ?? canonicalNetNames, symbolNets, bus)
  );

  if (parentBusMaps)
    pageCoordMaps.forEach((map, i) => {
      map.busGroups = parentBusMaps[i].groups;
    });

  // Apply cross-page OPC name equivalences (creates new maps to avoid mutation)
  const opcNameMap = buildOpcNameMap(pages, pageCoordMaps, canonicalNetNames);
  const resolvedCoordMaps =
    opcNameMap.size > 0
      ? pageCoordMaps.map((map) => renameGroups(map, (name) => opcNameMap.get(name) ?? name))
      : pageCoordMaps;

  // Build pairingId -> net name map from global/port symbols.
  // Used as fallback for sentinel pins that overlap power/ground symbols but
  // have no direct wire connection. PairingId groups all instances of the same
  // power symbol (e.g., all GND_SIGNAL globals share one pairingId).
  //
  // Two sources, and they disagree in both directions. The wires are the drawing
  // and win where they exist, because a string-list entry is sometimes the
  // symbol type rather than a net: some designs give a pairingId a name like
  // "GND_SIGNAL" that appears nowhere in their own DAT exports.
  // The string list covers what the wires cannot: a symbol that no wire reaches,
  // where a resistor pin lands straight on the power port.
  const wirePairingNets = new Map<number, string>();
  for (let i = 0; i < pages.length; i++) {
    const coordMap = resolvedCoordMaps[i].coordToNet;
    for (const sym of [...pages[i].globals, ...pages[i].ports]) {
      if (wirePairingNets.has(sym.pairingId)) continue;
      const net = coordMap.get(symbolKey(sym));
      if (net) wirePairingNets.set(sym.pairingId, net);
    }
  }

  const globalPairingNets = new Map<number, string>(wirePairingNets);
  for (const [pairingId, name] of symbolNets) {
    if (!globalPairingNets.has(pairingId)) globalPairingNets.set(pairingId, name);
  }

  // Build pairingId -> net name map from OPCs.
  // Primary: resolve from Library strLst (pairingId is a strLst index for the net name).
  // Fallback: resolve from wire connections on other pages (for designs without strLst).
  const opcPairingNets = new Map<number, string>();
  for (let i = 0; i < pages.length; i++) {
    const coordMap = resolvedCoordMaps[i].coordToNet;
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
    opcPairingNets,
    symbolNets,
    bus
  );
  const { nets, componentPins } = assembleNets(allPins, canonicalNetNames);
  const netLabelSources = collectPaddedNetLabelSources(
    pages,
    resolvedCoordMaps,
    globalPairingNets,
    opcPairingNets,
    strLst,
    nets
  );
  return { nets, componentPins, netLabelSources, pageCoordMaps: resolvedCoordMaps };
}

/** Coordinate associations follow exactly the same ports as component terminals. */
function bindGroupNames(pages: PageData[], maps: PageCoordMap[], kind: "scalar" | "bus"): void {
  const virtualIds = new Map<string, number>();
  const names = maps.map(
    (map, pageIdx) =>
      new Map(
        [...new Set(map.groups.values())].map((group) => [
          group,
          bindThroughPorts(
            {
              kind,
              refdes: "",
              pinNumber: "",
              netId: (group.netId ?? 0) + (pages[pageIdx].placement?.netIdOffset ?? 0),
              pageIdx,
              coord: group.rep,
              coordNet: group.name,
            },
            pages,
            maps,
            virtualIds
          ).coordNet ?? group.name,
        ])
      )
  );
  maps.forEach((map, i) => {
    for (const [coord, group] of map.groups) map.coordToNet.set(coord, names[i].get(group)!);
    for (const [group, name] of names[i]) group.name = name;
  });
}

/** Build independent electrical and bus graphs, sharing only explicit hierarchical member bindings. */
export function buildNetConnectivity(
  pages: PageData[],
  canonicalNetNames: Set<string>,
  pmd: PinMapData,
  deviceIndexMap: Map<number, number>,
  strLst: string[]
) {
  const bus = buildTypedConnectivity(pages, canonicalNetNames, pmd, deviceIndexMap, strLst, true);
  // Keep local base/range names so scalar members can still translate bus indices.
  bindGroupNames(pages, bus.pageCoordMaps, "bus");
  // A bus terminal following a bus port reads the bus graph on both pages.
  const scalar = buildTypedConnectivity(
    pages,
    canonicalNetNames,
    pmd,
    deviceIndexMap,
    strLst,
    false,
    bus.pageCoordMaps
  );
  bindGroupNames(pages, scalar.pageCoordMaps, "scalar");
  for (const map of bus.pageCoordMaps)
    for (const name of map.coordToNet.values()) bus.nets[name] ??= {};
  const busEntries: BusEntryConnection[] = [];
  const busMembers: BusMember[] = [];
  pages.forEach((page, i) => {
    const scalarMap = scalar.pageCoordMaps[i].coordToNet;
    const busMap = bus.pageCoordMaps[i].coordToNet;
    const pageName = page.name + (page.placement?.suffix ?? "");
    for (const entry of page.busEntries ?? []) {
      const ends = [`${entry.startX},${entry.startY}`, `${entry.endX},${entry.endY}`];
      const pairs = [
        [0, 1],
        [1, 0],
      ].flatMap(([a, b]) => {
        const net = scalar.pageCoordMaps[i].ambiguousEntryPoints?.has(ends[a])
          ? undefined
          : scalarMap.get(ends[a]);
        const busName = bus.pageCoordMaps[i].ambiguousEntryPoints?.has(ends[b])
          ? undefined
          : busMap.get(ends[b]);
        return net && busName ? [{ net, bus: busName }] : [];
      });
      const resolved = pairs.length === 1 ? pairs[0] : undefined;
      busEntries.push({
        page: pageName,
        start: [entry.startX, entry.startY],
        end: [entry.endX, entry.endY],
        ...resolved,
      });
      if (resolved) scalar.nets[resolved.net] ??= {};
    }
    for (const [id, members] of page.busMembers ?? []) {
      const wire = page.wires.find((w) => w.kind === "bus" && w.id === id);
      const name =
        (wire && busMap.get(`${wire.startX},${wire.startY}`)) ??
        (page.netTable.get(id)?.[0] ?? `B${id}`) + (page.placement?.suffix ?? "");
      bus.nets[name] ??= {};
      for (const netId of members) {
        const scalarWire = page.wires.find((w) => w.kind !== "bus" && w.id === netId);
        const net = scalarWire && scalarMap.get(`${scalarWire.startX},${scalarWire.startY}`);
        busMembers.push({ page: pageName, bus: name, netId, ...(net ? { net } : {}) });
        if (net) scalar.nets[net] ??= {};
      }
    }
  });
  return {
    nets: scalar.nets,
    componentPins: scalar.componentPins,
    netLabelSources: scalar.netLabelSources,
    buses: bus.nets,
    busComponentPins: bus.componentPins,
    busEntries,
    busMembers,
  };
}
