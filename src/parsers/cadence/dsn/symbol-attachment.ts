/**
 * The graph key of a global or hierarchical port symbol on a page.
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
