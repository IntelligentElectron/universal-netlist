/**
 * Hierarchy expansion: one copy of a child schematic's pages per placement.
 */

import { describe, expect, it } from "vitest";
import { expandHierarchy } from "./hierarchy-expander.js";
import type { HierarchyScope, HierarchyStream, PartOccurrence } from "./hierarchy-parser.js";
import type { PageData } from "./page-parser.js";
import type { DrawnInstance, PlacedInstance, T0x10 } from "./structures.js";

const pin = (pinIndex: number, x: number, y: number, netId: number): T0x10 => ({
  pinIndex,
  pointX: x,
  pointY: y,
  netId,
  symbolDisplayProps: [],
});

const instance = (dbId: number, reference: string, pins: T0x10[] = []): PlacedInstance => ({
  pkgName: "R.Normal",
  dbId,
  reference,
  sourcePackage: "R",
  partValueIdx: 0,
  prefixProperties: [],
  locX: 0,
  locY: 0,
  symbolDisplayProps: [],
  t0x10s: pins,
  sectionIndex: 0,
});

const block = (dbId: number, reference: string, ports: string[], pins: T0x10[]): DrawnInstance => ({
  dbId,
  reference,
  ports,
  pins,
  locX: 0,
  locY: 0,
});

const page = (
  name: string,
  placedInstances: PlacedInstance[],
  drawnInstances: DrawnInstance[] = []
): PageData => ({
  name,
  netTable: new Map(),
  wires: [],
  placedInstances,
  drawnInstances,
  ports: [],
  globals: [],
  offPageConnectors: [],
});

const part = (occurrenceId: number, dbId: number, reference: string): PartOccurrence => ({
  occurrenceId,
  dbId,
  reference,
  pins: [],
});

const scope = (
  parts: PartOccurrence[],
  blocks: HierarchyScope["blocks"] = [],
  nets: string[] = []
): HierarchyScope => ({
  nets: nets.map((name, i) => ({ dbId: i + 1, name })),
  parts,
  blocks,
});

const root = (schematic: string, s: HierarchyScope): HierarchyStream => ({ schematic, scope: s });

const SPAN = 2 ** 32;

