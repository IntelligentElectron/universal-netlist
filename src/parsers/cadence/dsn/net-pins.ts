/**
 * Component pins and the net each one is on.
 *
 * Every pin of every placed instance is read off its page's wire groups, and a
 * pin in a placement of a hierarchical block is followed up through the
 * block's ports to the page that owns its net.
 */

import { isValidRefdes } from "../../../circuit-traversal.js";
import type { PinMapData } from "./structure-types.js";
import type { PageData } from "./page-parser.js";
import type { T0x10 } from "./structures.js";
import { resolvePinNumber, isPinIgnored, isPackShorted } from "./pin-resolver.js";
import { parseBusName } from "./bus-name.js";
import { offPageUnderPin, symbolUnderPin } from "./symbol-attachment.js";
import type { PageCoordMap, PortMembership } from "./page-groups.js";

export interface PinInfo {
  refdes: string;
  pinNumber: string;
  netId: number;
  pageIdx: number;
  coord: string; // "x,y"
  coordNet?: string;
  /** For a pin sitting on a hierarchical port symbol with no wire: that port. */
  port?: PortMembership;
  /** Where the pin is drawn; `pageIdx` and `coord` move to the parent page as it follows a port. */
  drawn?: { pageIdx: number; coord: string };
}

/** A pin with this net id touches no net of its own. */
const NO_CONNECT = 0;
const SENTINEL = 0xffffffff;

/**
 * Net ids handed to bus members that no wire carries on the page whose bus
 * hands them on. They start above every placement's range (see the expander's
 * NET_ID_SPAN) and count up, one per page and member name.
 */
const VIRTUAL_NET_ID_BASE = 2 ** 48;

/**
 * Where a placement's pin is really connected: the page and wire group that
 * own its net, found by following its hierarchical port up through every
 * placement that passes it on.
 *
 * A pin on one of the placement's ports is on the parent page's net, so it
 * joins the parent's net-id group under the parent's page and the block pin's
 * coordinate, and every rule downstream sees one net. The parent may itself be
 * a placement whose group at that pin is on one of its own ports, so the walk
 * repeats until it reaches a group that is local to a page. An unwired block
 * pin stops the walk instead and leaves the port's net local to the placement.
 *
 * A member of a bus port, `DATA3` on the port `DATA[7:0]`, is on the member at
 * the same position of the bus wired to the block pin on the parent page:
 * position, because the parent's bus may be named and numbered differently.
 * When no wire on the parent page carries that member, the parent's bus hands
 * it straight on, so the member gets a net id of its own under the parent and
 * the walk continues from there as if the parent had drawn it.
 */
export function bindThroughPorts(
  pin: PinInfo,
  pages: PageData[],
  pageCoordMaps: PageCoordMap[],
  virtualNetIds: Map<string, number>
): PinInfo {
  let { netId, pageIdx, coord } = pin;
  const group = pageCoordMaps[pageIdx].groups.get(coord);
  let name = group?.name ?? pin.coordNet;
  let base = group?.base ?? (pin.port && pin.coordNet);
  let port = group?.port ?? pin.port;

  for (;;) {
    const placement = pages[pageIdx].placement;
    if (!placement || !port || base === undefined) break;
    const binding = placement.ports.get(port.port);
    if (!binding) break;
    const parentIdx = binding.pageIdx;
    const parentMap = pageCoordMaps[parentIdx];
    const parentGroup = parentMap.groups.get(binding.coord);

    if (port.index === undefined) {
      if (binding.netId === NO_CONNECT && !parentGroup) {
        name = base + placement.suffix;
        break;
      }
      netId = binding.netId;
      pageIdx = parentIdx;
      coord = binding.coord;
      name = parentGroup?.name;
      base = parentGroup?.base;
      port = parentGroup?.port;
      continue;
    }

    const parentBus = parentGroup && parseBusName(parentGroup.base);
    const position = parseBusName(port.port)?.indices.indexOf(port.index) ?? -1;
    if (!parentBus || position < 0 || position >= parentBus.indices.length) {
      name = base + placement.suffix;
      break;
    }
    const member = parentBus.base + parentBus.indices[position];
    const parentOffset = pages[parentIdx].placement?.netIdOffset ?? 0;
    const carried = parentMap.byBase.get(member);
    pageIdx = parentIdx;
    if (carried) {
      // binding.netId is a parent block pin's wire id, already in the parent's range.
      netId = carried.netId === undefined ? binding.netId : carried.netId + parentOffset;
      coord = carried.rep;
      name = carried.name;
      base = carried.base;
      port = carried.port;
      continue;
    }

    const key = `${parentIdx}:${member}`;
    let virtualId = virtualNetIds.get(key);
    if (virtualId === undefined) {
      virtualId = VIRTUAL_NET_ID_BASE + virtualNetIds.size;
      virtualNetIds.set(key, virtualId);
    }
    netId = virtualId;
    coord = `bus:${member}`;
    base = member;
    port = parentMap.busMemberOf(member);
    const parentPlacement = pages[parentIdx].placement;
    name = port || !parentPlacement ? member : member + parentPlacement.suffix;
  }

  return { ...pin, netId, pageIdx, coord, coordNet: name };
}

