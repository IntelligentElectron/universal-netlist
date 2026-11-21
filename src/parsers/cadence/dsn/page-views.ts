/**
 * Schematic pages as drawn, for the page tools.
 *
 * Built from the same parse the netlist comes from, so every net a page shows is
 * named exactly as `list_nets` names it. Coordinates are page coordinates in
 * 1/100 inch, x to the right and y down (docs/cadence-dsn-format.md §6.4.1).
 */

import type { ComponentDetails } from "../../../types.js";
import type { PageCoordMap } from "./page-groups.js";
import type { PageData } from "./page-parser.js";
import type { PinInfo } from "./net-pins.js";
import { symbolKey } from "./symbol-attachment.js";
import type { GraphicInst } from "./structures.js";

export interface PagePin {
  number: string;
  name?: string;
  x: number;
  y: number;
  net?: string;
}

export interface PagePart {
  refdes: string;
  value?: string;
  /** The library symbol drawn, such as `RES.Normal`. */
  symbol: string;
  x: number;
  y: number;
  /** Counterclockwise, in degrees: 0, 90, 180 or 270, applied after the mirror. */
  rotation: number;
  mirrored: boolean;
  /** The stored bounding box, `[x1, y1, x2, y2]`; all zero on a few parts. */
  box: [number, number, number, number];
  pins: PagePin[];
}

export interface PageConnector {
  name: string;
  x: number;
  y: number;
  net?: string;
}

export interface PageView {
  /** The page's name, with the block placement when the page is one copy of a reused schematic. */
  page: string;
  schematic: string;
  name: string;
  size: { name: string; width_in: number; height_in: number };
  title_block?: { fields: Record<string, string>; page_number: number; page_count: number };
  parts: PagePart[];
  /** Hierarchical blocks, each placing a child schematic. */
  blocks: { refdes: string; x: number; y: number }[];
  wires: { x1: number; y1: number; x2: number; y2: number; bus: boolean; net?: string }[];
  net_labels: { name: string; x: number; y: number }[];
  ports: PageConnector[];
  globals: PageConnector[];
  off_page_connectors: PageConnector[];
  bus_entries: { x1: number; y1: number; x2: number; y2: number }[];
}

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
  strLst: string[]
): PageView[] {
  const pinsByPage = pages.map((): PinInfo[] => []);
  for (const pin of pins) pinsByPage[pin.pageIdx]?.push(pin);

  return pages.map((page, i) => {
    const coordToNet = coordMaps[i]?.coordToNet ?? new Map<string, string>();
    const pagePins = pinsByPage[i];

    // A wire group's net is the final net of a pin on it: cross-page renaming
    // happens after grouping, so a group's own name can differ from the netlist's.
    const groupNet = new Map<string, string>();
    for (const pin of pagePins) {
      const group = coordToNet.get(pin.coord);
      const net = netOf(components[pin.refdes]?.pins[pin.pinNumber]);
      if (group && net && !groupNet.has(group)) groupNet.set(group, net);
    }
    const netAt = (key: string): string | undefined => {
      const group = coordToNet.get(key);
      return group === undefined ? undefined : (groupNet.get(group) ?? group);
    };

    const pinsByRefdes = new Map<string, PinInfo[]>();
    for (const pin of pagePins) {
      const list = pinsByRefdes.get(pin.refdes) ?? [];
      list.push(pin);
      pinsByRefdes.set(pin.refdes, list);
    }

    const connector = (sym: GraphicInst, key: string): PageConnector => ({
      name: strLst[sym.pairingId] ?? sym.name,
      x: sym.locX,
      y: sym.locY,
      ...optional("net", netAt(key)),
    });

    const titleBlock = page.titleBlock;
    return {
      page: pageLabel(page),
      schematic: page.schematic ?? "",
      name: page.name,
      size: {
        name: page.sizeName,
        width_in: Math.round(page.widthInches * 1000) / 1000,
        height_in: Math.round(page.heightInches * 1000) / 1000,
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
        const component = components[inst.reference];
        return {
          refdes: inst.reference,
          ...optional("value", component?.value),
          symbol: inst.pkgName,
          x: inst.locX,
          y: inst.locY,
          rotation: inst.rotation * 90,
          mirrored: inst.mirrored,
          box: [inst.box.x1, inst.box.y1, inst.box.x2, inst.box.y2],
          pins: (pinsByRefdes.get(inst.reference) ?? []).map((pin) => {
            const entry = component?.pins[pin.pinNumber];
            const [x, y] = pin.coord.split(",").map(Number);
            return {
              number: pin.pinNumber,
              ...optional("name", typeof entry === "object" ? entry.name : undefined),
              x,
              y,
              ...optional("net", netOf(entry)),
            };
          }),
        };
      }),
      blocks: page.drawnInstances.map((b) => ({ refdes: b.reference, x: b.locX, y: b.locY })),
      wires: page.wires.map((w) => ({
        x1: w.startX,
        y1: w.startY,
        x2: w.endX,
        y2: w.endY,
        bus: w.bus,
        ...optional("net", netAt(`${w.startX},${w.startY}`)),
      })),
      net_labels: page.wires.flatMap((w) =>
        w.aliases.map((a) => ({ name: a.name, x: a.locX, y: a.locY }))
      ),
      ports: page.ports.map((sym) => connector(sym, symbolKey(sym))),
      globals: page.globals.map((sym) => connector(sym, symbolKey(sym))),
      off_page_connectors: page.offPageConnectors.map((opc) =>
        connector(opc, `opc:${opc.pairingId}:${opc.dbId}`)
      ),
      bus_entries: page.busEntries.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
    };
  });
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined || value === "" ? {} : { [key]: value }) as { [P in K]?: V };
