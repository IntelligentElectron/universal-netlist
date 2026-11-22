/**
 * Draw a schematic page as SVG.
 *
 * Symbols are placed by the rule in docs/cadence-dsn-format.md §7.7: mirror,
 * then rotate, then shift the transformed placement box to the stored location.
 * The drawing works in page units (1/100 inch, y down), scaled once to the SVG's mils.
 */

import type { LibraryFonts } from "./library-parser.js";
import type { PageData } from "./page-parser.js";
import type { PageView } from "../../../pages/page-view.js";
import type { GraphicInst, SymbolDisplayProp } from "./structures.js";
import {
  placement,
  type Point,
  type Primitive,
  type SymbolGraphics,
  type Transform,
} from "./symbol-graphics.js";

export interface RenderContext {
  symbols: ReadonlyMap<string, SymbolGraphics>;
  strLst: readonly string[];
  fonts: LibraryFonts;
}

// A plain palette: the colour indexes in the file have no verified meaning (§9.4).
const PART = "#1a1a1a";
const WIRE = "#1f4fd1";
const TEXT = "#1a1a1a";
const PIN_NUMBER = "#6b6b6b";
const BORDER = "#9a9a9a";

const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const n = (v: number): string => String(Math.round(v * 10) / 10);

/** Fill 0 is solid and 1 hollow (EXT §9.5 names; confirmed by rendering, see §9.6); 2 is drawn hollow. */
const fillOf = (fill: number, colour: string): string => (fill === 0 ? colour : "none");

/** SVG for one primitive, through `t`; text is drawn upright at its transformed anchor. */
function primitiveSvg(
  p: Primitive,
  t: Transform,
  colour: string,
  fontSize: (font: number) => number
): string {
  const line = (pts: Point[], close: boolean, fill: string) =>
    `<${close ? "polygon" : "polyline"} points="${pts.map((q) => t(q).map(n).join(",")).join(" ")}" fill="${fill}" stroke="${colour}"/>`;
  switch (p.kind) {
    case "line": {
      const [a, b] = [t([p.x1, p.y1]), t([p.x2, p.y2])];
      return `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${colour}"/>`;
    }
    case "rect":
      return line(
        [
          [p.x1, p.y1],
          [p.x2, p.y1],
          [p.x2, p.y2],
          [p.x1, p.y2],
        ],
        true,
        fillOf(p.fill, colour)
      );
    case "ellipse": {
      const [a, b] = [t([p.x1, p.y1]), t([p.x2, p.y2])];
      return `<ellipse cx="${n((a[0] + b[0]) / 2)}" cy="${n((a[1] + b[1]) / 2)}" rx="${n(Math.abs(b[0] - a[0]) / 2)}" ry="${n(Math.abs(b[1] - a[1]) / 2)}" fill="${fillOf(p.fill, colour)}" stroke="${colour}"/>`;
    }
    case "arc": {
      // The arc runs counterclockwise on the page (y down) from start to end on the box's ellipse.
      const [a, b] = [t([p.x1, p.y1]), t([p.x2, p.y2])];
      const [s, e] = [t([p.startX, p.startY]), t([p.endX, p.endY])];
      const rx = Math.abs(b[0] - a[0]) / 2;
      const ry = Math.abs(b[1] - a[1]) / 2;
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2;
      const angle = (q: Point) => Math.atan2(-(q[1] - cy) / (ry || 1), (q[0] - cx) / (rx || 1));
      let sweep = angle(e) - angle(s);
      if (sweep <= 0) sweep += 2 * Math.PI;
      const flipped = t([1, 0])[0] - t([0, 0])[0] < 0 !== t([0, 1])[1] - t([0, 0])[1] < 0;
      const large = sweep > Math.PI ? 1 : 0;
      return `<path d="M${n(s[0])},${n(s[1])} A${n(rx)},${n(ry)} 0 ${flipped ? 1 - large : large} ${flipped ? 1 : 0} ${n(e[0])},${n(e[1])}" fill="none" stroke="${colour}"/>`;
    }
    case "polygon":
      return line(p.points, true, fillOf(p.fill, colour));
    case "polyline":
    case "bezier":
      return line(p.points, false, "none");
    case "text":
      return textSvg(p.text, t([p.x, p.y]), fontSize(p.font), p.rotation ?? 0, TEXT);
  }
}

