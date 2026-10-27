// SPDX-License-Identifier: Apache-2.0
// Ported from westworld lib/kicad-builder/connectivity.ts at commit 255bbfb (same author,
// Valentino Zegna), relicensed under Apache-2.0. universal-netlist is now this
// reader's home; westworld is to consume it from here.

/**
 * Schematic connectivity for real KiCad 6 to 10 designs: which net every pin
 * is on, across a hierarchy of sheets, the way KiCad's netlister resolves it.
 *
 * The raw `.kicad_sch` reader (index.ts) runs it, and parity.test.ts checks
 * its netlists against `kicad-cli sch export netlist`.
 *
 * Covered: wires and junctions (items join where connection points coincide; a
 * pin tip, flag, or wire end in the middle of a wire stays apart from it, as in
 * KiCad); local, global, and hierarchical labels; sheet pins; global and local
 * power symbols; invisible power-input pins (KiCad's
 * implicit global nets); multi-unit and De Morgan symbols; rotated and mirrored
 * symbols; sheets used more than once; no-connect pins (never connected to what
 * they touch) and no-connect flags (they make a net's default name
 * `unconnected-(...)`); a sheet's local and hierarchical labels and power
 * symbols joining a global label or power symbol of the same name. Not covered: bus unfolding (members still connect
 * through their labels), and netclass directives.
 */

import { SegmentIndex } from "./segment-index.js";
import { childByTag, childrenByTag, parseSexpr, type SExpr } from "../sexpr.js";
import type { ResolvedSchematic } from "./netlist-writer.js";

// This repository's s-expression reader keeps every atom a string; the reader
// this was ported from parsed numbers into numbers. These helpers keep its
// interface over the shared reader.
type SExprNode = SExpr;
const parseSExpr = parseSexpr;
const findNode = (parent: SExprNode[], tag: string): SExprNode[] | null =>
  childByTag(parent, tag) ?? null;
const findAll = (parent: SExprNode[], tag: string): SExprNode[][] => childrenByTag(parent, tag);
const getAttr = (parent: SExprNode[], tag: string): string | null => {
  const node = childByTag(parent, tag);
  return node && typeof node[1] === "string" ? node[1] : null;
};

/** One design file, named as `Sheetfile` properties reference it. The root sheet comes first. */
export interface SchematicSource {
  name: string;
  content: string;
}

export interface SchematicPin {
  number: string;
  name: string;
  /** KiCad electrical type: input, output, bidirectional, passive, power_in, ... */
  type: string;
  net: string;
}

export interface SchematicComponent {
  reference: string;
  value: string;
  footprint: string;
  datasheet: string;
  /** The library symbol's description (`libsource` in KiCad's netlist). */
  libDescription: string;
  libId: string;
  /** Every field, Reference and Value included, in file order. */
  properties: { name: string; value: string }[];
  /** File holding the symbol, as named in the design's sources. */
  file: string;
  /** Sheet instance, as KiCad prints it: `/` for the root, `/Power/` below it. */
  sheet: string;
  /** The same sheet instance by uuids (`/<root>/<sheet>`), as KiCad and KiCanvas key it. */
  sheetPath: string;
  /** The uuids of the symbol's placed units in that file. */
  uuids: string[];
  dnp: boolean;
  /** `false` for symbols excluded from the board: KiCad leaves them out of the netlist. */
  onBoard: boolean;
  pins: SchematicPin[];
}

export interface SchematicNet {
  name: string;
  pins: { reference: string; pin: string }[];
}

export interface SchematicSheet {
  /** Sheet instance path as KiCad prints it (`/`, `/Power/`). */
  path: string;
  /** The same instance by uuids (`/<root>/<sheet>`). */
  uuidPath: string;
  name: string;
  file: string;
  page: string | null;
}

export interface SchematicDesign {
  title: string;
  sheets: SchematicSheet[];
  components: SchematicComponent[];
  nets: SchematicNet[];
}

// ---------------------------------------------------------------------------
// File model
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

interface LibPin {
  number: string;
  name: string;
  type: string;
  hidden: boolean;
  at: Point;
  unit: number;
  style: number;
}

interface LibSymbol {
  /** The library symbol's description, which KiCad's netlist reports as the part's `libsource` description. */
  description: string;
  pins: LibPin[];
  /** How many units the symbol has (U1A, U1B, ...). */
  units: number;
  /** `global` or `local` for power symbols. */
  power: "global" | "local" | null;
}

interface PlacedSymbol {
  uuid: string;
  libId: string;
  lib: LibSymbol | null;
  at: Point;
  transform: Transform;
  unit: number;
  style: number;
  properties: { name: string; value: string }[];
  dnp: boolean;
  onBoard: boolean;
  /** Instance path (`/root/sheet`) to reference and unit: a reused sheet can place another unit. */
  references: Map<string, { reference: string; unit: number }>;
}

interface SheetSymbol {
  uuid: string;
  name: string;
  file: string;
  pins: { name: string; at: Point }[];
  pages: Map<string, string>;
}

interface Label {
  name: string;
  at: Point;
  kind: "local" | "global" | "hier";
}

/** One symbol instance as a KiCad 6 root sheet records it, in `symbol_instances`. */
interface LegacyInstance {
  reference: string;
  unit: number;
  value: string;
  footprint: string;
}

