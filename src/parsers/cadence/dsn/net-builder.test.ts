/**
 * Cross-page net disambiguation tests.
 */

import { describe, it, expect } from "vitest";
import { disambiguateCrossPageNets } from "./net-builder.js";

/**
 * Build the (netIdToName, netIdGroups) pair the disambiguator consumes.
 * Each entry is [netId, resolvedName, pageIdx]; pin details are irrelevant to
 * the heuristic, which only reads pageIdx off the first pin of each group.
 */
const buildInputs = (
  entries: [netId: number, name: string, pageIdx: number][]
): { netIdToName: Map<number, string>; netIdGroups: Map<number, { pageIdx: number }[]> } => {
  const netIdToName = new Map<number, string>();
  const netIdGroups = new Map<number, { pageIdx: number }[]>();
  for (const [netId, name, pageIdx] of entries) {
    netIdToName.set(netId, name);
    netIdGroups.set(netId, [{ pageIdx }]);
  }
  return { netIdToName, netIdGroups };
};

// The disambiguator only touches pageIdx, so a structural stand-in for PinInfo
// keeps these fixtures readable.
const run = (
  entries: [netId: number, name: string, pageIdx: number][],
  hierNames: string[]
): Map<number, string> => {
  const { netIdToName, netIdGroups } = buildInputs(entries);
  disambiguateCrossPageNets(
    netIdToName,
    netIdGroups as unknown as Parameters<typeof disambiguateCrossPageNets>[1],
    new Set(hierNames)
  );
  return netIdToName;
};

// Cadence allocates net object IDs sequentially from one large space, and the
// heuristic leans on that: a netlister collision suffix IS a dbObjectId, so it
// is the same order of magnitude as the page-local netIds. Fixtures use
// realistic magnitudes — that is exactly what a designer's `_01` is not.
describe("disambiguateCrossPageNets", () => {
  it("should not rename cross-page groups into designer-authored numeric siblings", () => {
    // SIG_N spans three pages (one logical net). The design also has its own
    // per-port SIG_N_01/_02/_04 nets, each drawn with its own wire label.
    const result = run(
      [
        [21_000_000, "SIG_N", 0],
        [21_500_000, "SIG_N", 1],
        [22_000_000, "SIG_N", 2],
        [21_100_000, "SIG_N_01", 0],
        [21_600_000, "SIG_N_02", 1],
        [22_100_000, "SIG_N_04", 2],
      ],
      ["SIG_N", "SIG_N_01", "SIG_N_02", "SIG_N_04"]
    );

    // Every SIG_N page group keeps the bare name -> the pins still merge into
    // one net downstream, and no sibling gains a foreign pin. Before the fix
    // the suffixes 1/2/4 cleared `suffix <= minNetId` trivially and all three
    // groups were renamed away.
    expect(result.get(21_000_000)).toBe("SIG_N");
    expect(result.get(21_500_000)).toBe("SIG_N");
    expect(result.get(22_000_000)).toBe("SIG_N");
    expect(result.get(21_100_000)).toBe("SIG_N_01");
    expect(result.get(21_600_000)).toBe("SIG_N_02");
    expect(result.get(22_100_000)).toBe("SIG_N_04");
  });

  it("should not rename cross-page groups into rail-suffixed siblings", () => {
    // `parseInt("1V8")` is 1, not NaN, so a level-shifted sibling used to read
    // as cross-page duplicate _1. Same for _3V3, _5V, _1V2 ...
    const result = run(
      [
        [21_000_000, "SPI_CS", 0],
        [22_000_000, "SPI_CS", 1],
        [21_500_000, "SPI_CS_1V8", 0],
      ],
      ["SPI_CS", "SPI_CS_1V8"]
    );

    expect(result.get(21_000_000)).toBe("SPI_CS");
    expect(result.get(22_000_000)).toBe("SPI_CS");
    expect(result.get(21_500_000)).toBe("SPI_CS_1V8");
  });

  it("should not treat a rail-suffixed hierarchy name as a rename even if unclaimed", () => {
    // Gate 1 alone: no wire group resolved to SPI_CS_3V3, so only the
    // entirely-digits test can reject it.
    const result = run(
      [
        [21_000_000, "SPI_CS", 0],
        [22_000_000, "SPI_CS", 1],
      ],
      ["SPI_CS", "SPI_CS_3V3"]
    );

    expect(result.get(21_000_000)).toBe("SPI_CS");
    expect(result.get(22_000_000)).toBe("SPI_CS");
  });

  it("should still apply genuine netlister collision renames", () => {
    // Two unrelated same-named wire groups; the hierarchy carries the
    // netlister's _<dbObjectId> rename, which no wire group has claimed.
    const result = run(
      [
        [21_000_000, "BUS_CLK", 0],
        [22_000_000, "BUS_CLK", 1],
      ],
      ["BUS_CLK", "BUS_CLK_21859572"]
    );

    expect(result.get(21_000_000)).toBe("BUS_CLK");
    expect(result.get(22_000_000)).toBe("BUS_CLK_21859572");
  });

  it("should skip claimed siblings but still use unclaimed collision suffixes", () => {
    // Both situations on the same base name: a designer sibling (_01, claimed
    // by its own wire group) and a netlister rename (_21859572, unclaimed).
    const result = run(
      [
        [21_000_000, "MUX_SEL", 0],
        [22_000_000, "MUX_SEL", 1],
        [21_500_000, "MUX_SEL_01", 0],
      ],
      ["MUX_SEL", "MUX_SEL_01", "MUX_SEL_21859572"]
    );

    expect(result.get(21_500_000)).toBe("MUX_SEL_01");
    expect(result.get(21_000_000)).toBe("MUX_SEL");
    expect(result.get(22_000_000)).toBe("MUX_SEL_21859572");
  });

  it("should leave single-page nets untouched", () => {
    const result = run(
      [
        [21_000_000, "LOCAL_EN", 0],
        [21_100_000, "LOCAL_EN_01", 0],
      ],
      ["LOCAL_EN", "LOCAL_EN_01"]
    );

    expect(result.get(21_000_000)).toBe("LOCAL_EN");
    expect(result.get(21_100_000)).toBe("LOCAL_EN_01");
  });

  it("should leave cross-page nets with no hierarchy suffix untouched", () => {
    const result = run(
      [
        [21_000_000, "RESET_N", 0],
        [22_000_000, "RESET_N", 1],
      ],
      ["RESET_N"]
    );

    expect(result.get(21_000_000)).toBe("RESET_N");
    expect(result.get(22_000_000)).toBe("RESET_N");
  });
});
