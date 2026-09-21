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
import { resolvePinNumber, isPinIgnored } from "./pin-resolver.js";
import { parseBusName } from "./bus-name.js";
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
}

/** A pin with this net id touches no net of its own. */
const NO_CONNECT = 0;

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
      netId = (carried.netId ?? binding.netId) + parentOffset;
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
        //
        // In a placement, a port symbol names the placement's own net: one of
        // the block's ports, which the pin then follows up to the parent, or
        // a net local to the placement otherwise. A global symbol names a
        // power net the whole design shares.
        let port: PortMembership | undefined;
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
              if (!coordNet) continue;
              if (placement && pages[i].ports.includes(sym)) {
                const portName = symbolNets.get(sym.pairingId) ?? coordNet;
                if (placement.ports.has(portName)) {
                  coordNet = portName;
                  port = { port: portName };
                } else {
                  coordNet = portName + placement.suffix;
                }
              }
              break;
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
              if (coordNet) {
                // The string list's name is the block's own; in a placement it
                // names that placement's net.
                if (placement) coordNet += placement.suffix;
                break;
              }
            }
          }
        }

        const pinNumber = resolvePinNumber(pin, inst, pmd, deviceIndex);
        const info: PinInfo = { refdes, pinNumber, netId: pin.netId, pageIdx: i, coord, coordNet };
        if (port) info.port = port;
        pins.push(placement ? bindThroughPorts(info, pages, pageCoordMaps, virtualNetIds) : info);
      }
    }
  }
  return pins;
}
