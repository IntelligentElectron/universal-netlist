/**
 * Net Label Sources
 *
 * Finds the schematic objects that give a net a name with leading or trailing
 * whitespace: the net aliases, off-page connectors, global symbols and
 * hierarchical ports carrying that text, with the page each is on and its
 * location. Capture keeps the whitespace as part of the name, and the Allegro
 * netlister trims it on export, so the designer needs to know which object to
 * fix (issue #235).
 *
 * An alias carries its own text. The symbols carry a Library string-list index
 * (`pairingId`), and the string at that index is the net name, read the same
 * way net-builder.ts reads it for connectivity.
 */

import type { NetConnections, NetLabelSource } from "../../../types.js";
import type { PageData } from "./page-parser.js";

const isPadded = (name: string): boolean => name !== name.trim();

/** The page a source sits on, with the block placement when it is one. */
function pageLabel(page: PageData): string {
  return page.placement ? `${page.name} (${page.placement.path.join("/")})` : page.name;
}

/**
 * The net a label's text names on this page: the text itself, or the text with
 * the placement's suffix where the net is local to a block placement.
 */
function netFor(name: string, page: PageData, nets: NetConnections): string | undefined {
  if (name in nets) return name;
  const suffixed = page.placement ? name + page.placement.suffix : undefined;
  return suffixed && suffixed in nets ? suffixed : undefined;
}

/**
 * Collect the sources of every net whose name has leading or trailing
 * whitespace. Returns undefined when no net has one.
 */
export function collectPaddedNetLabelSources(
  pages: PageData[],
  nets: NetConnections,
  strLst: string[]
): Record<string, NetLabelSource[]> | undefined {
  const out = new Map<string, Map<string, NetLabelSource>>();

  const add = (
    rawName: string | undefined,
    kind: NetLabelSource["kind"],
    page: PageData,
    x: number,
    y: number
  ) => {
    if (!rawName) return;
    // Net names are uppercased everywhere they are read; whitespace is kept.
    const name = rawName.toUpperCase();
    if (!isPadded(name)) return;
    const net = netFor(name, page, nets);
    if (!net) return;
    const source: NetLabelSource = { kind, page: pageLabel(page), x, y };
    const key = `${kind}|${source.page}|${x}|${y}`;
    const sources = out.get(net) ?? new Map<string, NetLabelSource>();
    sources.set(key, source);
    out.set(net, sources);
  };

  for (const page of pages) {
    for (const wire of page.wires) {
      for (const alias of wire.aliases) add(alias.name, "net_alias", page, alias.locX, alias.locY);
    }
    for (const opc of page.offPageConnectors) {
      add(strLst[opc.pairingId], "off_page_connector", page, opc.locX, opc.locY);
    }
    for (const sym of page.globals) add(strLst[sym.pairingId], "global", page, sym.locX, sym.locY);
    for (const sym of page.ports) {
      add(strLst[sym.pairingId], "hierarchical_port", page, sym.locX, sym.locY);
    }
  }

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