/** Text at a baseline-left anchor, turned by quarter turns counterclockwise. */
function textSvg(
  text: string,
  [x, y]: Point,
  size: number,
  rotation: number,
  colour: string,
  anchor: "start" | "end" = "start"
): string {
  const turn = rotation & 3 ? ` transform="rotate(${-90 * (rotation & 3)} ${n(x)} ${n(y)})"` : "";
  const align = anchor === "end" ? ` text-anchor="end"` : "";
  return `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" fill="${colour}"${align}${turn}>${esc(text)}</text>`;
}

/** Draw one page. `view` supplies the parts' resolved refdes, values and pin numbers. */
export function renderPageSvg(page: PageData, view: PageView, ctx: RenderContext): string {
  const { symbols, strLst, fonts } = ctx;
  const fontSize = (font: number): number => {
    const h = Math.abs(fonts.heights[font - 1] ?? 0);
    return h >= 4 && h <= 60 ? h : 9;
  };
  const out: string[] = [];
  const width = Math.round(page.widthInches * 100);
  const height = Math.round(page.heightInches * 100);
  out.push(
    `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${BORDER}"/>`
  );

  const display = (
    d: SymbolDisplayProp,
    locX: number,
    locY: number,
    valueOf: (name: string) => string | undefined
  ) => {
    if (d.displayMode === 0) return;
    const name = strLst[d.nameIdx] ?? "";
    const value = valueOf(name);
    const text =
      d.displayMode === 3 ? name : d.displayMode === 2 ? `${name}=${value ?? ""}` : value;
    if (!text) return;
    out.push(textSvg(text, [locX + d.x, locY + d.y], fontSize(d.textFontIdx), d.rotation, TEXT));
  };

  const drawSymbol = (sym: SymbolGraphics | undefined, t: Transform, colour: string) => {
    if (!sym) return;
    for (const p of sym.primitives) out.push(primitiveSvg(p, t, colour, fontSize));
  };

  // Page graphics: absolute coordinates.
  for (const g of page.graphics) out.push(primitiveSvg(g, (p) => p, PART, fontSize));

  // Parts.
  page.placedInstances.forEach((inst, i) => {
    const part = view.parts[i];
    const sym = symbols.get(inst.pkgName);
    const t = sym
      ? placement(sym.box, inst.locX, inst.locY, inst.rotation, inst.mirrored)
      : undefined;
    if (sym && t) {
      drawSymbol(sym, t, PART);
      // View pins are in mils; the drawing works in the file's 1/100 inch.
      const numberAt = new Map(
        (part?.pins ?? []).map((pin) => [`${pin.x / 10},${pin.y / 10}`, pin])
      );
      for (const pin of sym.pins) {
        if (!pin || (pin.shape & 0x20) === 0) continue; // hidden power pins are not drawn
        const s = t([pin.startX, pin.startY]);
        const h = t([pin.hotX, pin.hotY]);
        out.push(
          `<line x1="${n(s[0])}" y1="${n(s[1])}" x2="${n(h[0])}" y2="${n(h[1])}" stroke="${PART}"/>`
        );
        const resolved = numberAt.get(`${h[0]},${h[1]}`);
        const number = resolved?.number;
        // The name goes inside the body, just past the pin's inner end.
        // shortcut: names shown on parts with 4+ pins; Capture's per-part pin-name visibility is not decoded yet.
        if (resolved?.name && sym.pins.length >= 4 && (s[0] !== h[0] || s[1] !== h[1])) {
          const dx = Math.sign(s[0] - h[0]);
          const dy = Math.sign(s[1] - h[1]);
          const at: Point = dx ? [s[0] + 3 * dx, s[1] + 2] : [s[0] + 2, s[1] + 3 * dy];
          out.push(
            textSvg(resolved.name, at, 6, dx ? 0 : 1, TEXT, dx < 0 || dy > 0 ? "end" : "start")
          );
        }
        if (number) {
          const vertical = s[0] === h[0];
          const mid: Point = [(s[0] + h[0]) / 2 + (vertical ? -1 : -2), (s[1] + h[1]) / 2 - 1];
          out.push(textSvg(number, mid, 5, vertical ? 1 : 0, PIN_NUMBER));
        }
      }
    } else if (inst.box.x1 !== inst.box.x2) {
      const { x1, y1, x2, y2 } = inst.box;
      out.push(
        `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="none" stroke="${PART}"/>`
      );
    }
    const pairs = new Map(inst.prefixProperties.map(([k, v]) => [strLst[k], strLst[v]]));
    for (const d of inst.symbolDisplayProps) {
      display(d, inst.locX, inst.locY, (name) =>
        /reference/i.test(name)
          ? (part?.refdes ?? inst.reference)
          : /^value$/i.test(name)
            ? (part?.value ?? pairs.get(name))
            : pairs.get(name)
      );
    }
  });

  // Hierarchical blocks: their outline, name and port names.
  for (const block of page.drawnInstances) {
    const { x1, y1, x2, y2 } = block.box;
    if (x1 !== x2 && y1 !== y2) {
      out.push(
        `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="none" stroke="${PART}"/>`
      );
    }
    out.push(textSvg(block.reference, [x1, y1 - 3], 9, 0, TEXT));
    block.pins.forEach((pin) => {
      const port = block.ports[pin.pinIndex - 1];
      if (!port) return;
      const left = Math.abs(pin.pointX - x1) <= Math.abs(pin.pointX - x2);
      out.push(
        textSvg(
          port,
          [pin.pointX + (left ? 3 : -3), pin.pointY + 2],
          6,
          0,
          TEXT,
          left ? "start" : "end"
        )
      );
    });
  }

  // Power and ground symbols, ports and off-page connectors.
  const connector = (sym: GraphicInst) => {
    const shape = symbols.get(sym.name);
    if (shape)
      drawSymbol(shape, placement(shape.box, sym.locX, sym.locY, sym.rotation, sym.mirrored), PART);
    const net = strLst[sym.pairingId] ?? "";
    for (const d of sym.symbolDisplayProps) display(d, sym.locX, sym.locY, () => net);
  };
  for (const sym of [...page.globals, ...page.ports, ...page.offPageConnectors]) connector(sym);

  // Title block.
  const tb = page.titleBlock;
  if (tb) {
    const b = tb.base;
    const shape = symbols.get(b.name);
    if (shape)
      drawSymbol(shape, placement(shape.box, b.locX, b.locY, b.rotation, b.mirrored), PART);
    const fields = new Map(tb.properties.map(([k, v]) => [strLst[k], strLst[v]]));
    fields.set("Page Number", String(tb.pageNumber));
    fields.set("Page Count", String(tb.pageCount));
    for (const d of b.symbolDisplayProps) display(d, b.locX, b.locY, (name) => fields.get(name));
  }

  // Wires, junction dots, net labels and bus entries.
  for (const w of page.wires) {
    out.push(
      `<line x1="${w.startX}" y1="${w.startY}" x2="${w.endX}" y2="${w.endY}" stroke="${WIRE}" stroke-width="${w.bus ? 3 : 1}"/>`
    );
    if (w.junctions & 1)
      out.push(`<circle cx="${w.startX}" cy="${w.startY}" r="2.5" fill="${WIRE}"/>`);
    if (w.junctions & 2) out.push(`<circle cx="${w.endX}" cy="${w.endY}" r="2.5" fill="${WIRE}"/>`);
    for (const a of w.aliases) out.push(textSvg(a.name, [a.locX, a.locY], 9, 0, TEXT));
  }
  for (const e of page.busEntries) {
    out.push(`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${WIRE}"/>`);
  }

  return (
    // The drawing is in 1/100 inch; the SVG's own units are mils, as page views are.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width * 10} ${height * 10}" width="${width * 10}" height="${height * 10}" ` +
    `font-family="Liberation Sans, Arial, sans-serif" stroke-width="1" stroke-linecap="round">` +
    `<g transform="scale(10)"><rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>${out.join("")}</g></svg>`
  );
}
