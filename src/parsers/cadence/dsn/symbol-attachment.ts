/**
 * Where a global or hierarchical port symbol attaches to a page's wiring.
 */

import type { GraphicInst } from "./structures.js";

/**
 * Union-Find key for a global/port symbol.
 *
 * A symbol gets its own key rather than being addressed by its placement
 * origin, because that origin frequently lands exactly on a wire endpoint that
 * belongs to a *different* net. On a rail fan-out the symbols sit one grid step
 * apart while each symbol's drawn box is two steps tall, so a symbol's origin
 * routinely sits on the neighbouring rail. Keying by origin made the symbol and
 * that neighbour the same graph node, and the symbol's own attachment then
 * fused two unrelated rails into one net.
 *
 * With a key of its own a symbol performs at most one union, so it can join a
 * wire group but never bridge two.
 */
export function symbolKey(sym: Pick<GraphicInst, "pairingId" | "dbId">): string {
  return `sym:${sym.pairingId}:${sym.dbId}`;
}

/** A wire endpoint with its coordinates already parsed. */
export interface WirePoint {
  coord: string;
  x: number;
  y: number;
}

/**
 * The single wire coordinate a global/port symbol is electrically attached to.
 *
 * A power symbol has one pin, so exactly one wire may touch it, but its drawn
 * bounding box covers more than that wire: on a rail fan-out it also covers the
 * rails drawn above and below. Picking whichever coordinate the iteration
 * reached first therefore attached symbols to their neighbours.
 *
 * `symbolNet` is the symbol's own net name, taken from the Library string list,
 * and `namesOfGroup` gives the names already carried by the wire group a
 * coordinate belongs to. Group names, not the labels sitting on that one
 * coordinate: a rail is usually labelled once and the label may sit anywhere
 * along it.
 *
 * When the symbol's name is known the choice is unambiguous, and a wire group
 * that carries some other name is then excluded, since claiming it would assert
 * a connection the drawing does not show. When the name is unknown, which is
 * the case for a design whose string list did not parse, every coordinate in
 * the box stays eligible rather than none.
 *
 * Ranking is by distance to the centre of the bounding box, tie-broken on the
 * coordinate itself, so the result never depends on iteration order. The
 * symbol's `locX/locY` is deliberately not the anchor: it is a placement
 * origin that lies outside the symbol's own box for about a third of the
 * symbols in the fixture corpus.
 */
export function chooseSymbolAttachment(
  sym: Pick<GraphicInst, "x1" | "y1" | "x2" | "y2">,
  symbolNet: string | undefined,
  wirePoints: Iterable<WirePoint>,
  namesOfGroup: (coord: string) => ReadonlySet<string> | undefined
): string | undefined {
  const minX = Math.min(sym.x1, sym.x2);
  const maxX = Math.max(sym.x1, sym.x2);
  const minY = Math.min(sym.y1, sym.y2);
  const maxY = Math.max(sym.y1, sym.y2);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  let owned: string | undefined;
  let ownedDist = Infinity;
  let eligible: string | undefined;
  let eligibleDist = Infinity;

  for (const point of wirePoints) {
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) continue;

    const names = namesOfGroup(point.coord);
    const dist = Math.abs(point.x - centreX) + Math.abs(point.y - centreY);

    if (symbolNet !== undefined && names?.has(symbolNet)) {
      if (dist < ownedDist || (dist === ownedDist && point.coord < owned!)) {
        owned = point.coord;
        ownedDist = dist;
      }
      continue;
    }

    // Excluded only when we know our own name and this group answers to another.
    if (symbolNet !== undefined && names && names.size > 0) continue;

    if (dist < eligibleDist || (dist === eligibleDist && point.coord < eligible!)) {
      eligible = point.coord;
      eligibleDist = dist;
    }
  }

  return owned ?? eligible;
}
