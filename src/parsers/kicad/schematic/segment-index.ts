// SPDX-License-Identifier: Apache-2.0
// Ported from westworld lib/kicad-builder/segment-index.ts at commit 255bbfb (same author,
// Valentino Zegna), relicensed under Apache-2.0. universal-netlist is now this
// reader's home; westworld is to consume it from here.

/**
 * Which wire or bus segments pass through a point, without testing the point
 * against every segment of the sheet. `connectGeometry` (connectivity.ts) asks
 * this for every junction, label, and sheet pin.
 */

interface Point {
  x: number;
  y: number;
}

/** How far a point may sit off a segment and still be on it (schematic units are mm). */
const EPS = 1e-3;

/** Whether `p` lies on the segment a-b (ends included). */
export function onSegment(p: Point, a: Point, b: Point): boolean {
  if (p.x < Math.min(a.x, b.x) - EPS || p.x > Math.max(a.x, b.x) + EPS) return false;
  if (p.y < Math.min(a.y, b.y) - EPS || p.y > Math.max(a.y, b.y) + EPS) return false;
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.abs(cross) <= EPS * Math.max(length, 1);
}

/** Grid cell edge in mm: a few pin pitches, so a point meets a handful of segments at most. */
const CELL = 10;
/** A segment whose box spans more cells than this is checked for every query instead of stored per cell. */
const MAX_CELLS = 4096;
/** Keeps a cell's two indices in one safe integer (|index| stays far below 2^20 for real sheets). */
const OFFSET = 1 << 20;
const STRIDE = 1 << 21;

const cellOf = (v: number) => Math.floor(v / CELL);
const cellKey = (cx: number, cy: number) => (cx + OFFSET) * STRIDE + (cy + OFFSET);

/**
 * A uniform grid over the segments. Each segment is stored in every cell its
 * bounding box (widened by `EPS`, the tolerance `onSegment` allows) touches, so
 * the cell holding a point lists every segment that can pass through it.
 * Axis-aligned wires fill a line of cells and diagonal ones their box;
 * `onSegment` then makes the exact decision, so results equal testing all
 * segments.
 */
export class SegmentIndex {
  private readonly cells = new Map<number, number[]>();
  /** Segments too long to store per cell (or with a non-finite end): checked on every query. */
  private readonly wide: number[] = [];

  /** Indexes `segments`; the numbers `under` returns are positions in this array. */
  constructor(private readonly segments: [Point, Point][]) {
    segments.forEach(([a, b], i) => {
      const x0 = cellOf(Math.min(a.x, b.x) - EPS);
      const x1 = cellOf(Math.max(a.x, b.x) + EPS);
      const y0 = cellOf(Math.min(a.y, b.y) - EPS);
      const y1 = cellOf(Math.max(a.y, b.y) + EPS);
      if (
        !(x1 - x0 < MAX_CELLS && y1 - y0 < MAX_CELLS && (x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_CELLS)
      ) {
        this.wide.push(i);
        return;
      }
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = cellKey(cx, cy);
          const list = this.cells.get(k);
          if (list) list.push(i);
          else this.cells.set(k, [i]);
        }
      }
    });
  }

  /** The indices, ascending, of the segments `p` lies on. */
  under(p: Point): number[] {
    const near = this.cells.get(cellKey(cellOf(p.x), cellOf(p.y))) ?? [];
    const found: number[] = [];
    for (const i of near) {
      const [a, b] = this.segments[i]!;
      if (onSegment(p, a, b)) found.push(i);
    }
    for (const i of this.wide) {
      const [a, b] = this.segments[i]!;
      if (onSegment(p, a, b)) found.push(i);
    }
    // Cell lists are in index order already; only a wide segment can break it.
    if (this.wide.length && found.length > 1) found.sort((m, n) => m - n);
    return found;
  }
}
