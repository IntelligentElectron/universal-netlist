/**
 * Draw one KiCad sheet instance as SVG, from its `.kicad_sch` file.
 *
 * The drawing works in the file's millimetres (y down) and is scaled once to
 * the SVG's mils, the unit every page tool uses. Symbols are drawn from the
 * file's embedded `lib_symbols`, placed with the same transform the
 * connectivity engine uses, so pins land where `get_page` puts them.
 */

import { childByTag, childrenByTag, parseSexpr, type SExpr } from "../sexpr.js";
import { symbolTransform, type Point } from "./connectivity.js";

type Node = SExpr[];

const WIRE = "#008400";
const BUS = "#0000a4";
const BODY = "#840000";
const FILL = "#ffffc2";
const PIN_NAME = "#006464";
const PIN_NUMBER = "#a90000";
const FIELD = "#006464";
const TEXT = "#000000";
const LABEL = "#000000";
const GLOBAL = "#840000";
const SHEET = "#840084";
const BORDER = "#840000";

/** Text smaller than this (0.1 mm, 4 mil) is not drawn. */
const MIN_TEXT_MM = 0.1;

/** Millimetres per mil. */
const MM_PER_MIL = 0.0254;

const num = (node: SExpr | undefined): number => {
  const value = typeof node === "string" ? Number(node) : NaN;
  return Number.isFinite(value) ? value : 0;
};
const str = (node: SExpr | undefined): string => (typeof node === "string" ? node : "");
const at = (node: Node | undefined): Point => ({ x: num(node?.[1]), y: num(node?.[2]) });
const n = (v: number): string => String(Math.round(v * 1000) / 1000);
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `hide`, `(hide)` or `(hide yes)` among a node's children, or in its `effects`. */
const hidden = (node: Node): boolean => {
  const own = (n: Node) =>
    n.some((c) => c === "hide" || (Array.isArray(c) && c[0] === "hide" && c[1] !== "no"));
  return own(node) || own(childByTag(node, "effects") ?? []);
};

interface TextStyle {
  size: number;
  h: "start" | "middle" | "end";
  v: "top" | "middle" | "bottom";
}

/** A text's size and justification from its `effects`; KiCad centres text by default. */
const style = (
  node: Node,
  h: TextStyle["h"] = "middle",
  v: TextStyle["v"] = "middle"
): TextStyle => {
  const effects = childByTag(node, "effects");
  const size = num(childByTag(childByTag(effects, "font"), "size")?.[1]) || 1.27;
  const justify = childByTag(effects, "justify") ?? [];
  return {
    size,
    h: justify.includes("left") ? "start" : justify.includes("right") ? "end" : h,
    v: justify.includes("top") ? "top" : justify.includes("bottom") ? "bottom" : v,
  };
};

/** One text, possibly several lines, drawn at `p` turned `angle` degrees counterclockwise. */
function textSvg(text: string, p: Point, angle: number, s: TextStyle, colour: string): string {
  // Libraries hide pin names and numbers by sizing them to a mil or so; KiCad shows nothing.
  if (!text || s.size < MIN_TEXT_MM) return "";
  // KiCad markup: _{sub} and ^{super} are drawn as plain text, ~{name} with an overbar.
  const lines = text.replace(/[_^]\{([^}]*)\}/g, "$1").split("\n");
  const marked = (line: string) =>
    line
      .split(/~\{([^}]*)\}/)
      .map((part, i) =>
        i % 2 ? `<tspan text-decoration="overline">${esc(part)}</tspan>` : esc(part)
      )
      .join("");
  // Liberation Sans' cap height is about 0.72 em; KiCad's size is the cap height.
  const em = s.size / 0.72;
  const lineHeight = em * 1.15;
  const first =
    s.v === "top"
      ? s.size
      : s.v === "middle"
        ? s.size / 2 - ((lines.length - 1) * lineHeight) / 2
        : -(lines.length - 1) * lineHeight;
  const turn = ((angle % 360) + 360) % 360;
  const rotate = turn ? ` transform="rotate(${n(-turn)} ${n(p.x)} ${n(p.y)})"` : "";
  const spans = lines
    .map(
      (line, i) =>
        `<tspan x="${n(p.x)}" y="${n(p.y + first + i * lineHeight)}">${marked(line)}</tspan>`
    )
    .join("");
  return `<text font-size="${n(em)}" fill="${colour}" text-anchor="${s.h}"${rotate}>${spans}</text>`;
}