/**
 * The names of a page's pin-to-pin nodes, by point: points where two or more
 * sentinel pins meet and no wire does. Capture names such a node `N`, the
 * part `db_id` padded to five digits, then the pin index minus one, of its
 * pin with the smallest part `db_id` and, within that part, pin index (§11.7).
 */
export function pinToPinNames(page: PageData): Map<string, string> {
  const first = new Map<string, { dbId: number; pinIndex: number; count: number }>();
  for (const inst of page.placedInstances) {
    for (const pin of inst.t0x10s) {
      if (pin.wireId !== SENTINEL) continue;
      const coord = `${pin.pointX},${pin.pointY}`;
      const seen = first.get(coord);
      const count = (seen?.count ?? 0) + 1;
      if (
        !seen ||
        inst.dbId < seen.dbId ||
        (inst.dbId === seen.dbId && pin.pinIndex < seen.pinIndex)
      ) {
        first.set(coord, { dbId: inst.dbId, pinIndex: pin.pinIndex, count });
      } else {
        seen.count = count;
      }
    }
  }
  const names = new Map<string, string>();
  for (const [coord, { dbId, pinIndex, count }] of first) {
    if (count > 1) names.set(coord, `N${String(dbId).padStart(5, "0")}${pinIndex - 1}`);
  }
  return names;
}

/** Where a pin's net comes from; see the golden table pin-net in docs/decision-tables/dsn-net-assignment. */
export type PinNetSource = "point" | "wire-net" | "net-id" | "pin-to-pin" | "no-connect";

/**
 * The rules of the pin-net table, in order: a net found at the pin's point
 * wins; then the net a page wire with the pin's net id carries; then an
 * unwired pin's own net id, or for a sentinel the pin-to-pin rule.
 */
export function pinNetSource(
  wireId: number,
  netId: number,
  netAtPoint: boolean,
  netOnWire: boolean
): PinNetSource {
  if (netAtPoint) return "point";
  if (netOnWire) return "wire-net";
  if (wireId === SENTINEL) return "pin-to-pin";
  if (wireId === 0) return netId === 0 ? "no-connect" : "net-id";
  return "point";
}

