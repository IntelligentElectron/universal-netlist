/**
 * Graphic primitives and the symbols built from them, for drawing pages.
 *
 * Layouts follow docs/cadence-dsn-format.md: primitive lists and entry framing
 * in chapter 8, symbol-shaped records (types 24, 33, 34, 35, 64, 75) in §5.2,
 * and the Cache's five directory tables in §5.1.
 */

import { BinaryReader } from "./binary-reader.js";
import { walkCacheTables } from "./cache-parser.js";
import { FutureDataList, autoReadPrefixes, readPreamble, skipStructure } from "./generic-parser.js";
import { StructureType } from "./structure-types.js";
import {
  type GraphicInst,
  parseSymbolDisplayProp,
  parseSymbolPin,
  type SymbolDisplayProp,
  type SymbolPin,
} from "./structures.js";

export type Point = [number, number];
export type Transform = (p: Point) => Point;

/** A drawing primitive in its owner's coordinates (1/100 inch, y down). */
export type Primitive =
  | { kind: "rect" | "ellipse"; x1: number; y1: number; x2: number; y2: number; fill: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | {
      kind: "arc";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    }
  | { kind: "polygon"; points: [number, number][]; fill: number }
  | { kind: "polyline" | "bezier"; points: [number, number][] }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      font: number;
      /** Quarter turns counterclockwise; set on page text only. */
      rotation?: number;
    };

/** One symbol definition: what a placed part, connector or title block draws. */
export interface SymbolGraphics {
  name: string;
  primitives: Primitive[];
  /** The stored box `x1, y1, x2, y2`, which anchors placement (§7.7). */
  box: { x1: number; y1: number; x2: number; y2: number };
  /** Pin slots by position; an empty slot is `undefined`. */
  pins: (SymbolPin | undefined)[];
  displays: SymbolDisplayProp[];
}

/** `n` points stored y before x (§8.4.4). */
const readPoints = (reader: BinaryReader): [number, number][] => {
  const n = reader.readUint16();
  const points: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const y = reader.readInt16();
    points.push([reader.readInt16(), y]);
  }
  return points;
};

/** Read a primitive body whose kind byte sits at `bodyStart - 10`. Undefined for kinds not drawn. */
function readBody(reader: BinaryReader, kind: number): Primitive | undefined {
  switch (kind) {
    case 40:
    case 43: {
      const [x1, y1, x2, y2] = [
        reader.readInt32(),
        reader.readInt32(),
        reader.readInt32(),
        reader.readInt32(),
      ];
      reader.skip(8); // line style, line width
      return { kind: kind === 40 ? "rect" : "ellipse", x1, y1, x2, y2, fill: reader.readUint32() };
    }
    case 41: {
      const [x1, y1, x2, y2] = [
        reader.readInt32(),
        reader.readInt32(),
        reader.readInt32(),
        reader.readInt32(),
      ];
      return { kind: "line", x1, y1, x2, y2 };
    }
    case 42: {
      const v = Array.from({ length: 8 }, () => reader.readInt32());
      return {
        kind: "arc",
        x1: v[0],
        y1: v[1],
        x2: v[2],
        y2: v[3],
        startX: v[4],
        startY: v[5],
        endX: v[6],
        endY: v[7],
      };
    }
    case 44: {
      reader.skip(8); // line style, line width
      const fill = reader.readUint32();
      reader.skip(4); // hatch
      return { kind: "polygon", points: readPoints(reader), fill };
    }
    case 45:
    case 87:
      reader.skip(8); // line style, line width
      return { kind: kind === 45 ? "polyline" : "bezier", points: readPoints(reader) };
    case 46: {
      reader.skip(16); // text box
      const x = reader.readInt32();
      const y = reader.readInt32();
      const font = reader.readUint32() & 0xffff;
      return { kind: "text", x, y, text: reader.readStringLenZeroTerm(0xffff), font };
    }
    default:
      return undefined; // bitmaps and OLE objects are not drawn
  }
}

/**
 * Read one primitive entry at the reader's position, appending what it draws.
 * Both entry forms end at `+0x02 + length + 8` (§8.3), so the end is found
 * without telling them apart.
 */