/**
 * The first schematic format of KiCad 7, which names a power symbol's net
 * after its Value. Earlier files (KiCad 6) name it after the power pin, and
 * keep each symbol instance's reference, unit, value and footprint in the root
 * sheet's `symbol_instances`.
 */
export const KICAD_7_FORMAT = 20230121;

interface SheetFile {
  uuid: string;
  /** The file's `(version ...)`, a date such as 20230121. */
  version: number;
  /** KiCad 6 root sheets: each instance by its path below the root, `/<sheet>/.../<symbol>`. */
  legacyInstances: Map<string, LegacyInstance>;
  /** Bus aliases (`bus_alias`) defined in this file. */
  aliases: Map<string, string[]>;
  title: string;
  libs: Map<string, LibSymbol>;
  wires: [Point, Point][];
  buses: [Point, Point][];
  junctions: Point[];
  /** Where `no_connect` flags sit. */
  noConnects: Point[];
  labels: Label[];
  symbols: PlacedSymbol[];
  sheets: SheetSymbol[];
}

const str = (node: SExprNode | number | undefined): string =>
  typeof node === "string" ? node : typeof node === "number" ? String(node) : "";

const num = (node: SExprNode | number | undefined): number => {
  if (typeof node === "number") return node;
  const value = typeof node === "string" ? Number(node) : NaN;
  return Number.isFinite(value) ? value : 0;
};

function pointOf(node: SExprNode[] | null): Point {
  return node ? { x: num(node[1]), y: num(node[2]) } : { x: 0, y: 0 };
}

/** `hide`, `(hide)`, or `(hide yes)` among a node's children. */
function isHidden(node: SExprNode[]): boolean {
  return node.some((c) => c === "hide" || (Array.isArray(c) && c[0] === "hide" && c[1] !== "no"));
}

function yes(node: SExprNode[], tag: string): boolean {
  const child = findNode(node, tag);
  return !!child && child[1] !== "no";
}

function properties(node: SExprNode[]): { name: string; value: string }[] {
  return findAll(node, "property").map((p) => ({ name: str(p[1]), value: str(p[2]) }));
}

/** Pins of an embedded library symbol, from its `Name_<unit>_<style>` sub-symbols. */
function parseLibSymbol(node: SExprNode[]): LibSymbol {
  const pins: LibPin[] = [];
  const collect = (owner: SExprNode[], unit: number, style: number) => {
    for (const pin of findAll(owner, "pin")) {
      const at = findNode(pin, "at");
      pins.push({
        type: str(pin[1]),
        number: str(findNode(pin, "number")?.[1]),
        name: str(findNode(pin, "name")?.[1]),
        hidden: isHidden(pin),
        at: pointOf(at),
        unit,
        style,
      });
    }
  };
  collect(node, 0, 0);
  for (const sub of findAll(node, "symbol")) {
    const match = /_(\d+)_(\d+)$/.exec(str(sub[1]));
    collect(sub, match ? Number(match[1]) : 0, match ? Number(match[2]) : 0);
  }
  const power = findNode(node, "power");
  // KiCad 8 and later name it Description; earlier files keep ki_description.
  const described = (name: string) =>
    findAll(node, "property").find((p) => str(p[1]) === name)?.[2];
  return {
    description: str(described("Description") ?? described("ki_description")),
    pins,
    units: Math.max(1, ...pins.map((p) => p.unit)),
    power: power ? (power[1] === "local" ? "local" : "global") : null,
  };
}

/**
 * KiCad's symbol orientation matrix (`TRANSFORM`): schematic offset =
 * (x1 * lib.x + y1 * lib.y, x2 * lib.x + y2 * lib.y). Built the way
 * `SCH_SYMBOL::SetOrientation` builds it: rotate, then mirror.
 */