/** The circle through three points, as an SVG arc path from the first to the last. */
function arcPath(a: Point, m: Point, b: Point): string {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-9) return `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`;
  const sq = (p: Point) => p.x * p.x + p.y * p.y;
  const cx = (sq(a) * (m.y - b.y) + sq(m) * (b.y - a.y) + sq(b) * (a.y - m.y)) / d;
  const cy = (sq(a) * (b.x - m.x) + sq(m) * (a.x - b.x) + sq(b) * (m.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const cross = (m.x - a.x) * (b.y - a.y) - (m.y - a.y) * (b.x - a.x);
  // The mid point decides the side: the arc through it is the long one when it lies past the chord's centre.
  const chordMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const large = Math.hypot(m.x - chordMid.x, m.y - chordMid.y) > r ? 1 : 0;
  const sweep = cross < 0 ? 1 : 0;
  return `M${n(a.x)} ${n(a.y)}A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(b.x)} ${n(b.y)}`;
}

/** A shape's stroke and fill attributes, from its `stroke` and `fill` nodes. */
function paint(node: Node, colour: string): string {
  const stroke = childByTag(node, "stroke");
  const width = num(childByTag(stroke, "width")?.[1]) || 0.1524;
  const type = str(childByTag(stroke, "type")?.[1]);
  const dash =
    type === "dash"
      ? ` stroke-dasharray="${n(width * 11)} ${n(width * 4)}"`
      : type === "dot"
        ? ` stroke-dasharray="${n(width)} ${n(width * 4)}"`
        : type === "dash_dot"
          ? ` stroke-dasharray="${n(width * 11)} ${n(width * 4)} ${n(width)} ${n(width * 4)}"`
          : "";
  const fillType = str(childByTag(childByTag(node, "fill"), "type")?.[1]);
  const fill = fillType === "outline" ? colour : fillType === "background" ? FILL : "none";
  return `stroke="${colour}" stroke-width="${n(width)}" fill="${fill}"${dash}`;
}

/** The library shapes of one drawn unit, through `place`, which maps library to sheet points. */
function shapesSvg(owner: Node, place: (p: Point) => Point, colour = BODY, texts = true): string[] {
  const out: string[] = [];
  for (const shape of owner) {
    if (!Array.isArray(shape)) continue;
    const kind = shape[0];
    if (kind === "rectangle") {
      const a = place(at(childByTag(shape, "start")));
      const b = place(at(childByTag(shape, "end")));
      out.push(
        `<rect x="${n(Math.min(a.x, b.x))}" y="${n(Math.min(a.y, b.y))}" width="${n(Math.abs(b.x - a.x))}" height="${n(Math.abs(b.y - a.y))}" ${paint(shape, colour)}/>`
      );
    } else if (kind === "polyline" || kind === "bezier") {
      const pts = childrenByTag(childByTag(shape, "pts"), "xy").map((xy) => place(at(xy)));
      if (pts.length < 2) continue;
      const d =
        kind === "bezier" && pts.length === 4
          ? `M${n(pts[0]!.x)} ${n(pts[0]!.y)}C${pts
              .slice(1)
              .map((p) => `${n(p.x)} ${n(p.y)}`)
              .join(" ")}`
          : `M${pts.map((p) => `${n(p.x)} ${n(p.y)}`).join("L")}`;
      out.push(`<path d="${d}" ${paint(shape, colour)}/>`);
    } else if (kind === "circle") {
      const c = place(at(childByTag(shape, "center")));
      const r = num(childByTag(shape, "radius")?.[1]);
      out.push(`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}" ${paint(shape, colour)}/>`);
    } else if (kind === "arc") {
      const mid = childByTag(shape, "mid");
      if (!mid) continue;
      out.push(
        `<path d="${arcPath(place(at(childByTag(shape, "start"))), place(at(mid)), place(at(childByTag(shape, "end"))))}" ${paint(shape, colour)}/>`
      );
    } else if (texts && kind === "text" && !hidden(shape)) {
      const p = place(at(childByTag(shape, "at")));
      out.push(textSvg(str(shape[1]), p, 0, style(shape), BODY));
    }
  }
  return out;
}

interface Placed {
  at: Point;
  transform: ReturnType<typeof symbolTransform>;
}

const apply = ({ at: o, transform: t }: Placed, p: Point): Point => ({
  x: o.x + t.x1 * p.x + t.y1 * p.y,
  y: o.y + t.x2 * p.x + t.y2 * p.y,
});

/** One placed symbol: its unit's shapes, pins and visible fields. */
function symbolSvg(node: Node, lib: Node, uuidPath: string): string[] {
  const out: string[] = [];
  const atNode = childByTag(node, "at");
  const placed: Placed = {
    at: at(atNode),
    transform: symbolTransform(num(atNode?.[3]), str(childByTag(node, "mirror")?.[1]) || null),
  };
  const place = (p: Point) => apply(placed, p);
  const instance = childrenByTag(childByTag(node, "instances"), "project")
    .flatMap((project) => childrenByTag(project, "path"))
    .find((path) => str(path[1]) === uuidPath);
  const unit = num(childByTag(instance, "unit")?.[1]) || num(childByTag(node, "unit")?.[1]) || 1;
  const bodyStyle =
    num(childByTag(node, "body_style")?.[1] ?? childByTag(node, "convert")?.[1]) || 1;
  const reference = str(childByTag(instance, "reference")?.[1]);

  const pinNames = childByTag(lib, "pin_names");
  const namesHidden = !!pinNames && hidden(pinNames);
  const nameOffset = pinNames ? num(childByTag(pinNames, "offset")?.[1] ?? "0.508") : 0.508;
  const numbersHidden = !!childByTag(lib, "pin_numbers") && hidden(childByTag(lib, "pin_numbers")!);

  const owners: Node[] = [lib, ...childrenByTag(lib, "symbol")].filter((owner) => {
    if (owner === lib) return true;
    const match = /_(\d+)_(\d+)$/.exec(str(owner[1]));
    const u = match ? Number(match[1]) : 0;
    const s = match ? Number(match[2]) : 0;
    return (u === 0 || u === unit) && (s === 0 || s === bodyStyle);
  });
  for (const owner of owners) {
    out.push(...shapesSvg(owner, place));
    for (const pin of childrenByTag(owner, "pin")) {
      if (hidden(pin)) continue;
      const pinAt = childByTag(pin, "at");
      const p = at(pinAt);
      const length = num(childByTag(pin, "length")?.[1]);
      const rad = (num(pinAt?.[3]) * Math.PI) / 180;
      const dir = { x: Math.round(Math.cos(rad)), y: Math.round(Math.sin(rad)) };
      const tip = place(p);
      const end = place({ x: p.x + dir.x * length, y: p.y + dir.y * length });
      out.push(
        `<line x1="${n(tip.x)}" y1="${n(tip.y)}" x2="${n(end.x)}" y2="${n(end.y)}" stroke="${BODY}" stroke-width="0.1524"/>`
      );
      // The pin's direction on the sheet, from its outer tip to its inner end.
      const dx = Math.sign(end.x - tip.x);
      const dy = Math.sign(end.y - tip.y);
      const vertical = dx === 0;
      const angle = vertical ? 90 : 0;
      const name = str(childByTag(pin, "name")?.[1]);
      const nameNode = childByTag(pin, "name") ?? [];
      if (!namesHidden && name && name !== "~" && !hidden(nameNode)) {
        const s = style(nameNode);
        if (nameOffset > 0) {
          // Inside the body, past the pin's inner end.
          const q = { x: end.x + dx * nameOffset, y: end.y + dy * nameOffset };
          const toward = vertical ? (dy < 0 ? "start" : "end") : dx > 0 ? "start" : "end";
          out.push(textSvg(name, q, angle, { ...s, h: toward, v: "middle" }, PIN_NAME));
        } else {
          const q = {
            x: (tip.x + end.x) / 2 - (vertical ? 0.4 : 0),
            y: (tip.y + end.y) / 2 - (vertical ? 0 : 0.4),
          };
          out.push(textSvg(name, q, angle, { ...s, h: "middle", v: "bottom" }, PIN_NAME));
        }
      }
      const number = str(childByTag(pin, "number")?.[1]);
      const numberNode = childByTag(pin, "number") ?? [];
      if (!numbersHidden && number && !hidden(numberNode)) {
        const q = {
          x: (tip.x + end.x) / 2 - (vertical ? 0.3 : 0),
          y: (tip.y + end.y) / 2 - (vertical ? 0 : 0.3),
        };
        out.push(
          textSvg(number, q, angle, { ...style(numberNode), h: "middle", v: "bottom" }, PIN_NUMBER)
        );
      }
    }
  }

  // A field's angle and justification are the symbol's: KiCad turns them with
  // it, then keeps the text readable by turning it half round and swapping its
  // justification when it would read upside down or downwards.
  const units = Math.max(
    1,
    ...childrenByTag(lib, "symbol").map((sub) => Number(/_(\d+)_\d+$/.exec(str(sub[1]))?.[1] ?? 0))
  );
  const symbolAngle = Math.round(num(atNode?.[3]) / 90) * 90;
  const mirror = str(childByTag(node, "mirror")?.[1]);
  for (const field of childrenByTag(node, "property")) {
    if (hidden(field)) continue;
    const name = str(field[1]);
    let value = str(field[2]);
    if (name === "Reference" && reference) {
      value = units > 1 && unit <= 26 ? `${reference}${String.fromCharCode(64 + unit)}` : reference;
    }
    if (!value || value === "~") continue;
    const fieldAt = childByTag(field, "at");
    let angle = (((Math.round(num(fieldAt?.[3]) / 90) * 90 + symbolAngle) % 360) + 360) % 360;
    const s = style(field);
    const swapH = (h: TextStyle["h"]): TextStyle["h"] =>
      h === "start" ? "end" : h === "end" ? "start" : h;
    const swapV = (v: TextStyle["v"]): TextStyle["v"] =>
      v === "top" ? "bottom" : v === "bottom" ? "top" : v;
    let { h, v } = s;
    // A mirror flips the justification along the axis the text runs on.
    if ((mirror === "y" && angle % 180 === 0) || (mirror === "x" && angle % 180 !== 0))
      h = swapH(h);
    if (angle >= 180) {
      angle -= 180;
      h = swapH(h);
      v = swapV(v);
    }
    out.push(textSvg(value, at(fieldAt), angle, { ...s, h, v }, FIELD));
  }
  return out;
}

/** A global or hierarchical label's outline, drawn around its text. */
function labelShape(p: Point, angle: number, text: string, size: number, global: boolean): string {
  // Liberation Sans runs about 0.9 of the cap height per character.
  const width = text.length * size * 0.9 + size * (global ? 2.2 : 1.8);
  const h = size * 0.9;
  // Drawn pointing right from its anchor, then turned.
  const pts = [
    [0, 0],
    [h, -h],
    [width, -h],
    [width, h],
    [h, h],
  ];
  const turn = ((angle % 360) + 360) % 360;
  const rotate = turn ? ` transform="rotate(${n(-turn)} ${n(p.x)} ${n(p.y)})"` : "";
  const d = `M${pts.map(([x, y]) => `${n(p.x + x!)} ${n(p.y + y!)}`).join("L")}Z`;
  return `<path d="${d}" fill="none" stroke="${global ? GLOBAL : LABEL}" stroke-width="0.1524"${rotate}/>`;
}

/**
 * Draw a sheet file as one instance of it, `uuidPath` being the instance path
 * (`/<root>/<sheet>`) that picks each symbol's reference and unit. `paper` is
 * the sheet size in millimetres.
 */
export function renderKicadSheet(
  content: string,
  uuidPath: string,
  paper: { width: number; height: number }
): string {
  const root = parseSexpr(content)[0];
  if (!Array.isArray(root)) return "";
  const libs = new Map<string, Node>();
  for (const lib of childrenByTag(childByTag(root, "lib_symbols"), "symbol"))
    libs.set(str(lib[1]), lib);

  const out: string[] = [
    `<rect x="5" y="5" width="${n(paper.width - 10)}" height="${n(paper.height - 10)}" fill="none" stroke="${BORDER}" stroke-width="0.1524"/>`,
  ];

  // Graphic lines and shapes drawn on the sheet itself; its text items come below.
  out.push(...shapesSvg(root, (p) => p, "#0000c2", false));

  for (const [kind, colour, width] of [
    ["wire", WIRE, 0.1524],
    ["bus", BUS, 0.3048],
  ] as const) {
    for (const w of childrenByTag(root, kind)) {
      const pts = childrenByTag(childByTag(w, "pts"), "xy").map(at);
      if (pts.length >= 2) {
        out.push(
          `<path d="M${pts.map((p) => `${n(p.x)} ${n(p.y)}`).join("L")}" fill="none" stroke="${colour}" stroke-width="${width}"/>`
        );
      }
    }
  }
  for (const e of childrenByTag(root, "bus_entry")) {
    const p = at(childByTag(e, "at"));
    const s = at(childByTag(e, "size"));
    out.push(
      `<line x1="${n(p.x)}" y1="${n(p.y)}" x2="${n(p.x + s.x)}" y2="${n(p.y + s.y)}" stroke="${WIRE}" stroke-width="0.1524"/>`
    );
  }
  for (const j of childrenByTag(root, "junction")) {
    const p = at(childByTag(j, "at"));
    const d = num(childByTag(j, "diameter")?.[1]) || 0.9144;
    out.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(d / 2)}" fill="${WIRE}"/>`);
  }
  for (const nc of childrenByTag(root, "no_connect")) {
    const p = at(childByTag(nc, "at"));
    const r = 0.635;
    out.push(
      `<path d="M${n(p.x - r)} ${n(p.y - r)}L${n(p.x + r)} ${n(p.y + r)}M${n(p.x + r)} ${n(p.y - r)}L${n(p.x - r)} ${n(p.y + r)}" stroke="#0000ff" stroke-width="0.1524"/>`
    );
  }

  for (const node of childrenByTag(root, "symbol")) {
    const libName = str(childByTag(node, "lib_name")?.[1]) || str(childByTag(node, "lib_id")?.[1]);
    const lib = libs.get(libName) ?? libs.get(str(childByTag(node, "lib_id")?.[1]));
    if (lib) out.push(...symbolSvg(node, lib, uuidPath));
  }

  for (const [kind, colour] of [
    ["label", LABEL],
    ["global_label", GLOBAL],
    ["hierarchical_label", GLOBAL],
  ] as const) {
    for (const label of childrenByTag(root, kind)) {
      const atNode = childByTag(label, "at");
      const p = at(atNode);
      const angle = num(atNode?.[3]);
      const s = style(label, "start", "bottom");
      const text = str(label[1]);
      if (kind === "label") {
        out.push(
          textSvg(
            text,
            p,
            angle % 180,
            { ...s, h: angle === 180 || angle === 270 ? "end" : "start" },
            colour
          )
        );
        continue;
      }
      out.push(labelShape(p, angle, text, s.size, kind === "global_label"));
      // The text sits inside the outline, past its point.
      const rad = (angle * Math.PI) / 180;
      const off = s.size * (kind === "global_label" ? 1.3 : 1);
      const q = { x: p.x + Math.cos(rad) * off, y: p.y - Math.sin(rad) * off };
      // Turned 90 the text runs up from its anchor, turned 180 or 270 it runs back.
      const flip = angle === 180 || angle === 270;
      out.push(
        textSvg(text, q, angle % 180, { ...s, h: flip ? "end" : "start", v: "middle" }, colour)
      );
    }
  }

  for (const sheet of childrenByTag(root, "sheet")) {
    const p = at(childByTag(sheet, "at"));
    const size = at(childByTag(sheet, "size"));
    out.push(
      `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(size.x)}" height="${n(size.y)}" fill="none" stroke="${SHEET}" stroke-width="0.1524"/>`
    );
    for (const field of childrenByTag(sheet, "property")) {
      if (hidden(field)) continue;
      const fieldAt = childByTag(field, "at");
      out.push(
        textSvg(
          str(field[2]),
          at(fieldAt),
          num(fieldAt?.[3]),
          style(field, "start", "bottom"),
          SHEET
        )
      );
    }
    for (const pin of childrenByTag(sheet, "pin")) {
      const pinAt = childByTag(pin, "at");
      const q = at(pinAt);
      const angle = num(pinAt?.[3]);
      // A sheet pin's text runs into the sheet from its edge.
      const inward = angle === 180 ? "start" : "end";
      const shift = angle === 180 ? 1 : -1;
      out.push(
        textSvg(
          str(pin[1]),
          { x: q.x + shift * 0.8, y: q.y },
          angle % 180,
          { ...style(pin), h: inward, v: "middle" },
          SHEET
        )
      );
    }
  }

  for (const t of [...childrenByTag(root, "text"), ...childrenByTag(root, "text_box")]) {
    const atNode = childByTag(t, "at");
    const p = at(atNode);
    if (t[0] === "text_box") {
      const size = at(childByTag(t, "size"));
      out.push(
        `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(size.x)}" height="${n(size.y)}" ${paint(t, TEXT)}/>`
      );
      out.push(
        textSvg(str(t[1]), { x: p.x + 0.5, y: p.y + 0.5 }, 0, { ...style(t, "start", "top") }, TEXT)
      );
    } else {
      // KiCad centres a text item that states no justification.
      out.push(textSvg(str(t[1]), p, num(atNode?.[3]), style(t), TEXT));
    }
  }

  const width = Math.round(paper.width / MM_PER_MIL);
  const height = Math.round(paper.height / MM_PER_MIL);
  return (
    // The drawing is in millimetres; the SVG's own units are mils, as page views are.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `font-family="Liberation Sans, Arial, sans-serif" stroke-linecap="round">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>` +
    `<g transform="scale(${1 / MM_PER_MIL})">${out.join("")}</g></svg>`
  );
}
