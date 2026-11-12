import { describe, it, expect } from "vitest";
import { mergeRepeatedSections, separateDuplicateRefdes } from "./duplicate-refdes.js";
import type { ComponentDetails, NetConnections } from "../../../types.js";
import type { PageData } from "./page-parser.js";
import type { PlacedInstance } from "./structures.js";

const strLst: string[] = [""];
const intern = (s: string): number => {
  const i = strLst.indexOf(s);
  if (i >= 0) return i;
  strLst.push(s);
  return strLst.length - 1;
};

let nextDbId = 1;
const inst = (
  reference: string,
  sourcePackage: string,
  sectionIndex: number,
  partNumber?: string
): PlacedInstance => ({
  pkgName: `${sourcePackage}.Normal`,
  dbId: nextDbId++,
  reference,
  sourcePackage,
  partValueIdx: 0,
  prefixProperties: partNumber ? [[intern("PART_NUMBER"), intern(partNumber)] as const] : [],
  locX: 0,
  locY: 0,
  symbolDisplayProps: [],
  t0x10s: [],
  sectionIndex,
});

const page = (name: string, ...placedInstances: PlacedInstance[]): PageData =>
  ({ name, placedInstances }) as unknown as PageData;

const refs = (pages: PageData[]): string[] =>
  pages.flatMap((p) => p.placedInstances.map((i) => i.reference));

describe("separateDuplicateRefdes", () => {
  it("keeps the units of a multi-unit part together", () => {
    const pages = [
      page("P1", inst("U1", "LM358", 0, "300-1")),
      page("P2", inst("U1", "LM358_1", 1)),
    ];
    expect(separateDuplicateRefdes(pages, strLst).duplicates).toEqual({});
    expect(refs(pages)).toEqual(["U1", "U1"]);
  });

  it("keeps sections whose package names differ only in case together", () => {
    const pages = [
      page("P05", inst("LS1", "PAD_1x9", 0, "PN-73"), inst("LS1", "PAD_1X9", 1, "PN-73")),
    ];
    expect(separateDuplicateRefdes(pages, strLst).duplicates).toEqual({});
  });

  it("keys both parts of a refdes reused for a different package", () => {
    const pages = [
      page("11_BUTTONS", inst("Q7", "MOSFET_NCHANNEL_GSD", 0, "PN-1")),
      page("07_CLOCKS", inst("Q7", "MOSFET_PCHANNEL", 0, "PN-2")),
    ];
    const { duplicates, renamed } = separateDuplicateRefdes(pages, strLst);
    expect(duplicates).toEqual({
      Q7: [
        { key: "Q7~1", pages: ["11_BUTTONS"] },
        { key: "Q7~2", pages: ["07_CLOCKS"] },
      ],
    });
    expect(refs(pages)).toEqual(["Q7~1", "Q7~2"]);
    expect([...renamed.values()]).toEqual(["Q7~1", "Q7~2"]);
  });

  it("gives every unit of a duplicated multi-unit part the same key", () => {
    const pages = [
      page("P1", inst("U2", "LM358", 0, "300-1"), inst("U2", "LM358", 1, "300-1")),
      page("P2", inst("U2", "TLV9002", 0, "300-2")),
    ];
    separateDuplicateRefdes(pages, strLst);
    expect(refs(pages)).toEqual(["U2~1", "U2~1", "U2~2"]);
  });

  it("separates a part with the same package but a different part number", () => {
    const pages = [
      page("P1", inst("R5", "RES_0402", 0, "100-10K"), inst("R5", "RES_0402", 1, "100-1K")),
    ];
    expect(Object.keys(separateDuplicateRefdes(pages, strLst).duplicates)).toEqual(["R5"]);
  });

  it("separates a second copy of the same part that redraws its section", () => {
    const pages = [
      page("P1", inst("R6", "RES_0402", 0, "100-10K")),
      page("P2", inst("R6", "RES_0402", 0, "100-10K")),
    ];
    expect(refs(pages).length).toBe(2);
    separateDuplicateRefdes(pages, strLst);
    expect(refs(pages)).toEqual(["R6~1", "R6~2"]);
  });

  it("names the block placement of a repeated block that annotates no refdes of its own", () => {
    const placed = (block: string): PageData =>
      ({
        ...page("TILE_TPS65400", inst("U7", "TPS65400", 0, "500-1")),
        placement: { path: ["U_TILE", block] },
      }) as unknown as PageData;
    const { duplicates } = separateDuplicateRefdes([placed("CLOCK0"), placed("CLOCK1")], strLst);
    expect(duplicates.U7).toEqual([
      { key: "U7~1", pages: ["TILE_TPS65400 (block U_TILE/CLOCK0)"] },
      { key: "U7~2", pages: ["TILE_TPS65400 (block U_TILE/CLOCK1)"] },
    ]);
  });

  it("does not split a unit that leaves the part number blank", () => {
    const pages = [
      page("P1", inst("U3", "FPGA", 0, "400-1"), inst("U3", "FPGA", 1), inst("U3", "FPGA", 2)),
    ];
    expect(separateDuplicateRefdes(pages, strLst).duplicates).toEqual({});
  });
});

