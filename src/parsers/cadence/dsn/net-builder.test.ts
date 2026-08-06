/**
 * Cross-page net disambiguation tests.
 */

import { describe, it, expect } from "vitest";
import {
  disambiguateCrossPageNets,
  chooseSymbolAttachment,
  symbolKey,
} from "./net-builder.js";

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

/**
 * A power symbol's drawn box is taller than the grid step between rails, so on
 * a rail fan-out it covers its neighbours as well as its own wire. Every case
 * here is measured geometry from a fixture, with the net names the design's
 * pstxnet.dat reports.
 */
describe("chooseSymbolAttachment", () => {
  /** Build the coordinate -> candidate-names index the chooser reads. */
  const named = (entries: [coord: string, name: string][]): Map<string, Set<string>> =>
    new Map(entries.map(([coord, name]) => [coord, new Set([name])]));

  it("attaches to the wire carrying the symbol's own name, not the nearest one", () => {
    // LAUNCHXL-CC1310 sheet 3: a USB_VBUS symbol whose box spans three rails one
    // grid step apart. Its origin sits on the XDS_VCC rail, and the GND rail is
    // also inside the box. Attaching to either fused two power nets: XDS_VCC's
    // 12 pins landed on GND, which then won the group's name alphabetically.
    const sym = { x1: 430, y1: 490, x2: 489, y2: 510, locX: 430, locY: 490 };
    const coords = ["430,510", "430,500", "430,490"];
    const names = named([
      ["430,510", "GND"],
      ["430,500", "USB_VBUS"],
      ["430,490", "XDS_VCC"],
    ]);

    expect(chooseSymbolAttachment(sym, "USB_VBUS", coords, names)).toBe("430,500");
  });

  it("attaches to its own rail when the origin lies on the neighbouring one", () => {
    // BeagleBoard-xM sheet 7: the VDD_PLL1 symbol's origin is one step below its
    // own rail, exactly on VDD_PLL2's. Preferring the origin would move C120 and
    // U7.J15 onto the wrong rail.
    const sym = { x1: 1600, y1: 600, x2: 1656, y2: 620, locX: 1600, locY: 600 };
    const coords = ["1600,600", "1600,610"];
    const names = named([
      ["1600,600", "VDD_PLL2"],
      ["1600,610", "VDD_PLL1"],
    ]);

    expect(chooseSymbolAttachment(sym, "VDD_PLL1", coords, names)).toBe("1600,610");
  });

  it("never claims a wire that already carries a different net's name", () => {
    // With no name of its own the symbol must stay unattached rather than pick a
    // neighbour, because attaching asserts a connection the drawing lacks.
    const sym = { x1: 1600, y1: 600, x2: 1656, y2: 620, locX: 1600, locY: 600 };
    const names = named([
      ["1600,600", "VDD_PLL2"],
      ["1600,610", "VDD_PLL1"],
    ]);

    expect(chooseSymbolAttachment(sym, undefined, ["1600,600", "1600,610"], names)).toBeUndefined();
    expect(chooseSymbolAttachment(sym, "CAM_IO", ["1600,600", "1600,610"], names)).toBeUndefined();
  });

  it("takes an unnamed wire in the box, preferring the origin", () => {
    // A wire group named only through its symbol still has to be reached.
    const sym = { x1: 100, y1: 200, x2: 160, y2: 220, locX: 100, locY: 210 };
    const coords = ["100,200", "100,210", "100,220"];

    expect(chooseSymbolAttachment(sym, "VCC", coords, new Map())).toBe("100,210");
  });

  it("takes the nearest unnamed wire when the origin is not on one", () => {
    const sym = { x1: 100, y1: 200, x2: 160, y2: 260, locX: 100, locY: 250 };

    expect(chooseSymbolAttachment(sym, "VCC", ["100,200", "100,240"], new Map())).toBe("100,240");
  });

  it("ignores wires outside the bounding box", () => {
    const sym = { x1: 100, y1: 200, x2: 160, y2: 220, locX: 100, locY: 200 };
    const names = named([["500,900", "VCC"]]);

    expect(chooseSymbolAttachment(sym, "VCC", ["500,900"], names)).toBeUndefined();
  });

  it("is independent of the order the coordinates arrive in", () => {
    const sym = { x1: 430, y1: 490, x2: 489, y2: 510, locX: 430, locY: 490 };
    const names = named([
      ["430,510", "GND"],
      ["430,500", "USB_VBUS"],
      ["430,490", "XDS_VCC"],
    ]);
    const forward = chooseSymbolAttachment(sym, "USB_VBUS", ["430,490", "430,500", "430,510"], names);
    const reverse = chooseSymbolAttachment(sym, "USB_VBUS", ["430,510", "430,500", "430,490"], names);

    expect(forward).toBe(reverse);
  });
});

describe("symbolKey", () => {
  it("keeps a symbol distinct from any wire coordinate", () => {
    // Keying a symbol by its placement origin made it the same graph node as
    // whatever wire happened to end there, which is how one symbol could fuse
    // two rails. A key of its own makes that structurally impossible.
    expect(symbolKey({ pairingId: 1681, dbId: 42 })).toBe("sym:1681:42");
    expect(symbolKey({ pairingId: 1681, dbId: 42 })).not.toMatch(/^\d+,\d+$/);
  });

  it("separates two instances of the same power net", () => {
    expect(symbolKey({ pairingId: 1681, dbId: 42 })).not.toBe(symbolKey({ pairingId: 1681, dbId: 43 }));
  });
});
