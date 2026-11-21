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

type Connector = Pick<GraphicInst, "x1" | "y1" | "x2" | "y2" | "locX" | "locY" | "connection">;

/**
 * Whether a pin at `(x, y)` sits on a Global or port: at its connection point
 * (§11.4). A connector with no cached symbol falls back to its box.
 */
export function pinOnSymbol(sym: Connector, x: number, y: number): boolean {
  if (sym.connection) return sym.connection[0] === x && sym.connection[1] === y;
  return (
    x >= Math.min(sym.x1, sym.x2) &&
    x <= Math.max(sym.x1, sym.x2) &&
    y >= Math.min(sym.y1, sym.y2) &&
    y <= Math.max(sym.y1, sym.y2)
  );
}

/**
 * Whether a pin at `(x, y)` sits on an off-page connector: at its connection
 * point (§11.4). Without a cached symbol, at a box edge midpoint or its location.
 */
export function pinOnOffPage(opc: Connector, x: number, y: number): boolean {
  if (opc.connection) return opc.connection[0] === x && opc.connection[1] === y;
  const minX = Math.min(opc.x1, opc.x2);
  const maxX = Math.max(opc.x1, opc.x2);
  const minY = Math.min(opc.y1, opc.y2);
  const maxY = Math.max(opc.y1, opc.y2);
  const midX = Math.round((minX + maxX) / 2);
  const midY = Math.round((minY + maxY) / 2);
  return (
    (y === midY && (x === maxX || x === minX)) ||
    (x === midX && (y === maxY || y === minY)) ||
    (x === opc.locX && y === opc.locY)
  );
}