describe("mergeRepeatedSections", () => {
  // U13: sections A and F, with F drawn again on another page, all its pins unconnected.
  const soc = (): PageData[] => [
    page("16_CONTROLS", inst("U13", "SOC", 0, "PN-9")),
    page("15_POWER", inst("U13", "SOC", 5, "PN-9")),
    page("18_DISPLAY", inst("U13", "SOC", 5, "PN-9")),
  ];

  it("folds a repeated section with no conflicting pin back into its part", () => {
    const pages = soc();
    const result = separateDuplicateRefdes(pages, strLst);
    const nets: NetConnections = {
      NC: { "U13~1": ["A10"] },
      DSI_LN2_P: { "U13~2": ["A10"] },
      RESET: { "U13~1": ["B1"] },
    };
    const components: ComponentDetails = {
      "U13~1": { mpn: "SOC-1", pins: { B1: "RESET", A10: "NC" } },
      "U13~2": { mpn: "SOC-1", pins: { A10: "DSI_LN2_P" } },
    };
    const occurrences = new Map([
      [1, "U13~1"],
      [2, "U13~2"],
    ]);

    const repeated = mergeRepeatedSections(result, nets, components, occurrences);

    expect(result.duplicates).toEqual({});
    expect(Object.keys(components)).toEqual(["U13"]);
    expect(components.U13.pins).toEqual({ B1: "RESET", A10: "DSI_LN2_P" });
    expect(nets).toEqual({ DSI_LN2_P: { U13: ["A10"] }, RESET: { U13: ["B1"] } });
    expect([...occurrences.values()]).toEqual(["U13", "U13"]);
    expect(repeated).toEqual({ U13: [{ section: "F", pages: ["15_POWER", "18_DISPLAY"] }] });
  });

  it("keeps copies apart when they wire one pin to two different nets", () => {
    const pages = [
      page("P1", inst("J5", "HDR", 0, "PN-5")),
      page("P2", inst("J5", "HDR", 0, "PN-5")),
    ];
    const result = separateDuplicateRefdes(pages, strLst);
    const nets: NetConnections = { A: { "J5~1": ["1"] }, B: { "J5~2": ["1"] } };
    const components: ComponentDetails = {
      "J5~1": { pins: { "1": "A" } },
      "J5~2": { pins: { "1": "B" } },
    };

    const repeated = mergeRepeatedSections(result, nets, components, new Map());

    expect(repeated).toEqual({});
    expect(Object.keys(result.duplicates)).toEqual(["J5"]);
    expect(Object.keys(components)).toEqual(["J5~1", "J5~2"]);
  });

  it("reports a single-section part drawn twice without a section letter", () => {
    const pages = [
      page("P3", inst("J2", "CONN", 0, "PN-6")),
      page("P4", inst("J2", "CONN", 0, "PN-6")),
    ];
    const result = separateDuplicateRefdes(pages, strLst);
    const nets: NetConnections = { SIG: { "J2~1": ["1"], "J2~2": ["1"] } };
    const components: ComponentDetails = {
      "J2~1": { pins: { "1": "SIG" } },
      "J2~2": { pins: { "1": "SIG" } },
    };

    const repeated = mergeRepeatedSections(result, nets, components, new Map());

    expect(repeated).toEqual({ J2: [{ pages: ["P3", "P4"] }] });
    expect(nets).toEqual({ SIG: { J2: ["1"] } });
  });

  it("lists repeated sections by letter and their pages in natural order", () => {
    const pages = [
      page("P10", inst("J6", "CONN", 1, "PN-7")),
      page("P2", inst("J6", "CONN", 0, "PN-7")),
      page("P9", inst("J6", "CONN", 1, "PN-7")),
      page("P1", inst("J6", "CONN", 0, "PN-7")),
    ];
    const result = separateDuplicateRefdes(pages, strLst);
    const components: ComponentDetails = {
      "J6~1": { pins: { "1": "A", "2": "B" } },
      "J6~2": { pins: { "1": "A", "2": "B" } },
    };

    const repeated = mergeRepeatedSections(result, {}, components, new Map());

    expect(repeated).toEqual({
      J6: [
        { section: "A", pages: ["P1", "P2"] },
        { section: "B", pages: ["P9", "P10"] },
      ],
    });
  });
});