function readEntry(reader: BinaryReader, out: Primitive[]): void {
  const start = reader.tell();
  const kind = reader.peek(1)[0];
  if (kind === 48) {
    readVector(reader, out);
    return;
  }
  reader.skip(2); // kind, kind repeat
  const length = reader.readUint32();
  reader.skip(4); // reserved
  const primitive = readBody(reader, kind);
  if (primitive) out.push(primitive);
  reader.seek(start + 2 + length + 8);
}

/** A SymbolVector (48): a named group of child primitives at an offset (§8.7). */
function readVector(reader: BinaryReader, out: Primitive[]): void {
  reader.skip(1); // selector
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData); // a type-48 record
  readPreamble(reader);
  const dx = reader.readInt16();
  const dy = reader.readInt16();
  const children = reader.readUint16();
  const group: Primitive[] = [];
  for (let i = 0; i < children; i++) {
    // A child's u16 selector puts every offset one byte later than at top level.
    const start = reader.tell();
    const kind = reader.readUint16();
    reader.skip(1);
    const length = reader.readUint32();
    reader.skip(4);
    const primitive = readBody(reader, kind);
    if (primitive) group.push(primitive);
    reader.seek(start + 1 + 2 + length + 8);
  }
  reader.readStringLenZeroTerm(); // vector name
  out.push(...group.map((p) => translate(p, dx, dy)));
}

/** Read a primitive list: a `u16` count and its entries (§8.2). The box after it is left unread. */
export function readPrimitiveList(reader: BinaryReader): Primitive[] {
  const count = reader.readUint16();
  const out: Primitive[] = [];
  for (let i = 0; i < count; i++) readEntry(reader, out);
  return out;
}

/** A primitive moved by `(dx, dy)`. */
export function translate(p: Primitive, dx: number, dy: number): Primitive {
  switch (p.kind) {
    case "polygon":
    case "polyline":
    case "bezier":
      return { ...p, points: p.points.map(([x, y]) => [x + dx, y + dy]) };
    case "text":
      return { ...p, x: p.x + dx, y: p.y + dy };
    case "arc":
      return {
        ...p,
        x1: p.x1 + dx,
        y1: p.y1 + dy,
        x2: p.x2 + dx,
        y2: p.y2 + dy,
        startX: p.startX + dx,
        startY: p.startY + dy,
        endX: p.endX + dx,
        endY: p.endY + dy,
      };
    default:
      return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
  }
}

/** Decode a symbol-shaped record: types 24, 33, 34, 35, 64 and 75 (§5.2.2). */
export function parseSymbolGraphics(buffer: Buffer): SymbolGraphics {
  const reader = new BinaryReader(buffer);
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData);
  readPreamble(reader);
  const name = reader.readStringLenZeroTerm();
  reader.readStringLenZeroTerm(); // source library
  reader.skip(4); // colour
  const primitives = readPrimitiveList(reader);
  const box = {
    x1: reader.readInt16(),
    y1: reader.readInt16(),
    x2: reader.readInt16(),
    y2: reader.readInt16(),
  };
  const pins: (SymbolPin | undefined)[] = [];
  const slots = reader.readUint16();
  for (let i = 0; i < slots; i++) {
    const first = reader.peek(1)[0];
    if (first === StructureType.SymbolPinScalar || first === StructureType.SymbolPinBus) {
      pins.push(parseSymbolPin(reader));
    } else if (first === 0x00) {
      reader.skip(1); // an empty slot still counts as a position
      pins.push(undefined);
    } else {
      skipStructure(reader);
      pins.push(undefined);
    }
  }
  const displays: SymbolDisplayProp[] = [];
  const displayCount = reader.readUint16();
  for (let i = 0; i < displayCount; i++) displays.push(parseSymbolDisplayProp(reader));
  return { name, primitives, box, pins, displays };
}

/** Record types that hold symbols in the Cache's tables 1 and 2. */
const SYMBOL_TYPES = new Set([24, 33, 34, 35, 64, 75]);

/** Global (33), port (34) and off-page (35) symbols: the ones connectors place (§11.4). */
export const CONNECTOR_SYMBOL_TYPES = new Set([33, 34, 35]);

/**
 * The Cache's symbols by name (§5.1), keeping the first variant of each group,
 * of the record `types` given, and only the names in `only` when given. A
 * symbol that will not decode is left out.
 */
