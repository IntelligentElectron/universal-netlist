import { describe, it, expect } from "vitest";
import type {
  AggregatedCircuitResult,
  DuplicateComponentResult,
  QueryComponentResult,
  SearchNetsResult,
} from "../types.js";
import { pageField, pagePins, pageResults } from "./pagination.js";

describe("pageField", () => {
  const circuit = (entries: number): AggregatedCircuitResult => ({
    design_variant: "<Default>",
    starting_point: "GND_POWER",
    total_components: entries,
    unique_configurations: entries,
    components_by_mpn: Array.from({ length: entries }, (_, i) => ({
      total_count: 1,
      mpn: `P${i}`,
      refdes: [`U${i}`],
    })),
    visited_nets: ["GND_POWER"],
    circuit_hash: "h",
  });

  it("returns a result that fits in one page unchanged", () => {
    const result = circuit(50);
    expect(pageField(result, "components_by_mpn", 50, 0)).toBe(result);
  });

  it("returns the first page with the offset of the next and the whole trace's totals", () => {
    const page = pageField(circuit(120), "components_by_mpn", 50, 0) as AggregatedCircuitResult;
    expect(page.components_by_mpn).toHaveLength(50);
    expect(page.components_by_mpn[0].mpn).toBe("P0");
    expect(page.next_offset).toBe(50);
    expect(page.total_components).toBe(120);
    expect(page.notes).toEqual([
      "components_by_mpn shows entries 1-50 of 120. Pass offset=50 for the next page.",
    ]);
  });

  it("returns the last page without a next offset", () => {
    const page = pageField(circuit(120), "components_by_mpn", 50, 100) as AggregatedCircuitResult;
    expect(page.components_by_mpn.map((c) => c.mpn)).toEqual(
      Array.from({ length: 20 }, (_, i) => `P${100 + i}`)
    );
    expect(page.next_offset).toBeUndefined();
    expect(page.notes).toEqual(["components_by_mpn shows entries 101-120 of 120."]);
  });

  it("says when the offset is past the end", () => {
    const page = pageField(circuit(10), "components_by_mpn", 50, 60) as AggregatedCircuitResult;
    expect(page.components_by_mpn).toEqual([]);
    expect(page.notes?.[0]).toContain("past the last of 10");
  });
});

describe("pageResults", () => {
  const search: SearchNetsResult = {
    design_variant: "<Default>",
    results: { board: Array.from({ length: 120 }, (_, i) => `N${i}`) },
  };

  it("pages the matches under their design", () => {
    const page = pageResults(search, 50, 50) as SearchNetsResult;
    expect(page.results.board).toHaveLength(50);
    expect(page.results.board[0]).toBe("N50");
    expect(page.next_offset).toBe(100);
    expect(page.notes).toEqual([
      "results shows entries 51-100 of 120. Pass offset=100 for the next page.",
    ]);
  });
});

describe("pagePins", () => {
  const pins = (from: number, count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`${from + i}`, `N${from + i}`]));

  it("pages one part's pins", () => {
    const part: QueryComponentResult = {
      design_variant: "<Default>",
      refdes: "U1",
      pins: pins(1, 60),
    };
    const page = pagePins(part, 50, 50) as QueryComponentResult;
    expect(Object.keys(page.pins)).toEqual(Array.from({ length: 10 }, (_, i) => `${51 + i}`));
    expect(page.next_offset).toBeUndefined();
    expect(page.notes).toEqual(["pins shows entries 51-60 of 60."]);
  });

  it("counts a duplicated refdes's pins across its parts", () => {
    const dup: DuplicateComponentResult = {
      design_variant: "<Default>",
      refdes: "Q1",
      components: [
        { refdes: "Q1", mpn: "A", pins: pins(1, 3) },
        { refdes: "Q1", mpn: "B", pins: pins(1, 3) },
      ],
    };
    const page = pagePins(dup, 4, 0) as DuplicateComponentResult;
    expect(page.components.map((c) => [c.mpn, Object.keys(c.pins)])).toEqual([
      ["A", ["1", "2", "3"]],
      ["B", ["1"]],
    ]);
    expect(page.next_offset).toBe(4);
  });
});