describe("expandHierarchy", () => {
  it("gives root instances the references their occurrences annotate, keeping the inline one otherwise", () => {
    const pages = new Map([
      ["main", [page("P1", [instance(246, "C?"), instance(405, "U1"), instance(9, "X3")])]],
    ]);
    const roots = [root("Main", scope([part(41, 246, "C2"), part(58, 405, "")]))];

    const { pages: out } = expandHierarchy(roots, pages);

    expect(out).toHaveLength(1);
    expect(out[0].placedInstances.map((i) => i.reference)).toEqual(["C2", "U1", "X3"]);
    expect(out[0].placement).toBeUndefined();
  });

  it("copies a block's pages once per placement, each with that placement's references", () => {
    const child = page("PAGE1", [instance(275, "C1", [pin(1, 10, 10, 3997)])]);
    const main = page(
      "PAGE1",
      [],
      [
        block(17, "MV1", ["SIG_IN"], [pin(1, 450, 360, 799)]),
        block(39, "MV2", ["SIG_IN"], [pin(1, 620, 360, 874)]),
      ]
    );
    const roots = [
      root(
        "Main",
        scope(
          [],
          [
            {
              occurrenceId: 2,
              dbId: 17,
              schematic: "monostable",
              reference: "",
              scope: scope([part(153, 275, "C6")], [], ["SIG_IN", "N00439"]),
            },
            {
              occurrenceId: 5,
              dbId: 39,
              schematic: "monostable",
              reference: "",
              scope: scope([part(208, 275, "C9")]),
            },
          ]
        )
      ),
    ];

    const { pages: out } = expandHierarchy(
      roots,
      new Map([
        ["main", [main]],
        ["monostable", [child]],
      ])
    );

    expect(out.map((p) => [p.name, p.placement?.path.join("/")])).toEqual([
      ["PAGE1", undefined],
      ["PAGE1", "MV1"],
      ["PAGE1", "MV2"],
    ]);
    expect(out[1].placedInstances[0].reference).toBe("C6");
    expect(out[2].placedInstances[0].reference).toBe("C9");
    expect(out[1].placement).toMatchObject({
      suffix: "_MV1",
      canonicalNetNames: new Set(["SIG_IN", "N00439"]),
    });
    // The source page is untouched.
    expect(child.placedInstances[0].reference).toBe("C1");
  });

  it("moves each placement's pin net ids into a range of their own, leaving the sentinels alone", () => {
    const child = page("PAGE1", [
      instance(1, "R1", [pin(1, 0, 0, 3997), pin(2, 0, 0, 0), pin(3, 0, 0, 0xffffffff)]),
    ]);
    const main = page("PAGE1", [], [block(17, "A", [], []), block(39, "B", [], [])]);
    const blocks = [17, 39].map((dbId, i) => ({
      occurrenceId: i,
      dbId,
      schematic: "child",
      reference: "",
      scope: scope([]),
    }));

    const { pages: out } = expandHierarchy(
      [root("Main", scope([], blocks))],
      new Map([
        ["main", [main]],
        ["child", [child]],
      ])
    );

    expect(out[1].placedInstances[0].t0x10s.map((p) => p.netId)).toEqual([
      3997 + SPAN,
      0,
      0xffffffff,
    ]);
    expect(out[2].placedInstances[0].t0x10s.map((p) => p.netId)).toEqual([
      3997 + 2 * SPAN,
      0,
      0xffffffff,
    ]);
  });

  it("binds each hierarchical port to the parent page's block pin, by port name", () => {
    const child = page("PAGE1", []);
    const main = page(
      "PAGE1",
      [],
      [block(17, "MV1", ["SIG_IN", "sig_out"], [pin(1, 450, 360, 799), pin(2, 580, 280, 874)])]
    );
    const roots = [
      root(
        "Main",
        scope(
          [],
          [{ occurrenceId: 2, dbId: 17, schematic: "child", reference: "", scope: scope([]) }]
        )
      ),
    ];

    const { pages: out } = expandHierarchy(
      roots,
      new Map([
        ["main", [main]],
        ["child", [child]],
      ])
    );

    expect([...out[1].placement!.ports]).toEqual([
      ["SIG_IN", { pageIdx: 0, coord: "450,360", netId: 799 }],
      ["SIG_OUT", { pageIdx: 0, coord: "580,280", netId: 874 }],
    ]);
  });

  it("carries a nested placement's parent path, and the parent's shifted pin net ids, down", () => {
    const inner = page("PAGE1", [instance(3, "U1")]);
    const outer = page("PAGE1", [], [block(22, "TILE1", ["CLK"], [pin(1, 5, 5, 77)])]);
    const main = page("PAGE1", [], [block(11, "SNOW1", [], [])]);
    const roots = [
      root(
        "TOP",
        scope(
          [],
          [
            {
              occurrenceId: 1,
              dbId: 11,
              schematic: "outer",
              reference: "",
              scope: scope(
                [],
                [
                  {
                    occurrenceId: 2,
                    dbId: 22,
                    schematic: "inner",
                    reference: "",
                    scope: scope([part(3, 3, "U16")]),
                  },
                ]
              ),
            },
          ]
        )
      ),
    ];

    const { pages: out } = expandHierarchy(
      roots,
      new Map([
        ["top", [main]],
        ["outer", [outer]],
        ["inner", [inner]],
      ])
    );

    expect(out[2].placement).toMatchObject({ path: ["SNOW1", "TILE1"], suffix: "_SNOW1_TILE1" });
    expect(out[2].placedInstances[0].reference).toBe("U16");
    expect(out[2].placement!.ports.get("CLK")).toEqual({
      pageIdx: 1,
      coord: "5,5",
      netId: 77 + SPAN,
    });
  });

  it("passes a schematic no root reaches through as it is, once", () => {
    const orphan = page("LIB", [instance(5, "R9")]);
    const main = page("PAGE1", [instance(1, "R1")]);

    const { pages: out } = expandHierarchy(
      [root("Main", scope([part(1, 1, "R1")]))],
      new Map([
        ["main", [main]],
        ["lib", [orphan]],
      ])
    );

    expect(out).toHaveLength(2);
    expect(out[1]).toBe(orphan);
  });

  it("passes a block's schematic through flat when the stream names no occurrence for the block", () => {
    const child = page("PAGE1", [instance(275, "C1")]);
    const main = page("PAGE1", [], [block(17, "MV1", [], [])]);

    const { pages: out } = expandHierarchy(
      [root("Main", scope([]))],
      new Map([
        ["main", [main]],
        ["monostable", [child]],
      ])
    );

    expect(out).toHaveLength(2);
    expect(out[1]).toBe(child);
  });

  it("reads every page flat when there is no Hierarchy stream", () => {
    const main = page("PAGE1", [instance(1, "R1")]);

    const { pages: out, canonicalNetNames } = expandHierarchy([], new Map([["main", [main]]]));

    expect(out).toEqual([main]);
    expect(canonicalNetNames.size).toBe(0);
  });

  it("assigns the pin numbers an occurrence's Number properties give, by pin index", () => {
    const strLst = ["", "Number", "3", "4"];
    const child = page("PAGE1", [instance(2681, "U6", [pin(1, 0, 0, 1), pin(2, 0, 0, 2)])]);
    const main = page("PAGE1", [], [block(17, "MV1", [], [])]);
    const u4: PartOccurrence = {
      occurrenceId: 426,
      dbId: 2681,
      reference: "U4",
      pins: [
        { ordinal: 0, properties: [[1, 2]] },
        { ordinal: 1, properties: [[1, 3]] },
      ],
    };
    const roots = [
      root(
        "Main",
        scope(
          [],
          [{ occurrenceId: 2, dbId: 17, schematic: "child", reference: "", scope: scope([u4]) }]
        )
      ),
    ];

    const { pages: out } = expandHierarchy(
      roots,
      new Map([
        ["main", [main]],
        ["child", [child]],
      ]),
      strLst
    );

    expect(out[1].placedInstances[0].reference).toBe("U4");
    expect([...out[1].placedInstances[0].pinNumbers!]).toEqual([
      [1, "3"],
      [2, "4"],
    ]);
  });

  it("collects the root scopes' net names and the occurrence-to-refdes map", () => {
    const main = page("PAGE1", [instance(1, "R1"), instance(2, "C7")]);
    const roots = [
      root("Main", scope([part(10, 1, "R1"), part(11, 2, "")], [], ["gnd", "N00776"])),
    ];

    const { canonicalNetNames, occurrenceRefdes } = expandHierarchy(
      roots,
      new Map([["main", [main]]])
    );

    expect(canonicalNetNames).toEqual(new Set(["GND", "N00776"]));
    expect([...occurrenceRefdes]).toEqual([
      [10, "R1"],
      [11, "C7"],
    ]);
  });
});
