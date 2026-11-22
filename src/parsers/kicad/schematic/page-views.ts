/**
 * KiCad sheet instances as the page tools describe them: millimetres from the
 * file become mils, and each item carries the net the connectivity engine gave it.
 */

import type { PageConnector, PageView } from "../../../pages/page-view.js";
import { kicadPinType } from "../netlist-parser.js";
import type { KicadPage, Point, SchematicDesign } from "./connectivity.js";

/** Millimetres to mils, to 0.01 mil. */
const mil = (mm: number): number => Math.round((mm / 0.0254) * 100) / 100;

/** A global or hierarchical label's shape in the pin types' terms. */
const SHAPE_TYPE: Record<string, PageConnector["type"]> = {
  input: "input",
  output: "output",
  bidirectional: "bidirectional",
  tri_state: "tristate",
  passive: "passive",
};

/** title_block fields as KiCad's editor names them. */
const FIELD: Record<string, string> = {
  title: "Title",
  date: "Date",
  rev: "Rev",
  company: "Company",
};

const at = (p: Point) => ({ x: mil(p.x), y: mil(p.y) });

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined || value === "" ? {} : { [key]: value }) as { [P in K]?: V };

/**
 * The name `list_pages` gives a sheet instance: its sheet path, or the root
 * sheet's name, its file's when the title is an unresolved `${...}` variable.
 */
export const kicadPageName = (page: KicadPage): string =>
  page.path !== "/" ? page.path.slice(1, -1) : page.name.includes("${") ? page.file : page.name;

export function buildKicadPageViews(design: SchematicDesign): PageView[] {
  const values = new Map(design.components.map((c) => [c.reference, c.value]));
  // KiCad's page order: by page number, sheets without one after, in hierarchy order.
  const order = (page: KicadPage) => Number(page.page) || Infinity;
  const pages = [...design.pages].sort((a, b) => order(a) - order(b));
  return pages.map((page, i): PageView => {
    const connector = (name: string, p: Point, net?: string, type?: PageConnector["type"]) => ({
      name,
      ...optional("type", type),
      ...at(p),
      ...optional("net", net),
    });
    return {
      page: kicadPageName(page),
      schematic: page.file,
      name: page.name,
      size: {
        name: page.paper.name,
        width_mil: Math.round(mil(page.paper.width)),
        height_mil: Math.round(mil(page.paper.height)),
      },
      title_block: {
        fields: Object.fromEntries(
          page.titleBlock
            .filter((f) => f.value)
            .map((f) => [FIELD[f.name] ?? f.name, f.value] as const)
        ),
        page_number: Number(page.page) || i + 1,
        page_count: pages.length,
      },
      parts: page.parts.map((part) => ({
        refdes: part.reference,
        ...optional("value", values.get(part.reference)),
        symbol: part.libId,
        ...at(part.at),
        rotation: part.turns * 90,
        mirrored: part.mirrored,
        box: part.box
          ? [mil(part.box[0]), mil(part.box[1]), mil(part.box[2]), mil(part.box[3])]
          : [0, 0, 0, 0],
        pins: part.pins.map((pin) => ({
          number: pin.number,
          ...optional("name", pin.name === "~" ? undefined : pin.name),
          ...optional("type", kicadPinType(pin.type)),
          ...at(pin.at),
          ...optional("net", pin.net),
        })),
      })),
      blocks: page.sheets.map((sheet) => ({ refdes: sheet.name, ...at(sheet.at) })),
      wires: page.wires.map((w) => ({
        x1: mil(w.a.x),
        y1: mil(w.a.y),
        x2: mil(w.b.x),
        y2: mil(w.b.y),
        bus: w.bus,
        ...optional("net", w.net),
      })),
      net_labels: page.labels
        .filter((l) => l.kind === "local")
        .map((l) => ({ name: l.name, ...at(l.at) })),
      ports: page.labels
        .filter((l) => l.kind === "hier")
        .map((l) => connector(l.name, l.at, l.net, SHAPE_TYPE[l.shape])),
      globals: [
        ...page.labels
          .filter((l) => l.kind === "global")
          .map((l) => connector(l.name, l.at, l.net)),
        ...page.powers.map((p) => connector(p.name, p.at, p.net)),
      ],
      off_page_connectors: [],
      bus_entries: page.busEntries.map((e) => ({
        x1: mil(e.at.x),
        y1: mil(e.at.y),
        x2: mil(e.at.x + e.size.x),
        y2: mil(e.at.y + e.size.y),
      })),
      text_notes: page.texts
        .filter((t) => t.text.trim())
        .map((t) => ({ text: t.text, ...at(t.at) })),
      // KiCad keeps no ERC markers in its schematic files.
      erc_markers: [],
    };
  });
}
