/**
 * Which records on a sheet connect: by geometry, through a spatial index, and by name.
 */

import { RECORD_TYPES, type AltiumRecord } from "./types.js";
import { identifierKey } from "./notation.js";
import { fieldText } from "./records.js";
import {
  COORDINATE_SCALE,
  TOUCH_TOLERANCE,
  pointOnSegment,
  pointsTouch,
  type Point,
} from "./coordinates.js";
import { UnionFind } from "./union-find.js";

type Segment = [Point, Point];

/** Records drawn as lines: every consecutive pair of points is a segment. */
const LINES = new Set<string | undefined>([RECORD_TYPES.WIRE, RECORD_TYPES.BUS]);

/** Records drawn from one point to another. */
const BARS = new Set<string | undefined>([
  RECORD_TYPES.PIN,
  RECORD_TYPES.PORT,
  RECORD_TYPES.BUS_ENTRY,
]);

/** A record's segments; a lone point is a segment of zero length. */
const segmentsOf = (device: AltiumRecord): Segment[] => {
  const points = device.coords ?? [];
  if (points.length === 0) return [];
  if (points.length > 1 && LINES.has(device.RECORD)) {
    return points.slice(1).map((point, i) => [points[i], point]);
  }
  if (points.length > 1 && BARS.has(device.RECORD)) return [[points[0], points[1]]];
  return [[points[0], points[0]]];
};

/** Cells of the 10-unit drawing grid, each holding the records within touching distance. */
class SpatialIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly cellsOf = new Map<number, Set<string>>();

  private static addCells([x1, y1]: Point, [x2, y2]: Point, into: Set<string>): void {
    const cell = (value: number): number => Math.floor(value / (10 * COORDINATE_SCALE));
    const [left, right] = [
      cell(Math.min(x1, x2) - TOUCH_TOLERANCE),
      cell(Math.max(x1, x2) + TOUCH_TOLERANCE),
    ];
    const [bottom, top] = [
      cell(Math.min(y1, y2) - TOUCH_TOLERANCE),
      cell(Math.max(y1, y2) + TOUCH_TOLERANCE),
    ];
    for (let cx = left; cx <= right; cx++) {
      for (let cy = bottom; cy <= top; cy++) into.add(`${cx},${cy}`);
    }
  }

  add(device: AltiumRecord): void {
    const points = device.coords ?? [];
    if (points.length === 0) return;
    const cells = new Set<string>();
    for (const point of points) SpatialIndex.addCells(point, point, cells);
    if (LINES.has(device.RECORD) || BARS.has(device.RECORD)) {
      for (let i = 1; i < points.length; i++)
        SpatialIndex.addCells(points[i - 1], points[i], cells);
    }
    this.cellsOf.set(device.index, cells);
    for (const cell of cells) {
      (this.cells.get(cell) ?? this.cells.set(cell, []).get(cell)!).push(device.index);
    }
  }

  /** The records sharing a cell with `device`. */
  neighbours(device: AltiumRecord): Set<number> {
    const found = new Set<number>();
    for (const cell of this.cellsOf.get(device.index) ?? []) {
      for (const index of this.cells.get(cell) ?? []) found.add(index);
    }
    found.delete(device.index);
    return found;
  }
}

/**
 * The key under which a record joins others without a wire. Net labels and power ports
 * of one name are one net, and so are ports of one name; a port never joins a label by
 * name, and a sheet entry never joins by name at all.
 */
const namedDeviceKey = (device: AltiumRecord): string | undefined => {
  const name = fieldText(device, "Text", "Name");
  if (name === undefined) return undefined;
  if (device.RECORD === RECORD_TYPES.POWER_PORT || device.RECORD === RECORD_TYPES.NET_LABEL) {
    return `label:${identifierKey(name)}`;
  }
  return device.RECORD === RECORD_TYPES.PORT ? `port:${identifierKey(name)}` : undefined;
};

/**
 * Whether two records connect. A point of either touching the other connects them,
 * except that two pins meet only tip to tip: a pin's inner end is its body. Harness
 * entries carrying one signal connect, as do records joining by name.
 */
export const isConnected = (a: AltiumRecord, b: AltiumRecord): boolean => {
  if (a.RECORD === RECORD_TYPES.PIN && b.RECORD === RECORD_TYPES.PIN) {
    const tipA = a.coords?.[a.coords.length - 1];
    const tipB = b.coords?.[b.coords.length - 1];
    return tipA !== undefined && tipB !== undefined && pointsTouch(tipA, tipB);
  }
  const segmentsA = segmentsOf(a);
  const segmentsB = segmentsOf(b);
  const touches = (from: Segment[], to: Segment[]): boolean =>
    from.some((segment) =>
      segment.some((point) => to.some((other) => pointOnSegment(point, other)))
    );
  if (touches(segmentsA, segmentsB) || touches(segmentsB, segmentsA)) return true;

  if (
    a.RECORD === RECORD_TYPES.HARNESS_ENTRY &&
    b.RECORD === RECORD_TYPES.HARNESS_ENTRY &&
    a.harnessSignal !== undefined &&
    b.harnessSignal !== undefined &&
    identifierKey(a.harnessSignal) === identifierKey(b.harnessSignal)
  ) {
    return true;
  }
  const key = namedDeviceKey(a);
  return key !== undefined && key === namedDeviceKey(b);
};

/** Group records into the sets that connect. */
export const findAllConnectedComponents = (devices: AltiumRecord[]): AltiumRecord[][] => {
  const index = new SpatialIndex();
  const byIndex = new Map<number, AltiumRecord>();
  for (const device of devices) {
    index.add(device);
    byIndex.set(device.index, device);
  }

  const sets = new UnionFind<number>();
  for (const device of devices) {
    for (const neighbour of index.neighbours(device)) {
      if (isConnected(device, byIndex.get(neighbour)!)) sets.union(device.index, neighbour);
    }
  }

  // Records that join without geometry: by name, and harness entries by signal.
  const firstByKey = new Map<string, number>();
  const join = (key: string | undefined, device: AltiumRecord): void => {
    if (key === undefined) return;
    const first = firstByKey.get(key);
    if (first === undefined) firstByKey.set(key, device.index);
    else sets.union(first, device.index);
  };
  for (const device of devices) {
    join(namedDeviceKey(device), device);
    if (device.RECORD === RECORD_TYPES.HARNESS_ENTRY && device.harnessSignal) {
      join(`signal:${identifierKey(device.harnessSignal)}`, device);
    }
  }

  const groups = new Map<number, AltiumRecord[]>();
  for (const device of devices) {
    const root = sets.find(device.index);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(device);
  }
  return [...groups.values()];
};
