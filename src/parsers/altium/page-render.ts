/**
 * Draw one Altium sheet instance as SVG, from its records (docs/altium-format.md, Drawing).
 *
 * The drawing works in units (10 mil) with y flipped to point down, and is scaled once to
 * the SVG's mils. Component graphics are stored placed, so each child is drawn where it
 * is; only the instance's part and display mode are drawn.
 */

import { pinBelongsToInstance } from "./components.js";
import {
  COORDINATE_SCALE,
  polylinePoints,
  scaledField,
  scaledPoint,
  type Point,
} from "./coordinates.js";
import { field, fieldText, toNumber } from "./records.js";
import { RECORD_TYPES, type AltiumRecord } from "./types.js";

/** Text height per point of font size, in units: measured against Altium's PDF prints. */
const TEXT_UNITS_PER_POINT = 0.75;

/** Records drawn per part and display mode: pins and shapes. */
const GRAPHIC = new Set([
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "28",
]);
/** Shapes that can be filled. */
const FILLED = new Set(["7", "8", "9", "10", "14"]);

/** A text's font, written `FontId` or `FontID`. */
const fontId = (r: AltiumRecord): number => toNumber(field(r, "FontId") ?? r.FontID);

/** Stroke widths in units for `LineWidth` 0 to 3: smallest, small, medium, large. */
const LINE_WIDTHS = [0.4, 1, 3, 5];

const n = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A colour field (`0xBBGGRR` as a decimal integer) as CSS, or `fallback` when unwritten. */
const colour = (record: AltiumRecord, key: string, fallback: string): string => {
  const raw = field(record, key);
  if (raw === undefined || raw === "") return fallback;
  const v = toNumber(raw);
  const hex = (c: number) => c.toString(16).padStart(2, "0");
  return `#${hex(v & 255)}${hex((v >> 8) & 255)}${hex((v >> 16) & 255)}`;
};

interface Font {
  size: number;
  name: string;
  bold: boolean;
  italic: boolean;
}

/** The sheet's font table, indexed from 1 by every text's `FontId`. */
const readFonts = (sheet: AltiumRecord | undefined): Font[] => {
  const count = toNumber(sheet && field(sheet, "FontIdCount"));
  return Array.from({ length: count + 1 }, (_, i) => ({
    size: toNumber(sheet && field(sheet, `Size${i}`)) || 10,
    name: String((sheet && field(sheet, `FontName${i}`)) ?? "Arial"),
    bold: sheet !== undefined && field(sheet, `Bold${i}`) === "T",
    italic: sheet !== undefined && field(sheet, `Italic${i}`) === "T",
  }));
};

/**
 * Draw a sheet. `height` is the sheet height in units (for the y flip), `width` its
 * width; `refdes` turns a designator into this instance's, `parameters` resolves
 * `=<parameter>` text.
 */