export function readCacheSymbols(
  buffer: Buffer,
  only?: ReadonlySet<string>,
  types: ReadonlySet<number> = SYMBOL_TYPES
): Map<string, SymbolGraphics> {
  const symbols = new Map<string, SymbolGraphics>();
  walkCacheTables(buffer, (type, name, record) => {
    if (!types.has(type) || symbols.has(name) || (only && !only.has(name))) return;
    try {
      symbols.set(name, parseSymbolGraphics(record));
    } catch {
      // Drawn without this symbol.
    }
  });
  return symbols;
}

/**
 * A page graphic (types 55-62, 88, 89): the graphic-instance base, then one
 * GraphicObject holding one primitive in absolute page coordinates (§8.9).
 */
export function parsePageGraphic(reader: BinaryReader): Primitive | undefined {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData);
  readPreamble(reader);
  reader.skip(8); // name and library indexes, 0 on every page graphic
  reader.readStringLenZeroTerm(); // symbol name, empty
  reader.skip(4 + 8 + 4); // db_id, box, location
  const rotation = (reader.readUint16() >> 8) & 3;
  reader.skip(2); // type echo
  const displays = reader.readUint16();
  for (let i = 0; i < displays; i++) parseSymbolDisplayProp(reader);
  reader.skip(1); // symbol kind 2

  const object = new FutureDataList(reader);
  autoReadPrefixes(reader, object, StructureType.SthInPages0); // GraphicObject (§8.9)
  readPreamble(reader);
  reader.readStringLenZeroTerm(); // name, empty
  reader.readStringLenZeroTerm(); // source library, empty
  reader.skip(4); // colour
  const [primitive] = readPrimitiveList(reader);
  reader.skip(8); // box, all zero
  return primitive?.kind === "text" ? { ...primitive, rotation } : primitive;
}

/** Round up to a multiple of 10. */
const snap = (v: number): number => Math.ceil(v / 10) * 10;

/** The placement extent of one axis of a symbol box (§7.7). */
const extent = (lo: number, hi: number): [number, number] =>
  lo >= 0 ? [0, snap(lo + hi)] : [lo, lo + snap(hi - lo)];

/** Mirror negates x, then each quarter turn maps (x, y) to (y, -x). */
const orient =
  (rotation: number, mirrored: boolean): Transform =>
  ([x0, y]) => {
    const x = mirrored ? -x0 : x0;
    switch (rotation & 3) {
      case 1:
        return [y, -x];
      case 2:
        return [-x, -y];
      case 3:
        return [-y, x];
      default:
        return [x, y];
    }
  };

/** Symbol coordinates to page coordinates for one placement (§7.7). */
export function placement(
  box: SymbolGraphics["box"],
  locX: number,
  locY: number,
  rotation: number,
  mirrored: boolean
): Transform {
  const o = orient(rotation, mirrored);
  const [xLo, xHi] = extent(box.x1, box.x2);
  const [yLo, yHi] = extent(box.y1, box.y2);
  const corners = (
    [
      [xLo, yLo],
      [xHi, yLo],
      [xLo, yHi],
      [xHi, yHi],
    ] as Point[]
  ).map(o);
  const ox = locX - Math.min(...corners.map((c) => c[0]));
  const oy = locY - Math.min(...corners.map((c) => c[1]));
  return (p) => {
    const [x, y] = o(p);
    return [x + ox, y + oy];
  };
}

/**
 * A connector's connection point: the hot point of its cached symbol's single
 * pin, placed on the page (§7.7, §11.4). It lands on the connector's trailer
 * wire end on 17,596 of 17,604 connectors. Undefined without such a symbol.
 */
export function connectionPoint(
  sym: Pick<GraphicInst, "name" | "locX" | "locY" | "rotation" | "mirrored">,
  symbols: ReadonlyMap<string, SymbolGraphics>
): Point | undefined {
  const shape = symbols.get(sym.name);
  const pins = shape?.pins.filter((pin) => pin !== undefined) ?? [];
  if (!shape || pins.length !== 1) return undefined;
  return placement(
    shape.box,
    sym.locX,
    sym.locY,
    sym.rotation,
    sym.mirrored
  )([pins[0]!.hotX, pins[0]!.hotY]);
}