/** Collect all component pins across pages with their coordinate-resolved net names. */
export function collectPins(
  pages: PageData[],
  pageCoordMaps: PageCoordMap[],
  pmd: PinMapData,
  deviceIndexMap: Map<number, number>,
  globalPairingNets: Map<number, string>,
  opcPairingNets: Map<number, string>,
  symbolNets: Map<number, string>
): PinInfo[] {
  const pins: PinInfo[] = [];
  const virtualNetIds = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) {
    const { coordToNet } = pageCoordMaps[i];
    const placement = pages[i].placement;
    // A coordinate on a wire of each SchematicNet, for pins that name a net but no wire.
    const wireOfNet = new Map<number, string>();
    for (const w of pages[i].wires) wireOfNet.set(w.id, `${w.startX},${w.startY}`);
    const pinToPin = pinToPinNames(pages[i]);
    for (const inst of pages[i].placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;
      const deviceIndex = deviceIndexMap.get(inst.dbId);
      const shorted: T0x10[] = [];
      const placed = new Map<number, PinInfo>();
      for (const pin of inst.t0x10s) {
        // A pin this section of the package has no pad for is not a pin of the
        // component; reporting it would invent a connection on a pad that does
        // not exist. Cadence leaves such pins out of its own netlist, unless
        // the part's PACK_SHORT ties it to another pin (§5.8).
        if (isPinIgnored(pin, inst, pmd, deviceIndex)) {
          if (isPackShorted(pin, inst)) shorted.push(pin);
          continue;
        }
        const coord = `${pin.pointX},${pin.pointY}`;
        let coordNet = coordToNet.get(coord);

        // Fallback: sentinel pins overlapping global/port power symbols.
        // These pins connect to power nets via the symbol, not via wires.
        // Match the pin to the symbol whose connection point it sits on (§11.4),
        // then resolve the net via the symbol's pairingId.
        //
        // In a placement, a port symbol names the placement's own net: one of
        // the block's ports, which the pin then follows up to the parent, or
        // a net local to the placement otherwise. A global symbol names a
        // power net the whole design shares.
        let port: PortMembership | undefined;
        if (!coordNet && pin.wireId === 0xffffffff) {
          const named = [...pages[i].globals, ...pages[i].ports].filter((sym) =>
            globalPairingNets.has(sym.pairingId)
          );
          const sym = symbolUnderPin(named, pin.pointX, pin.pointY);
          if (sym) {
            coordNet = globalPairingNets.get(sym.pairingId);
            if (placement && pages[i].ports.includes(sym)) {
              const portName = symbolNets.get(sym.pairingId) ?? coordNet!;
              if (placement.ports.has(portName)) {
                coordNet = portName;
                port = { port: portName };
              } else {
                coordNet = portName + placement.suffix;
              }
            }
          }
        }

        // Fallback: sentinel pins at an OPC's connection point (direct
        // pin-to-OPC, no wire), named via strLst[pairingId].
        if (!coordNet && pin.wireId === 0xffffffff) {
          const named = pages[i].offPageConnectors.filter((opc) =>
            opcPairingNets.has(opc.pairingId)
          );
          const opc = offPageUnderPin(named, pin.pointX, pin.pointY);
          if (opc) {
            coordNet = opcPairingNets.get(opc.pairingId);
            // The string list's name is the block's own; in a placement it
            // names that placement's net.
            if (placement) coordNet += placement.suffix;
          }
        }

        // A pin no wire reaches still names its SchematicNet at +0x0A (§7.4).
        const wireNet =
          pin.netId === 0 ? undefined : coordToNet.get(wireOfNet.get(pin.netId) ?? "");
        let netId = pin.wireId;
        const source = pinNetSource(
          pin.wireId,
          pin.netId,
          coordNet !== undefined,
          wireNet !== undefined
        );
        if (source === "wire-net") {
          // shortcut: takes the wire group's name but not its port, so inside a
          // placed block such a pin stays on the block's net; never seen in the corpus.
          coordNet = wireNet;
        } else if (source === "net-id") {
          // The key moves into the placement's range as the expander moved wire
          // ids; the name keeps the file's id and takes the placement's suffix.
          netId = pin.netId + (placement?.netIdOffset ?? 0);
          coordNet = `N${pin.netId}${placement?.suffix ?? ""}`;
        } else if (source === "pin-to-pin") {
          const name = pinToPin.get(coord);
          if (name) coordNet = name + (placement?.suffix ?? "");
        }

        const pinNumber = resolvePinNumber(pin, inst, pmd, deviceIndex);
        const info: PinInfo = {
          refdes,
          pinNumber,
          netId,
          pageIdx: i,
          coord,
          coordNet,
          drawn: { pageIdx: i, coord },
        };
        if (port) info.port = port;
        const bound = placement
          ? bindThroughPorts(info, pages, pageCoordMaps, virtualNetIds)
          : info;
        placed.set(pin.pinIndex, bound);
        pins.push(bound);
      }

      // A shorted pin is on the net of the first pin of its group that is placed.
      for (const pin of shorted) {
        const group = inst.packShort!.find((g) => g.includes(pin.pinIndex))!;
        const sibling = group.map((idx) => placed.get(idx)).find((p) => p !== undefined);
        if (!sibling) continue;
        pins.push({
          ...sibling,
          pinNumber: resolvePinNumber(pin, inst, pmd, deviceIndex),
          drawn: { pageIdx: i, coord: `${pin.pointX},${pin.pointY}` },
        });
      }
    }
  }
  return pins;
}
