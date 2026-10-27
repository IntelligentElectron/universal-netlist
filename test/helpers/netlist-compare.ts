/**
 * How two netlists differ, for the raw reader's parity checks against KiCad's
 * own export (parity.test.ts, and by hand while a design is investigated).
 */

import type { ParsedNetlist } from "../../src/types.js";

/** JSON with every object's keys sorted: key order carries no meaning in a netlist. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner
  );

/**
 * How two netlists differ, net by net and component by component; empty when
 * they agree. A component difference names the fields that differ.
 */
export const netlistDifferences = (expected: ParsedNetlist, actual: ParsedNetlist): string[] => {
  const differences: string[] = [];
  const pins = (net: ParsedNetlist["nets"][string] | undefined) =>
    Object.entries(net ?? {})
      .flatMap(([refdes, numbers]) => numbers.map((pin) => `${refdes}.${pin}`))
      .sort();
  for (const name of new Set([...Object.keys(expected.nets), ...Object.keys(actual.nets)])) {
    const [want, got] = [pins(expected.nets[name]), pins(actual.nets[name])];
    if (want.join() !== got.join()) {
      const missing = want.filter((pin) => !got.includes(pin));
      const extra = got.filter((pin) => !want.includes(pin));
      differences.push(`net ${JSON.stringify(name)}: missing [${missing}] extra [${extra}]`);
    }
  }
  for (const refdes of new Set([
    ...Object.keys(expected.components),
    ...Object.keys(actual.components),
  ])) {
    const [want, got] = [expected.components[refdes], actual.components[refdes]];
    if (!want || !got) {
      differences.push(`component ${refdes}: ${want ? "missing" : "extra"}`);
      continue;
    }
    for (const field of new Set([...Object.keys(want), ...Object.keys(got)])) {
      const [a, b] = [
        canonical(want[field as keyof typeof want]),
        canonical(got[field as keyof typeof got]),
      ];
      if (a !== b) {
        differences.push(
          `component ${refdes}.${field}: expected ${a?.slice(0, 160)} got ${b?.slice(0, 160)}`
        );
      }
    }
  }
  return differences;
};