export function renderAltiumSheet(
  records: readonly AltiumRecord[],
  size: { width: number; height: number },
  refdes: (designator: string) => string,
  parameters: Readonly<Record<string, string>>
): string {
  const sheet = records.find((r) => r.RECORD === RECORD_TYPES.SHEET);
  const fonts = readFonts(sheet);
  const H = size.height;
  const p = ([x, y]: Point): [number, number] => [x / COORDINATE_SCALE, H - y / COORDINATE_SCALE];
  const len = (v: number) => v / COORDINATE_SCALE;
  const out: string[] = [];
  const stroke = (r: AltiumRecord, fallback = "#000080") =>
    `stroke="${colour(r, "Color", fallback)}" stroke-width="${LINE_WIDTHS[toNumber(field(r, "LineWidth"))] ?? 1}"`;
  const fill = (r: AltiumRecord) =>
    field(r, "IsSolid") === "T" ? `fill="${colour(r, "AreaColor", "#ffffb0")}"` : `fill="none"`;

  const shown = (text: string): string => {
    const name = /^=(.+)$/.exec(text.trim())?.[1]?.toLowerCase();
    if (!name) return text;
    // An unresolved reference (a project parameter or a special string) is not drawn.
    return Object.entries(parameters).find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
  };

  /** A text at `at`, anchored by `Justification` (a 3 x 3 grid), turned by `Orientation`. */
  const text = (r: AltiumRecord, value: string, at: Point, fallback = "#000080"): void => {
    if (!value.trim()) return;
    const font = fonts[fontId(r)] ??
      fonts[1] ?? { size: 10, name: "Arial", bold: false, italic: false };
    // A point is 1/72 inch; a unit is 1/100 inch.
    const em = font.size * TEXT_UNITS_PER_POINT;
    let justification = toNumber(field(r, "Justification"));
    if (field(r, "IsMirrored") === "T")
      justification = justification - (justification % 3) + (2 - (justification % 3));
    const h = ["start", "middle", "end"][justification % 3]!;
    const row = Math.floor(justification / 3); // 0 bottom, 1 middle, 2 top
    const [x, y] = p(at);
    const turn = (toNumber(field(r, "Orientation")) & 3) * 90;
    const lines = value.split("\n");
    const lineHeight = em * 1.1;
    const first =
      row === 0
        ? -(lines.length - 1) * lineHeight
        : row === 1
          ? em * 0.35 - ((lines.length - 1) * lineHeight) / 2
          : em * 0.75;
    const spans = lines
      .map(
        (line, i) => `<tspan x="${n(x)}" y="${n(y + first + i * lineHeight)}">${esc(line)}</tspan>`
      )
      .join("");
    const rotate = turn ? ` transform="rotate(${-turn} ${n(x)} ${n(y)})"` : "";
    const weight = font.bold ? ` font-weight="bold"` : "";
    const italic = font.italic ? ` font-style="italic"` : "";
    out.push(
      `<text font-size="${n(em)}" fill="${colour(r, "Color", fallback)}" text-anchor="${h}"${weight}${italic}${rotate}>${spans}</text>`
    );
  };

  /** An arc of an ellipse centred on `c`, counterclockwise from `start` to `end` degrees. */
  const arc = (c: Point, rx: number, ry: number, start: number, end: number): string => {
    const [cx, cy] = p(c);
    let sweep = (((end - start) % 360) + 360) % 360;
    if (sweep === 0) sweep = 360;
    if (sweep >= 359.99)
      return `M${n(cx + rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)}`;
    const at = (deg: number) => [
      cx + rx * Math.cos((deg * Math.PI) / 180),
      cy - ry * Math.sin((deg * Math.PI) / 180),
    ];
    const [x1, y1] = at(start);
    const [x2, y2] = at(start + sweep);
    // Counterclockwise on the sheet is counterclockwise on screen too: sweep flag 0 with y down.
    return `M${n(x1!)} ${n(y1!)}A${n(rx)} ${n(ry)} 0 ${sweep > 180 ? 1 : 0} 0 ${n(x2!)} ${n(y2!)}`;
  };

  // Altium draws filled shapes beneath everything else on the sheet.
  let phase: "fill" | "rest" = "fill";
  const isFilled = (r: AltiumRecord) => FILLED.has(String(r.RECORD)) && field(r, "IsSolid") === "T";
  const draw = (r: AltiumRecord, owner?: AltiumRecord): void => {
    if ((phase === "fill") === isFilled(r)) drawOne(r, owner);
    walk(r, owner);
  };
  const drawOne = (r: AltiumRecord, owner?: AltiumRecord): void => {
    switch (r.RECORD) {
      case "13": {
        const [x1, y1] = p(scaledPoint(r));
        const [x2, y2] = p(scaledPoint(r, "Corner"));
        out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${stroke(r)}/>`);
        break;
      }
      case "6":
      case "7": {
        const pts = polylinePoints(r).map(p);
        if (pts.length < 2) break;
        const d = `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}${r.RECORD === "7" ? "Z" : ""}`;
        out.push(`<path d="${d}" ${stroke(r)} ${r.RECORD === "7" ? fill(r) : `fill="none"`}/>`);
        break;
      }
      case "5": {
        const pts = polylinePoints(r).map(p);
        if (pts.length < 4) break;
        let d = `M${n(pts[0]![0])} ${n(pts[0]![1])}`;
        for (let i = 1; i + 2 < pts.length; i += 3) {
          d += `C${[pts[i]!, pts[i + 1]!, pts[i + 2]!].map(([x, y]) => `${n(x)} ${n(y)}`).join(" ")}`;
        }
        out.push(`<path d="${d}" ${stroke(r)} fill="none"/>`);
        break;
      }
      case "14":
      case "10": {
        const [x1, y1] = p(scaledPoint(r));
        const [x2, y2] = p(scaledPoint(r, "Corner"));
        const radii =
          r.RECORD === "10"
            ? ` rx="${n(len(scaledField(r, "CornerXRadius")))}" ry="${n(len(scaledField(r, "CornerYRadius")))}"`
            : "";
        out.push(
          `<rect x="${n(Math.min(x1, x2))}" y="${n(Math.min(y1, y2))}" width="${n(Math.abs(x2 - x1))}" height="${n(Math.abs(y2 - y1))}"${radii} ${stroke(r)} ${fill(r)}/>`
        );
        break;
      }
      case "8": {
        const [cx, cy] = p(scaledPoint(r));
        const rx = len(scaledField(r, "Radius"));
        const ry = len(scaledField(r, "SecondaryRadius")) || rx;
        out.push(
          `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" ${stroke(r)} ${fill(r)}/>`
        );
        break;
      }
      case "12":
      case "11":
      case "9": {
        const rx = len(scaledField(r, "Radius"));
        const ry = r.RECORD === "11" ? len(scaledField(r, "SecondaryRadius")) || rx : rx;
        const start = toNumber(field(r, "StartAngle"));
        const end = toNumber(field(r, "EndAngle"));
        let d = arc(scaledPoint(r), rx, ry, start, end);
        if (r.RECORD === "9") {
          const [cx, cy] = p(scaledPoint(r));
          d += `L${n(cx)} ${n(cy)}Z`;
        }
        out.push(`<path d="${d}" ${stroke(r)} ${r.RECORD === "9" ? fill(r) : `fill="none"`}/>`);
        break;
      }
      case "4":
        text(r, shown(fieldText(r, "Text") ?? ""), scaledPoint(r));
        break;
      case RECORD_TYPES.DESIGNATOR:
        if (field(r, "IsHidden") !== "T") {
          // A multi-part component shows its part letter: `PartCount` counts one more than its parts.
          const multi = owner !== undefined && toNumber(field(owner, "PartCount")) > 2;
          const part = owner ? toNumber(field(owner, "CurrentPartId")) : 0;
          const letter = multi && part >= 1 && part <= 26 ? String.fromCharCode(64 + part) : "";
          text(r, refdes(fieldText(r, "Text") ?? "") + letter, scaledPoint(r));
        }
        break;
      case RECORD_TYPES.PARAMETER:
        if (field(r, "IsHidden") !== "T" && field(r, "Location.X") !== undefined) {
          text(r, shown(fieldText(r, "Text") ?? ""), scaledPoint(r));
        }
        break;
      case RECORD_TYPES.PIN: {
        const flags = toNumber(field(r, "PinConglomerate"));
        if (flags & 0x04) break; // hidden
        const [x1, y1] = p(scaledPoint(r));
        const length = len(scaledField(r, "PinLength"));
        const turn = flags & 3;
        const dx = [1, 0, -1, 0][turn]!;
        const dy = [0, -1, 0, 1][turn]!; // on screen, y down
        const [x2, y2] = [x1 + dx * length, y1 + dy * length];
        out.push(
          `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${colour(r, "Color", "#000000")}" stroke-width="1"/>`
        );
        const fontEm = 10 * TEXT_UNITS_PER_POINT;
        const vertical = dx === 0;
        const rotate = (x: number, y: number) =>
          vertical ? ` transform="rotate(-90 ${n(x)} ${n(y)})"` : "";
        // The name inside the body, past the pin's inner end; the designator over the pin.
        const name = fieldText(r, "Name");
        if (name && flags & 0x08) {
          const gap = 3;
          const [nx, ny] = [x1 - dx * gap, y1 - dy * gap];
          const anchor = vertical ? (dy < 0 ? "end" : "start") : dx > 0 ? "end" : "start";
          out.push(
            `<text font-size="${n(fontEm)}" fill="#000000" text-anchor="${anchor}" dominant-baseline="middle"${rotate(nx, ny)}><tspan x="${n(nx)}" y="${n(ny + (vertical ? 0 : fontEm * 0.35))}">${esc(name.replace(/\\/g, ""))}</tspan></text>`
          );
        }
        const designator = fieldText(r, "Designator");
        if (designator && flags & 0x10) {
          const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2 - (vertical ? 0 : 1.5)];
          out.push(
            `<text font-size="${n(fontEm)}" fill="#000000" text-anchor="middle"${rotate(mx - (vertical ? 1.5 : 0), my)}><tspan x="${n(mx - (vertical ? 1.5 : 0))}" y="${n(my)}">${esc(designator)}</tspan></text>`
          );
        }
        break;
      }
      case RECORD_TYPES.WIRE:
      case RECORD_TYPES.BUS: {
        const pts = polylinePoints(r).map(p);
        if (pts.length < 2) break;
        const width =
          r.RECORD === RECORD_TYPES.BUS ? 3 : (LINE_WIDTHS[toNumber(field(r, "LineWidth"))] ?? 1);
        out.push(
          `<path d="M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}" fill="none" stroke="${colour(r, "Color", "#000080")}" stroke-width="${width}" stroke-linejoin="round"/>`
        );
        break;
      }
      case RECORD_TYPES.BUS_ENTRY: {
        const [x1, y1] = p(scaledPoint(r));
        const [x2, y2] = p(scaledPoint(r, "Corner"));
        out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${stroke(r)}/>`);
        break;
      }
      case "29": {
        const [x, y] = p(scaledPoint(r));
        out.push(
          `<circle cx="${n(x)}" cy="${n(y)}" r="2" fill="${colour(r, "Color", "#000080")}"/>`
        );
        break;
      }
      case "22": {
        const [x, y] = p(scaledPoint(r));
        out.push(
          `<path d="M${n(x - 3)} ${n(y - 3)}L${n(x + 3)} ${n(y + 3)}M${n(x + 3)} ${n(y - 3)}L${n(x - 3)} ${n(y + 3)}" stroke="${colour(r, "Color", "#ff0000")}" stroke-width="1"/>`
        );
        break;
      }
      case RECORD_TYPES.NET_LABEL:
        text(r, fieldText(r, "Text") ?? "", scaledPoint(r));
        break;
      case RECORD_TYPES.POWER_PORT: {
        const [x, y] = p(scaledPoint(r));
        const turn = toNumber(field(r, "Orientation")) & 3;
        const style = toNumber(field(r, "Style"));
        const c = colour(r, "Color", "#000080");
        // Drawn pointing up from its point (orientation 1), then turned.
        const glyph =
          style === 4 || style === 5 || style === 6
            ? `M0 0L0 -10M-10 -10L10 -10M-6 -13L6 -13M-2 -16L2 -16`
            : style === 1
              ? `M0 0L0 -10M-4 -6L0 -10L4 -6`
              : style === 0
                ? `M0 0L0 -6M0 -8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0`
                : `M0 0L0 -10M-10 -10L10 -10`;
        const ground = style === 4 || style === 5 || style === 6;
        // Ground symbols point down from their point; the others point up.
        const angle = (ground ? 180 : 0) + [-90, 0, 90, 180][turn]!;
        out.push(
          `<path d="${glyph}" transform="translate(${n(x)} ${n(y)}) rotate(${angle})" fill="none" stroke="${c}" stroke-width="1"/>`
        );
        if (field(r, "ShowNetName") !== "F") {
          const dir = [
            [14, 0],
            [0, -14],
            [-14, 0],
            [0, 14],
          ][ground ? (turn + 2) % 4 : turn]!;
          const anchor = dir[0]! > 0 ? "start" : dir[0]! < 0 ? "end" : "middle";
          const em = 10 * TEXT_UNITS_PER_POINT;
          out.push(
            `<text font-size="${n(em)}" fill="${c}" text-anchor="${anchor}"><tspan x="${n(x + dir[0]!)}" y="${n(y + dir[1]! + (dir[1]! > 0 ? em * 0.75 : dir[1]! < 0 ? 0 : em * 0.35))}">${esc(fieldText(r, "Text") ?? "")}</tspan></text>`
          );
        }
        break;
      }
      case RECORD_TYPES.PORT: {
        const [x, y] = p(scaledPoint(r));
        const width = len(scaledField(r, "Width"));
        const height = len(scaledField(r, "Height")) || 10;
        const vertical = toNumber(field(r, "Style")) >= 4;
        const tip = Math.min(height / 2, width / 3);
        const shape = vertical
          ? `M${n(x)} ${n(y)}L${n(x - height / 2)} ${n(y - tip)}L${n(x - height / 2)} ${n(y - width)}L${n(x + height / 2)} ${n(y - width)}L${n(x + height / 2)} ${n(y - tip)}Z`
          : `M${n(x)} ${n(y)}L${n(x + tip)} ${n(y - height / 2)}L${n(x + width)} ${n(y - height / 2)}L${n(x + width)} ${n(y + height / 2)}L${n(x + tip)} ${n(y + height / 2)}Z`;
        out.push(
          `<path d="${shape}" fill="${colour(r, "AreaColor", "#ffffb0")}" stroke="${colour(r, "Color", "#800000")}" stroke-width="1"/>`
        );
        const em = 9 * TEXT_UNITS_PER_POINT;
        const name = fieldText(r, "Name") ?? "";
        out.push(
          vertical
            ? `<text font-size="${n(em)}" fill="${colour(r, "TextColor", "#800000")}" text-anchor="middle" transform="rotate(-90 ${n(x)} ${n(y - width / 2)})"><tspan x="${n(x)}" y="${n(y - width / 2 + em * 0.35)}">${esc(name)}</tspan></text>`
            : `<text font-size="${n(em)}" fill="${colour(r, "TextColor", "#800000")}" text-anchor="middle"><tspan x="${n(x + width / 2)}" y="${n(y + em * 0.35)}">${esc(name)}</tspan></text>`
        );
        break;
      }
      case RECORD_TYPES.SHEET_SYMBOL: {
        const [x, y] = p(scaledPoint(r));
        const w = len(scaledField(r, "XSize"));
        const h = len(scaledField(r, "YSize"));
        out.push(
          `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${stroke(r, "#800000")} ${fill(r)}/>`
        );
        for (const entry of r.children ?? []) {
          if (entry.RECORD !== RECORD_TYPES.SHEET_ENTRY) continue;
          const side = toNumber(field(entry, "Side"));
          const along =
            (toNumber(field(entry, "DistanceFromTop")) +
              toNumber(field(entry, "DistanceFromTop_Frac1")) / 1e6) *
            10;
          const [ex, ey, anchor] =
            side === 1
              ? [x + w - 2, y + along, "end"]
              : side === 2
                ? [x + along, y + 2, "start"]
                : side === 3
                  ? [x + along, y + h - 2, "end"]
                  : [x + 2, y + along, "start"];
          const em = 9 * TEXT_UNITS_PER_POINT;
          const rotate =
            side >= 2 ? ` transform="rotate(-90 ${n(ex as number)} ${n(ey as number)})"` : "";
          out.push(
            `<text font-size="${n(em)}" fill="${colour(entry, "TextColor", "#800000")}" text-anchor="${anchor}"${rotate}><tspan x="${n(ex as number)}" y="${n((ey as number) + em * 0.35)}">${esc(fieldText(entry, "Name") ?? "")}</tspan></text>`
          );
        }
        break;
      }
      case RECORD_TYPES.SHEET_NAME:
      case RECORD_TYPES.SHEET_FILE_NAME:
        if (field(r, "IsHidden") !== "T") text(r, fieldText(r, "Text") ?? "", scaledPoint(r));
        break;
      case "28":
      case "209": {
        const [x1, y1] = p(scaledPoint(r));
        const [x2, y2] = p(scaledPoint(r, "Corner"));
        const [left, top] = [Math.min(x1, x2), Math.min(y1, y2)];
        if (field(r, "IsSolid") === "T" || field(r, "ShowBorder") === "T") {
          out.push(
            `<rect x="${n(left)}" y="${n(top)}" width="${n(Math.abs(x2 - x1))}" height="${n(Math.abs(y2 - y1))}" stroke="${colour(r, "Color", "#000000")}" stroke-width="${field(r, "ShowBorder") === "T" ? 1 : 0}" ${fill(r)}/>`
          );
        }
        const font = fonts[fontId(r)] ?? fonts[1]!;
        const em = font.size * TEXT_UNITS_PER_POINT;
        const lines = (fieldText(r, "Text") ?? "").split("~1");
        const spans = lines
          .map(
            (line, i) =>
              `<tspan x="${n(left + 2)}" y="${n(top + em * (0.9 + i * 1.1))}">${esc(line)}</tspan>`
          )
          .join("");
        out.push(
          `<text font-size="${n(em)}" fill="${colour(r, "TextColor", "#000000")}">${spans}</text>`
        );
        break;
      }
    }
  };
  const walk = (r: AltiumRecord, owner?: AltiumRecord): void => {
    if (r.RECORD === RECORD_TYPES.SHEET_SYMBOL) {
      for (const child of r.children ?? [])
        if (child.RECORD !== RECORD_TYPES.SHEET_ENTRY) draw(child, r);
      return;
    }
    if (r.RECORD !== RECORD_TYPES.COMPONENT) {
      for (const child of r.children ?? []) draw(child, owner ?? r);
      return;
    }
    // A component draws the shapes and pins of the part and display mode this instance
    // shows; its designator and parameters belong to the whole component.
    for (const child of r.children ?? []) {
      if (!GRAPHIC.has(String(child.RECORD)) || pinBelongsToInstance(child, r)) draw(child, r);
    }
  };

  for (const record of records) draw(record);
  phase = "rest";
  for (const record of records) draw(record);

  const width = Math.round(size.width * 10);
  const height = Math.round(size.height * 10);
  return (
    // The drawing is in units of 10 mil; the SVG's own units are mils, as page views are.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `font-family="Liberation Sans, Arial, sans-serif" stroke-linecap="round">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${sheet ? colour(sheet, "AreaColor", "#ffffff") : "#ffffff"}"/>` +
    `<g transform="scale(10)">` +
    `<rect x="2" y="2" width="${n(size.width - 4)}" height="${n(size.height - 4)}" fill="none" stroke="#800000" stroke-width="0.5"/>` +
    `${out.join("")}</g></svg>`
  );
}
