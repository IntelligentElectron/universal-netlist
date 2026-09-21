/**
 * Capture bus names and their members.
 */

/** A bus name split into its base and the member indices it lists, in order. */
export interface BusName {
  base: string;
  indices: number[];
}

/**
 * Split a Capture bus name such as `DATA[7:0]` into `DATA` and `[7, 6, ..., 0]`.
 * Capture also accepts `..` and `-` as the range separator, and names the
 * members by appending the index to the base: `DATA7`, `DATA6`, and so on.
 */
export function parseBusName(name: string): BusName | undefined {
  const match = /^(.*)\[\s*(\d+)\s*(?::|\.\.|-)\s*(\d+)\s*\]$/.exec(name);
  if (!match) return undefined;
  const first = Number(match[2]);
  const last = Number(match[3]);
  const step = first <= last ? 1 : -1;
  const indices: number[] = [];
  for (let i = first; step > 0 ? i <= last : i >= last; i += step) indices.push(i);
  return { base: match[1], indices };
}
