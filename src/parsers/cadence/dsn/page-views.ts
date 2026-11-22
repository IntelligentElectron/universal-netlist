/**
 * Schematic pages as drawn, for the page tools.
 *
 * Built from the same parse the netlist comes from, so every net a page shows is
 * named exactly as `list_nets` names it. The file stores page coordinates in
 * 1/100 inch, x to the right and y down (docs/cadence-dsn-format.md §6.4.1);
 * views carry them in mils, as every vendor's pages do.
 */

import {
  DUPLICATE_REFDES_ERROR,
  displayRefdes,
  isDuplicateKey,
} from "../../../duplicate-refdes.js";
import { PIN_TYPE_BY_CODE, type ComponentDetails } from "../../../types.js";
import type { PageConnector, PageView } from "../../../pages/page-view.js";
import type { PageCoordMap } from "./page-groups.js";
import type { PageData } from "./page-parser.js";
import type { PinInfo } from "./net-pins.js";
import { symbolKey } from "./symbol-attachment.js";
import type { GraphicInst } from "./structures.js";

/** The page a view describes: its name, and the block placement for a reused schematic. */
export const pageLabel = (page: PageData): string => {
  const block = page.placement?.path.join("/");
  return block ? `${page.name} (block ${block})` : page.name;
};

const netOf = (entry: ComponentDetails[string]["pins"][string] | undefined): string | undefined =>
  entry === undefined ? undefined : typeof entry === "string" ? entry : entry.net;