interface Transform {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function compose(m: Transform, t: Transform): Transform {
  return {
    x1: m.x1 * t.x1 + m.x2 * t.y1,
    y1: m.y1 * t.x1 + m.y2 * t.y1,
    x2: m.x1 * t.x2 + m.x2 * t.y2,
    y2: m.y1 * t.x2 + m.y2 * t.y2,
  };
}

const CCW: Transform = { x1: 0, y1: 1, x2: -1, y2: 0 };
const CW: Transform = { x1: 0, y1: -1, x2: 1, y2: 0 };
const MIRROR_X: Transform = { x1: 1, y1: 0, x2: 0, y2: -1 };
const MIRROR_Y: Transform = { x1: -1, y1: 0, x2: 0, y2: 1 };

/** The transform for a symbol placed at `angle` degrees, mirrored about `x` or `y` or not. */
export function symbolTransform(angle: number, mirror: string | null): Transform {
  let m: Transform = { x1: 1, y1: 0, x2: 0, y2: -1 };
  const turns = ((Math.round(angle / 90) % 4) + 4) % 4;
  if (turns === 1) m = compose(m, CCW);
  if (turns === 2) m = compose(compose(m, CCW), CCW);
  if (turns === 3) m = compose(m, CW);
  if (mirror === "x") m = compose(m, MIRROR_X);
  if (mirror === "y") m = compose(m, MIRROR_Y);
  return m;
}

function apply(t: Transform, p: Point): Point {
  return { x: t.x1 * p.x + t.y1 * p.y, y: t.x2 * p.x + t.y2 * p.y };
}

/** The two ends of each `wire` or `bus` in a sheet. */
function segments(root: SExprNode[], tag: "wire" | "bus"): [Point, Point][] {
  return findAll(root, tag).map((w) => {
    const pts = findAll(findNode(w, "pts") ?? [], "xy").map((xy) => pointOf(xy));
    return [pts[0] ?? { x: 0, y: 0 }, pts[1] ?? pts[0] ?? { x: 0, y: 0 }];
  });
}

/** What a point on the sheet is, which decides how it reaches a segment it only touches in the middle. */
type PointKind = "wire-end" | "junction" | "label" | "sheet-pin" | "other";

interface GeometryPoint {
  at: Point;
  node: number;
  kind: PointKind;
}

/**
 * Join what touches, the way KiCad's connection graph does. Items meet only
 * where their connection points coincide: a wire's two ends, a pin's tip, a
 * flag, a label's anchor. A point in the middle of a wire (a pin tip, a no-connect
 * flag, another wire's end) is NOT joined to it, so a T without a junction dot
 * stays open. Three things reach a segment's middle:
 *
 * - a junction joins every segment passing through it;
 * - a label joins every segment under its anchor when there are two or more
 *   (a pin or flag there does not matter), and a single one unless a pin tip
 *   or a no-connect flag sits on the anchor;
 * - a sheet pin joins the first segment under it, unless a pin tip or a
 *   no-connect flag sits on it.
 *
 * `blockers` holds the keys of the points where a pin tip or a no-connect flag
 * is, whether or not the pin is connectable.
 *
 * Rules and golden table: `docs/decision-tables/connectivity/wire-contacts`.
 */
function connectGeometry(
  uf: UnionFind,
  points: GeometryPoint[],
  segmentList: [Point, Point][],
  segmentNodes: number[],
  blockers: Set<string>
): void {
  const byPoint = new Map<string, number>();
  for (const { at, node } of points) {
    const existing = byPoint.get(key(at));
    if (existing === undefined) byPoint.set(key(at), node);
    else uf.union(existing, node);
  }
  const index = new SegmentIndex(segmentList);
  for (const { at, node, kind } of points) {
    if (kind !== "junction" && kind !== "label" && kind !== "sheet-pin") continue;
    const under = index.under(at);
    if (kind === "junction" || (kind === "label" && under.length >= 2)) {
      for (const i of under) uf.union(node, segmentNodes[i]!);
    } else if (under.length && !blockers.has(key(at))) {
      uf.union(node, segmentNodes[under[0]!]!);
    }
  }
}

function parseSheetFile(content: string): SheetFile {
  const root = parseSExpr(content)[0];
  if (!Array.isArray(root) || root[0] !== "kicad_sch") throw new Error("Not a KiCad schematic");

  const libs = new Map<string, LibSymbol>();
  for (const lib of findAll(findNode(root, "lib_symbols") ?? [], "symbol")) {
    libs.set(str(lib[1]), parseLibSymbol(lib));
  }

  const symbols: PlacedSymbol[] = findAll(root, "symbol").map((node) => {
    const libId = str(getAttr(node, "lib_id") ?? "");
    const libName = str(getAttr(node, "lib_name") ?? "") || libId;
    const at = findNode(node, "at");
    const references = new Map<string, { reference: string; unit: number }>();
    for (const project of findAll(findNode(node, "instances") ?? [], "project")) {
      for (const path of findAll(project, "path")) {
        references.set(str(path[1]), {
          reference: str(getAttr(path, "reference") ?? ""),
          unit: num(getAttr(path, "unit") ?? 0),
        });
      }
    }
    return {
      uuid: str(getAttr(node, "uuid") ?? ""),
      libId,
      lib: libs.get(libName) ?? libs.get(libId) ?? null,
      at: pointOf(at),
      transform: symbolTransform(num(at?.[3]), str(getAttr(node, "mirror") ?? "") || null),
      unit: num(getAttr(node, "unit") ?? 1) || 1,
      style: num(getAttr(node, "body_style") ?? getAttr(node, "convert") ?? 1) || 1,
      properties: properties(node),
      dnp: yes(node, "dnp"),
      onBoard: findNode(node, "on_board")?.[1] !== "no",
      references,
    };
  });

  const sheets: SheetSymbol[] = findAll(root, "sheet").map((node) => {
    const props = properties(node);
    const prop = (...names: string[]) => props.find((p) => names.includes(p.name))?.value ?? "";
    const pages = new Map<string, string>();
    for (const project of findAll(findNode(node, "instances") ?? [], "project")) {
      for (const path of findAll(project, "path")) {
        pages.set(str(path[1]), str(getAttr(path, "page") ?? ""));
      }
    }
    return {
      uuid: str(getAttr(node, "uuid") ?? ""),
      name: prop("Sheetname", "Sheet name"),
      file: prop("Sheetfile", "Sheet file"),
      pins: findAll(node, "pin").map((pin) => ({
        name: str(pin[1]),
        at: pointOf(findNode(pin, "at")),
      })),
      pages,
    };
  });

  const labels: Label[] = [];
  for (const [tag, kind] of [
    ["label", "local"],
    ["global_label", "global"],
    ["hierarchical_label", "hier"],
  ] as const) {
    for (const node of findAll(root, tag)) {
      labels.push({ name: str(node[1]), at: pointOf(findNode(node, "at")), kind });
    }
  }

  const legacyInstances = new Map<string, LegacyInstance>();
  for (const path of findAll(findNode(root, "symbol_instances") ?? [], "path")) {
    legacyInstances.set(str(path[1]), {
      reference: str(getAttr(path, "reference") ?? ""),
      unit: num(getAttr(path, "unit") ?? 0),
      value: str(getAttr(path, "value") ?? ""),
      footprint: str(getAttr(path, "footprint") ?? ""),
    });
  }

  const aliases = new Map<string, string[]>();
  for (const alias of findAll(root, "bus_alias")) {
    aliases.set(str(alias[1]), (findNode(alias, "members") ?? []).slice(1).map(str));
  }

  return {
    uuid: str(getAttr(root, "uuid") ?? ""),
    version: num(getAttr(root, "version") ?? 0),
    legacyInstances,
    aliases,
    title: str(getAttr(findNode(root, "title_block") ?? [], "title") ?? ""),
    libs,
    wires: segments(root, "wire"),
    buses: segments(root, "bus"),
    junctions: findAll(root, "junction").map((j) => pointOf(findNode(j, "at"))),
    noConnects: findAll(root, "no_connect").map((n) => pointOf(findNode(n, "at"))),
    labels,
    symbols,
    sheets,
  };
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

/** KiCad's driver priorities (`CONNECTION_SUBGRAPH::PRIORITY`): the strongest names the net. */
export const PRIORITY = {
  pin: 1,
  sheetPin: 2,
  hier: 3,
  local: 4,
  localPower: 5,
  power: 6,
  global: 7,
} as const;

class UnionFind {
  private parent: number[] = [];
  add(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

const key = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

/** A named driver of a net and its priority. `depth` is the sheet depth (root 0). */
/** Something that names a net: a label, a power symbol, a bus member, a sheet pin. */
export interface Driver {
  name: string;
  priority: number;
  depth: number;
  /**
   * For a bus member's name: whether its bus reaches other sheets (through a
   * hierarchical label or a sheet pin) or stays on its own sheet.
   */
  bus?: "hierarchical" | "sheet";
}

export interface PinNode {
  reference: string;
  /** The reference with its unit letter for multi-unit symbols (U1A), as KiCad names nets. */
  unitReference: string;
  pin: string;
  name: string;
  type: string;
  sharesName: boolean;
  component: SchematicComponent;
}

/** Natural order, so R2 sorts before R10 (KiCad's StrNumCmp). */
const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare;

/**
 * The name a power symbol gives its net: its Value in a KiCad 7 or later file,
 * unless the Value is empty or `~`; its power pin's name in a KiCad 6 file,
 * as KiCad still reads one. See docs/decision-tables/kicad-schematic.
 */
export function powerNetName(fileVersion: number, value: string, pinName: string): string {
  return fileVersion >= KICAD_7_FORMAT && value && value !== "~" ? value : pinName;
}

/**
 * Whether driver `a` names a net over `b`. A power symbol or a global label
 * names its net whatever else is on it. Otherwise a bus member is named by its
 * bus, over the labels on the member's own wires: KiCad renames bus members as
 * it propagates a bus through the hierarchy. A bus that reaches other sheets
 * names its members over a bus that stays on one sheet, since KiCad does not
 * rename a member already renamed from another sheet. Then the stronger label,
 * the shallower sheet, and the lower name, as KiCad picks a net's name
 * (kicad-cli 10.0.5 on test/fixtures/kicad: cm5-minima, cynthion-usb-fpga,
 * yddraig-68k).
 */
export function better(a: Driver, b: Driver): boolean {
  const named = (d: Driver) => d.priority >= PRIORITY.localPower;
  if (!named(a) && !named(b)) {
    const rank = (d: Driver) => (d.bus === "hierarchical" ? 2 : d.bus === "sheet" ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) > rank(b);
  }
  if (a.priority !== b.priority) return a.priority > b.priority;
  if (a.depth !== b.depth) return a.depth < b.depth;
  return a.name < b.name;
}

/**
 * A bus group `PREFIX{members}`, or `null`. Braces after `~`, `_`, or `^` are
 * KiCad text markup (overbar, subscript, superscript), not a group.
 */
function busGroup(name: string): { prefix: string; body: string } | null {
  for (let i = 0; i < name.length; i++) {
    if (name[i] !== "{" || (i > 0 && "~_^".includes(name[i - 1]!))) continue;
    let level = 0;
    for (let j = i; j < name.length; j++) {
      if (name[j] === "{") level++;
      else if (name[j] === "}" && --level === 0) {
        return j === name.length - 1
          ? { prefix: name.slice(0, i), body: name.slice(i + 1, j) }
          : null;
      }
    }
    return null;
  }
  return null;
}

/**
 * The member nets of a bus name: `A[0..3]` is A0 to A3, `{SDA SCL}` is SDA and
 * SCL, `I2C{SDA SCL}` is I2C.SDA and I2C.SCL, and a group member that names a
 * bus alias stands for the alias's members. A plain net name has none. Buses
 * that share a wire match their members by `leaf`: a vector member's index,
 * or a group member's name inside the braces (SDA).
 */
export function busMembers(
  name: string,
  aliases: ReadonlyMap<string, string[]> = new Map()
): { name: string; leaf: string }[] {
  // A vector may sit inside text markup: ~{IPL[0..2]} is ~{IPL0} to ~{IPL2}.
  const vector = /^(.*)\[(\d+)\.\.(\d+)\](\}*)$/.exec(name);
  if (vector && !busGroup(name)) {
    const [from, to] = [Number(vector[2]), Number(vector[3])];
    const step = from <= to ? 1 : -1;
    const members: { name: string; leaf: string }[] = [];
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
      members.push({ name: `${vector[1]}${i}${vector[4]}`, leaf: `[${i}]` });
    }
    return members;
  }
  const group = busGroup(name);
  if (!group) return [];
  const prefix = group.prefix ? `${group.prefix}.` : "";
  const expand = (member: string, seen: Set<string>): string[] => {
    const alias = aliases.get(member);
    if (alias && !seen.has(member)) {
      return alias.flatMap((m) => expand(m, new Set([...seen, member])));
    }
    const inner = busMembers(member, aliases);
    return inner.length ? inner.map((m) => m.name) : [member];
  };
  return group.body
    .split(/[\s,]+/)
    .filter(Boolean)
    .flatMap((member) => expand(member, new Set()))
    .map((leaf) => ({ name: `${prefix}${leaf}`, leaf }));
}

/** KiCad's escaping of a name inside a generated net name. */
const escapeName = (name: string) => name.replace(/\//g, "{slash}");

/** KiCad's unit letters: 1 is A, 26 is Z, 27 is AA. */
function unitLetter(unit: number): string {
  let letters = "";
  for (let n = unit; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/**
 * KiCad's name for a pin's own net: `Net-(R1-Pad1)`, `Net-(U1A-SDA)` for a named
 * pin, and `Net-(U1A-SDA-Pad3)` when another pin of the unit shares the name.
 */
export function pinNetName(p: PinNode, unconnected: boolean): string {
  const named = p.name && p.name !== "~" && p.name !== p.pin;
  // KiCad writes the unit letter only beside a pin name: Net-(U1A-CK1), but
  // Net-(SW602-Pad1) for an unnamed pin of a two-unit switch. Every saved
  // export in test/fixtures/kicad follows this, 10.0.0 and 10.0.5 alike.
  const ref = named ? p.unitReference : p.reference;
  if (unconnected) {
    return `unconnected-(${ref}-${named ? `${escapeName(p.name)}-` : ""}Pad${p.pin})`;
  }
  if (!named) return `Net-(${ref}-Pad${p.pin})`;
  return `Net-(${ref}-${escapeName(p.name)}${p.sharesName ? `-Pad${p.pin}` : ""})`;
}

/**
 * The name of a net no label or power symbol names, as KiCad picks it: from
 * its pins, preferring a named pin's name over a `-Pad` one, then the first
 * in plain string order. A lone pin, a no-connect pin, and a net with a
 * no-connect flag are `unconnected-(...)`.
 */
function defaultNetName(pins: PinNode[], flagged: boolean): string {
  if (pins.length === 1) return pinNetName(pins[0]!, true);
  const names = pins.map((p) => pinNetName(p, flagged));
  return names.sort((a, b) => {
    const lowA = a.includes("-Pad");
    const lowB = b.includes("-Pad");
    if (lowA !== lowB) return lowA ? 1 : -1;
    return a < b ? -1 : a > b ? 1 : 0;
  })[0]!;
}

/**
 * Resolve a design's connectivity. `sources[0]` is the root sheet; the others
 * are found by the names its sheets reference. Missing sheets are skipped.
 */
export function analyzeSchematic(
  sources: SchematicSource[],
  /**
   * The project file's bus aliases (`schematic.bus_aliases` in the .kicad_pro):
   * KiCad 10 keeps them there instead of in the sheets (issue 211).
   */
  options: { busAliases?: Record<string, string[]> } = {}
): SchematicDesign {
  if (!sources.length) throw new Error("No schematic");
  const parsed = new Map<string, SheetFile>();
  const fileByName = (name: string): SheetFile | null => {
    if (!parsed.has(name)) {
      const source = sources.find((s) => s.name === name);
      if (!source) return null;
      parsed.set(name, parseSheetFile(source.content));
    }
    return parsed.get(name)!;
  };

  const rootName = sources[0]!.name;
  const root = fileByName(rootName)!;
  // Bus aliases live in the project file (KiCad 10) or the root sheet (KiCad 9 and
  // earlier); any sheet's own add to them.
  const aliases = new Map(Object.entries(options.busAliases ?? {}));
  for (const [name, members] of root.aliases) if (!aliases.has(name)) aliases.set(name, members);
  for (const source of sources) {
    for (const [name, members] of fileByName(source.name)?.aliases ?? []) {
      if (!aliases.has(name)) aliases.set(name, members);
    }
  }
  const uf = new UnionFind();
  const drivers = new Map<number, Driver[]>();
  const pins: { node: number; pin: PinNode }[] = [];
  const components: SchematicComponent[] = [];
  const sheets: SchematicSheet[] = [];
  const globalNames = new Map<string, number>();
  const noConnectNodes: number[] = [];
  const addDriver = (node: number, driver: Driver) => {
    drivers.set(node, [...(drivers.get(node) ?? []), driver]);
  };
  const joinByName = (names: Map<string, number>, name: string, node: number) => {
    const existing = names.get(name);
    if (existing === undefined) names.set(name, node);
    else uf.union(existing, node);
  };

  /**
   * Connect one sheet instance. Returns its hierarchical labels' nodes and its
   * local net names' nodes, by name, for the parent to join through sheet pins.
   */
  const visit = (
    file: SheetFile,
    fileName: string,
    uuidPath: string,
    humanPath: string,
    depth: number,
    visiting: Set<string>
  ): {
    hier: Map<string, number>;
    local: Map<string, number>;
    hierBus: Map<string, Map<string, number>>;
  } => {
    const localNames = new Map<string, number>();
    const hierNodes = new Map<string, number>();
    const points: GeometryPoint[] = [];
    const wireNodes = file.wires.map(() => uf.add());
    // Where a pin tip or a no-connect flag sits (see connectGeometry).
    const blockers = new Set<string>();

    const attach = (at: Point, node: number, kind: PointKind = "other") =>
      points.push({ at, node, kind });

    for (const [i, [a, b]] of file.wires.entries()) {
      attach(a, wireNodes[i]!, "wire-end");
      attach(b, wireNodes[i]!, "wire-end");
    }
    for (const at of file.junctions) attach(at, uf.add(), "junction");
    for (const at of file.noConnects) {
      const node = uf.add();
      attach(at, node);
      noConnectNodes.push(node);
      blockers.add(key(at));
    }

    for (const label of file.labels) {
      const node = uf.add();
      attach(label.at, node, "label");
      if (label.kind === "global") {
        addDriver(node, { name: label.name, priority: PRIORITY.global, depth: 0 });
        joinByName(globalNames, label.name, node);
        // On its own sheet a global label also joins the local and hierarchical
        // labels, and the power symbols, of the same name: KiCad merges a sheet's
        // strong drivers by their short name.
        joinByName(localNames, label.name, node);
      } else if (label.kind === "local") {
        addDriver(node, {
          name: `${humanPath}${label.name}`,
          priority: PRIORITY.local,
          depth,
        });
        joinByName(localNames, label.name, node);
      } else {
        addDriver(node, { name: `${humanPath}${label.name}`, priority: PRIORITY.hier, depth });
        joinByName(hierNodes, label.name, node);
        // On its own sheet a hierarchical label is also a local name.
        joinByName(localNames, label.name, node);
      }
    }

    const grouped = new Map<string, SchematicComponent>();
    for (const symbol of file.symbols) {
      // A KiCad 6 design records each instance in the root sheet, by its path
      // below the root; its value and footprint there are the instance's own.
      const legacy = root.legacyInstances.get(
        `${uuidPath.slice(`/${root.uuid}`.length)}/${symbol.uuid}`
      );
      const own = (name: string) => symbol.properties.find((p) => p.name === name)?.value ?? "";
      const field = (name: string) =>
        legacy && name === "Value"
          ? legacy.value
          : legacy && name === "Footprint"
            ? legacy.footprint
            : own(name);
      const instance = symbol.references.get(uuidPath) ?? legacy;
      const reference = instance?.reference || field("Reference");
      const unit = instance?.unit || symbol.unit;
      const lib = symbol.lib;
      const unitPins = (lib?.pins ?? []).filter(
        (p) => (p.unit === 0 || p.unit === unit) && (p.style === 0 || p.style === symbol.style)
      );

      if (lib?.power) {
        // A power symbol's power input names its net after the symbol's value
        // (KiCad 7+), globally or per sheet. Its other pins (PWR_FLAG) only touch.
        for (const pin of unitPins) {
          const node = uf.add();
          const offset = apply(symbol.transform, pin.at);
          const at = { x: symbol.at.x + offset.x, y: symbol.at.y + offset.y };
          attach(at, node);
          blockers.add(key(at));
          if (pin.type !== "power_in") continue;
          // KiCad 7 and later name the net after the symbol's value; a KiCad 6
          // file, after the power pin, as KiCad still reads one.
          const value = field("Value");
          const name = powerNetName(file.version, value, pin.name);
          if (lib.power === "local") {
            addDriver(node, {
              name: `${humanPath}${name}`,
              priority: PRIORITY.localPower,
              depth,
            });
            joinByName(localNames, name, node);
          } else {
            addDriver(node, { name, priority: PRIORITY.power, depth: 0 });
            joinByName(globalNames, name, node);
            joinByName(localNames, name, node);
          }
        }
        continue;
      }

      let component = grouped.get(reference);
      if (!component) {
        component = {
          reference,
          value: field("Value"),
          footprint: field("Footprint"),
          datasheet: field("Datasheet"),
          libDescription: lib?.description ?? "",
          libId: symbol.libId,
          properties: symbol.properties.map((p) =>
            p.name === "Reference" || p.name === "Value" || p.name === "Footprint"
              ? { ...p, value: p.name === "Reference" ? reference : field(p.name) }
              : p
          ),
          file: fileName,
          sheet: humanPath,
          sheetPath: uuidPath,
          uuids: [],
          dnp: symbol.dnp,
          onBoard: symbol.onBoard,
          pins: [],
        };
        grouped.set(reference, component);
        if (!reference.startsWith("#")) components.push(component);
      }
      component.uuids.push(symbol.uuid);

      for (const pin of unitPins) {
        const node = uf.add();
        const offset = apply(symbol.transform, pin.at);
        const at = { x: symbol.at.x + offset.x, y: symbol.at.y + offset.y };
        blockers.add(key(at));
        // A no-connect pin touches nothing: KiCad never joins it to a wire, a flag, or a pin.
        if (pin.type !== "no_connect") attach(at, node);
        if (pin.hidden && pin.type === "power_in") {
          // Invisible power inputs join the global net named after the pin.
          addDriver(node, { name: pin.name, priority: PRIORITY.power, depth: 0 });
          joinByName(globalNames, pin.name, node);
          joinByName(localNames, pin.name, node);
        }
        if (reference.startsWith("#")) continue;
        const pinNode: PinNode = {
          reference,
          unitReference: lib && lib.units > 1 ? `${reference}${unitLetter(unit)}` : reference,
          pin: pin.number,
          name: pin.name,
          type: pin.type,
          // Another pin of the unit shares its name: KiCad then keeps the pad number in the net name.
          sharesName:
            pin.type !== "no_connect" &&
            unitPins.some(
              (q) => q.name === pin.name && q.number !== pin.number && q.type !== "no_connect"
            ),
          component,
        };
        pins.push({ node, pin: pinNode });
      }
    }

    const children: { sheet: SheetSymbol; pinNodes: Map<string, number> }[] = [];
    for (const sheet of file.sheets) {
      const pinNodes = new Map<string, number>();
      for (const pin of sheet.pins) {
        const node = uf.add();
        attach(pin.at, node, "sheet-pin");
        addDriver(node, {
          name: `${humanPath}${pin.name}`,
          priority: PRIORITY.sheetPin,
          depth,
        });
        joinByName(pinNodes, pin.name, node);
      }
      children.push({ sheet, pinNodes });
    }

    connectGeometry(uf, points, file.wires, wireNodes, blockers);

    // Buses: bus wires join the bus labels, bus hierarchical labels, and bus
    // sheet pins on them into groups. A group's members are this sheet's nets
    // of those names, and reach other sheets through its sheet pins and
    // global labels.
    const busItems = [
      ...file.labels.map((label) => ({
        at: label.at,
        name: label.name,
        kind: label.kind as string,
        sheetPin: false,
      })),
      ...file.sheets.flatMap((sheet) =>
        sheet.pins.map((pin) => ({ at: pin.at, name: pin.name, kind: sheet.uuid, sheetPin: true }))
      ),
    ].filter((item) => busMembers(item.name, aliases).length);
    const busUf = new UnionFind();
    const busWireNodes = file.buses.map(() => busUf.add());
    const busItemNodes = busItems.map(() => busUf.add());
    connectGeometry(
      busUf,
      [
        ...file.buses.flatMap(([a, b], i): GeometryPoint[] => [
          { at: a, node: busWireNodes[i]!, kind: "wire-end" },
          { at: b, node: busWireNodes[i]!, kind: "wire-end" },
        ]),
        ...file.junctions.map((at): GeometryPoint => ({ at, node: busUf.add(), kind: "junction" })),
        ...busItems.map(
          (item, i): GeometryPoint => ({
            at: item.at,
            node: busItemNodes[i]!,
            kind: item.sheetPin ? "sheet-pin" : "label",
          })
        ),
      ],
      file.buses,
      busWireNodes,
      blockers
    );
    // Labels of one name join on their sheet, buses as nets do: a local bus
    // label and a hierarchical label both spelled D[0..15] are one bus.
    const byName = new Map<string, number>();
    for (const [i, item] of busItems.entries()) {
      if (item.sheetPin) continue;
      const first = byName.get(item.name);
      if (first === undefined) byName.set(item.name, busItemNodes[i]!);
      else busUf.union(first, busItemNodes[i]!);
    }
    // Each group is named by its strongest bus label (global, then local, then
    // hierarchical, then a sheet pin; then by name), and its member nets carry
    // that label's member names. Every bus in the group shares the members by leaf.
    const BUS_PRIORITY: Record<string, number> = { global: 4, local: 3, hier: 2 };
    const busGroups = new Map<number, typeof busItems>();
    for (const [i, item] of busItems.entries()) {
      const group = busUf.find(busItemNodes[i]!);
      busGroups.set(group, [...(busGroups.get(group) ?? []), item]);
    }
    const hierBus = new Map<string, Map<string, number>>();
    const sheetPinMembers = new Map<string, Map<string, number>>();
    for (const items of busGroups.values()) {
      const driver = [...items].sort(
        (a, b) =>
          (BUS_PRIORITY[b.kind] ?? 1) - (BUS_PRIORITY[a.kind] ?? 1) ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      )[0]!;
      const reachesOtherSheets = items.some(
        (item) => item.kind === "hier" || item.kind === "global" || item.sheetPin
      );
      const leaves = new Map<string, number>();
      const leafNode = (leaf: string) => {
        if (!leaves.has(leaf)) leaves.set(leaf, uf.add());
        return leaves.get(leaf)!;
      };
      const memberPriority =
        driver.kind === "global"
          ? PRIORITY.global
          : driver.kind === "local"
            ? PRIORITY.local
            : driver.kind === "hier"
              ? PRIORITY.hier
              : PRIORITY.sheetPin;
      for (const member of busMembers(driver.name, aliases)) {
        const node = leafNode(member.leaf);
        joinByName(localNames, member.name, node);
        addDriver(node, {
          name: driver.kind === "global" ? member.name : `${humanPath}${member.name}`,
          priority: memberPriority,
          depth: driver.kind === "global" ? 0 : depth,
          bus: reachesOtherSheets ? "hierarchical" : "sheet",
        });
      }
      for (const item of items) {
        const members = new Map<string, number>();
        for (const member of busMembers(item.name, aliases)) {
          const node = leafNode(member.leaf);
          members.set(member.leaf, node);
          if (item.kind === "global") joinByName(globalNames, member.name, node);
          else if (item.kind === "local") joinByName(localNames, member.name, node);
        }
        if (item.kind === "hier") hierBus.set(item.name, members);
        else if (item.kind !== "local" && item.kind !== "global") {
          sheetPinMembers.set(`${item.kind}\u0000${item.name}`, members);
        }
      }
    }

    sheets.push({
      path: humanPath,
      uuidPath,
      name: depth === 0 ? file.title || rootName : humanPath.split("/").at(-2)!,
      file: fileName,
      page: null,
    });
    const self = sheets.at(-1)!;

    for (const { sheet, pinNodes } of children) {
      const child = fileByName(sheet.file);
      if (!child || visiting.has(sheet.file)) continue;
      const childPath = `${uuidPath === "/" ? "" : uuidPath}/${sheet.uuid}`;
      const index = sheets.length;
      const childNets = visit(
        child,
        sheet.file,
        childPath,
        `${humanPath}${sheet.name}/`,
        depth + 1,
        new Set([...visiting, sheet.file])
      );
      sheets[index]!.page = sheet.pages.get(uuidPath) ?? null;
      for (const [name, node] of pinNodes) {
        const inner = childNets.hier.get(name);
        if (inner !== undefined) uf.union(node, inner);
        // A bus through the sheet pin carries its members to the same names below.
        const below = childNets.hierBus.get(name);
        for (const [leaf, outer] of sheetPinMembers.get(`${sheet.uuid}\u0000${name}`) ?? []) {
          const inner = below?.get(leaf);
          if (inner !== undefined) uf.union(outer, inner);
        }
      }
    }
    if (depth === 0) self.page = "1";
    return { hier: hierNodes, local: localNames, hierBus };
  };

  visit(root, rootName, `/${root.uuid}`, "/", 0, new Set([rootName]));

  // Group pins by net and name each net after its strongest driver.
  const best = new Map<number, Driver>();
  for (const [node, list] of drivers) {
    const rootNode = uf.find(node);
    for (const driver of list) {
      const current = best.get(rootNode);
      if (!current || better(driver, current)) best.set(rootNode, driver);
    }
  }
  const flagged = new Set(noConnectNodes.map((node) => uf.find(node)));
  const members = new Map<number, PinNode[]>();
  for (const { node, pin } of pins) {
    const rootNode = uf.find(node);
    members.set(rootNode, [...(members.get(rootNode) ?? []), pin]);
  }

  const nets: SchematicNet[] = [];
  for (const [rootNode, list] of members) {
    list.sort((a, b) => natural(a.reference, b.reference) || natural(a.pin, b.pin));
    const seen = new Set<string>();
    const unique = list.filter((p) => {
      const id = `${p.reference}\u0000${p.pin}`;
      return !seen.has(id) && seen.add(id);
    });
    const onBoard = unique.filter((p) => p.component.onBoard);
    const name =
      best.get(rootNode)?.name ??
      defaultNetName(onBoard.length ? onBoard : unique, flagged.has(rootNode));
    if (onBoard.length) {
      nets.push({ name, pins: onBoard.map((p) => ({ reference: p.reference, pin: p.pin })) });
    }
    for (const p of unique) {
      p.component.pins.push({ number: p.pin, name: p.name, type: p.type, net: name });
    }
  }
  nets.sort((a, b) => natural(a.name, b.name));
  components.sort((a, b) => natural(a.reference, b.reference));
  for (const component of components) component.pins.sort((a, b) => natural(a.number, b.number));

  return { title: root.title, sheets, components, nets };
}

/**
 * A design's connectivity as the netlist writer takes it: the parts on the
 * board, each with its fields, and every net with its pins' names and types.
 * Power symbols and other `#` references are not parts, and a part excluded
 * from the board is left out, as KiCad's netlister leaves it out.
 */
export function resolveSchematic(
  sources: SchematicSource[],
  options: { busAliases?: Record<string, string[]> } = {}
): ResolvedSchematic {
  const design = analyzeSchematic(sources, options);
  const parts = design.components.filter((component) => component.onBoard);
  const pinOf = new Map<string, SchematicPin>();
  for (const component of parts) {
    for (const pin of component.pins) pinOf.set(`${component.reference}\u0000${pin.number}`, pin);
  }
  return {
    components: parts.map((component) => ({
      reference: component.reference,
      value: component.value,
      footprint: component.footprint,
      libDescription: component.libDescription,
      properties: component.properties,
      dnp: component.dnp,
    })),
    nets: design.nets.map((net) => ({
      name: net.name,
      pins: net.pins.map(({ reference, pin }) => {
        const found = pinOf.get(`${reference}\u0000${pin}`);
        return { reference, pin, name: found?.name ?? "", type: found?.type ?? "" };
      }),
    })),
  };
}
