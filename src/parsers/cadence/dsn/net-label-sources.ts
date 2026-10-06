/**
 * Net Label Sources
 *
 * Finds the schematic objects whose text names a net with leading or trailing
 * whitespace: the net aliases, off-page connectors, global symbols and
 * hierarchical ports carrying that text, with the page each is on and its
 * location. Capture keeps the whitespace as part of the name, and the Allegro
 * netlister trims it on export, so the designer needs to know which object to
 * fix (issue #235).
 *
 * Each object is matched to the net the connectivity build gave it, not to a
 * net found by its text, so a source is only ever listed on a net its object
 * is on. It is listed when its text is what names that net: the net is the
 * text itself, or, on a page that is one placement of a hierarchical block,
 * the text with the placement's suffix. There the whitespace ends up inside the
 * reported name, as in `"SIG _U1"`.
 */

import type { NetConnections, NetLabelSource } from "../../../types.js";
import { hasEdgeWhitespace } from "../../../net-categories.js";
import type { PageData } from "./page-parser.js";
import type { PageCoordMap } from "./page-groups.js";
import { symbolKey } from "./symbol-attachment.js";

/** The page a source sits on, with the block placement when it is one. */
function pageLabel(page: PageData): string {
  return page.placement ? `${page.name} (${page.placement.path.join("/")})` : page.name;
}

/**
 * Collect the sources of every net named by text with leading or trailing
 * whitespace. Returns undefined when there are none.
 *
 * @param coordMaps - Each page's resolved wire groups, as connectivity used them
 * @param globalPairingNets - Global and port pairingId to the net its pins join
 * @param opcPairingNets - Off-page connector pairingId to the net its pins join
 */
export function collectPaddedNetLabelSources(
  pages: PageData[],
  coordMaps: PageCoordMap[],
  globalPairingNets: Map<number, string>,
  opcPairingNets: Map<number, string>,
  strLst: string[],
  nets: NetConnections
): Record<string, NetLabelSource[]> | undefined {
  const out = new Map<string, Map<string, NetLabelSource>>();

  const add = (
    rawText: string | undefined,
    net: string | undefined,
    kind: NetLabelSource["kind"],
    page: PageData,
    x: number,
    y: number
  ) => {
    if (!rawText || !net || !(net in nets)) return;
    // Net names are uppercased everywhere they are read; whitespace is kept.
    const text = rawText.toUpperCase();
    if (!hasEdgeWhitespace(text)) return;
    const named = net === text || (page.placement && net === text + page.placement.suffix);
    if (!named) return;
    const source: NetLabelSource = { kind, text, page: pageLabel(page), x, y };
    const key = `${kind}|${source.page}|${x}|${y}`;
    const sources = out.get(net) ?? new Map<string, NetLabelSource>();
    sources.set(key, source);
    out.set(net, sources);
  };

  pages.forEach((page, i) => {
    const coordToNet = coordMaps[i].coordToNet;
    for (const wire of page.wires) {
      const net = coordToNet.get(`${wire.startX},${wire.startY}`);
      for (const alias of wire.aliases) {
        add(alias.name, net, "net_alias", page, alias.locX, alias.locY);
      }
    }
    for (const opc of page.offPageConnectors) {
      const net = opcPairingNets.get(opc.pairingId);
      add(strLst[opc.pairingId], net, "off_page_connector", page, opc.locX, opc.locY);
    }
    for (const sym of page.globals) {
      const net = coordToNet.get(symbolKey(sym)) ?? globalPairingNets.get(sym.pairingId);
      add(strLst[sym.pairingId], net, "global", page, sym.locX, sym.locY);
    }
    for (const sym of page.ports) {
      const net = coordToNet.get(symbolKey(sym)) ?? globalPairingNets.get(sym.pairingId);
      add(strLst[sym.pairingId], net, "hierarchical_port", page, sym.locX, sym.locY);
    }
  });

  if (out.size === 0) return undefined;
  const result: Record<string, NetLabelSource[]> = {};
  for (const [net, sources] of out) {
    result[net] = [...sources.values()].sort(
      (a, b) =>
        a.page.localeCompare(b.page) || a.x - b.x || a.y - b.y || a.kind.localeCompare(b.kind)
    );
  }
  return result;
}