/** Build one view per page, in the parser's page order. */
export function buildPageViews(
  pages: PageData[],
  coordMaps: PageCoordMap[],
  pins: PinInfo[],
  components: ComponentDetails,
  strLst: string[],
  refdesRenames: ReadonlyMap<string, string> = new Map()
): PageView[] {
  // A section split off as a duplicate and later merged back answers to its part's key.
  const finalRefdes = (refdes: string): string => {
    let key = refdes;
    for (let hops = 0; refdesRenames.has(key) && hops < 100; hops++) key = refdesRenames.get(key)!;
    return key;
  };
  // Pins by the page that draws them, at the point drawn: a pin that follows a
  // hierarchical port carries its parent page's index and coordinate instead.
  // The netlist's nets: a page reports only these, so its names always match list_nets.
  // A bus wire's name and a wire that reaches no pin are not nets of the netlist.
  const netlistNets = new Set<string>();
  for (const component of Object.values(components)) {
    for (const entry of Object.values(component.pins)) {
      const net = netOf(entry);
      if (net) netlistNets.add(net);
    }
  }
  const pinsByPage = pages.map((): PinInfo[] => []);
  for (const pin of pins) {
    const drawn = pin.drawn ? { ...pin, ...pin.drawn } : pin;
    pinsByPage[drawn.pageIdx]?.push(drawn);
  }

  // A wire group's net is the final net of a pin on it: cross-page renaming
  // happens after grouping, so a group's own name can differ from the netlist's.
  // A connector touching only pins has no wire group: it is on the net of a pin on it.
  const groupNets = pages.map(() => new Map<string, string>());
  const pinNets = pages.map(() => new Map<string, string>());
  pages.forEach((_, i) => {
    const coordToNet = coordMaps[i]?.coordToNet;
    for (const pin of pinsByPage[i]) {
      const net = netOf(components[finalRefdes(pin.refdes)]?.pins[pin.pinNumber]);
      if (!net || !netlistNets.has(net)) continue;
      const group = coordToNet?.get(pin.coord);
      if (group && !groupNets[i].has(group)) groupNets[i].set(group, net);
      if (!pinNets[i].has(pin.coord)) pinNets[i].set(pin.coord, net);
    }
  });

  /**
   * The netlist net at a point or symbol key of page `i`. A group with no pin on
   * this page that sits on one of the placement's ports is on the parent's net,
   * found at the block pin on the parent page, as pins follow ports (collectPins).
   */
  const netAt = (i: number, key: string, depth = 0): string | undefined => {
    const group = coordMaps[i]?.coordToNet.get(key);
    if (group === undefined) return undefined;
    const net = groupNets[i].get(group);
    if (net !== undefined) return net;
    const port = coordMaps[i]?.groups.get(key)?.port;
    const binding = port && port.index === undefined && pages[i].placement?.ports.get(port.port);
    if (binding && depth < 32) return netAt(binding.pageIdx, binding.coord, depth + 1);
    return netlistNets.has(group) ? group : undefined;
  };

  return pages.map((page, i) => {
    const pagePins = pinsByPage[i];
    const pinNet = pinNets[i];

    const pinsOnSymbol = coordMaps[i]?.pinsOnSymbol;
    const connectorNet = (key: string): string | undefined =>
      netAt(i, key) ??
      pinsOnSymbol
        ?.get(key)
        ?.map((coord) => pinNet.get(coord))
        .find((net) => net !== undefined);

    const pinsByRefdes = new Map<string, PinInfo[]>();
    for (const pin of pagePins) {
      const list = pinsByRefdes.get(pin.refdes) ?? [];
      list.push(pin);
      pinsByRefdes.set(pin.refdes, list);
    }

    const connector = (sym: GraphicInst, key: string): PageConnector => ({
      name: strLst[sym.pairingId] ?? sym.name,
      ...optional("type", sym.portType === undefined ? undefined : PIN_TYPE_BY_CODE[sym.portType]),
      x: mil(sym.locX),
      y: mil(sym.locY),
      ...optional("net", connectorNet(key)),
    });

    const titleBlock = page.titleBlock;
    return {
      page: pageLabel(page),
      schematic: page.schematic ?? "",
      name: page.name,
      size: {
        name: page.sizeName,
        width_mil: Math.round(page.widthInches * 1000),
        height_mil: Math.round(page.heightInches * 1000),
      },
      ...(titleBlock
        ? {
            title_block: {
              fields: Object.fromEntries(
                titleBlock.properties
                  .map(([n, v]) => [strLst[n], strLst[v]] as const)
                  .filter(([n, v]) => n && v)
              ),
              page_number: titleBlock.pageNumber,
              page_count: titleBlock.pageCount,
            },
          }
        : {}),
      parts: page.placedInstances.map((inst) => {
        const refdes = finalRefdes(inst.reference);
        const component = components[refdes];
        // Sections of one part on one page share a refdes; each keeps the pins it draws.
        const points = new Set(inst.t0x10s.map((t) => `${t.pointX},${t.pointY}`));
        return {
          refdes: displayRefdes(refdes),
          ...optional("error", isDuplicateKey(refdes) ? DUPLICATE_REFDES_ERROR : undefined),
          ...optional("value", component?.value),
          symbol: inst.pkgName,
          x: mil(inst.locX),
          y: mil(inst.locY),
          rotation: inst.rotation * 90,
          mirrored: inst.mirrored,
          box: [mil(inst.box.x1), mil(inst.box.y1), mil(inst.box.x2), mil(inst.box.y2)],
          pins: (pinsByRefdes.get(inst.reference) ?? [])
            .filter((pin) => points.has(pin.coord))
            .map((pin) => {
              const entry = component?.pins[pin.pinNumber];
              const [x, y] = pin.coord.split(",").map((v) => mil(Number(v)));
              return {
                number: pin.pinNumber,
                ...optional("name", typeof entry === "object" ? entry.name : undefined),
                ...optional("type", typeof entry === "object" ? entry.type : undefined),
                x,
                y,
                ...optional("net", netOf(entry)),
              };
            }),
        };
      }),
      blocks: page.drawnInstances.map((b) => ({ refdes: b.reference, x: mil(b.locX), y: mil(b.locY) })),
      wires: page.wires.map((w) => ({
        x1: mil(w.startX),
        y1: mil(w.startY),
        x2: mil(w.endX),
        y2: mil(w.endY),
        bus: w.bus,
        ...optional("net", netAt(i, `${w.startX},${w.startY}`)),
      })),
      net_labels: page.wires.flatMap((w) =>
        w.aliases.map((a) => ({ name: a.name, x: mil(a.locX), y: mil(a.locY) }))
      ),
      ports: page.ports.map((sym) => connector(sym, symbolKey(sym))),
      globals: page.globals.map((sym) => connector(sym, symbolKey(sym))),
      off_page_connectors: page.offPageConnectors.map((opc) =>
        connector(opc, `opc:${opc.pairingId}:${opc.dbId}`)
      ),
      bus_entries: page.busEntries.map(({ x1, y1, x2, y2 }) => ({
        x1: mil(x1),
        y1: mil(y1),
        x2: mil(x2),
        y2: mil(y2),
      })),
      text_notes: page.graphics.flatMap((g) =>
        // Capture ends a line with CR LF or a bare CR.
        g.kind === "text" && g.text.trim()
          ? [{ text: g.text.replace(/\r\n?/g, "\n"), x: mil(g.x), y: mil(g.y) }]
          : []
      ),
      // A marker with no text at all says nothing.
      erc_markers: page.ercMarkers
        .map((m) => ({
          ...m,
          message: m.message.trim(),
          detail: m.detail.trim(),
          location: m.location.trim(),
          x: mil(m.x),
          y: mil(m.y),
        }))
        .filter((m) => m.message || m.detail || m.location),
    };
  });
}

/** A page coordinate (1/100 inch) in mils. */
export const mil = (v: number): number => v * 10;

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined || value === "" ? {} : { [key]: value }) as { [P in K]?: V };
