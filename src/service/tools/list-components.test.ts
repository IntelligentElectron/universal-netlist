import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listComponents } from "./list-components.js";
import type { ParsedNetlist, ErrorResult, ListComponentsResult } from "../../types.js";
import * as parsersModule from "../../parsers/index.js";

const isErrorResult = (result: unknown): result is ErrorResult =>
  typeof result === "object" && result !== null && "error" in result;

const mockParse = (netlist: ParsedNetlist) => {
  vi.spyOn(parsersModule, "findHandler").mockReturnValue({
    name: "mock",
    extensions: [".dsn"],
    canHandle: () => true,
    discoverDesigns: vi.fn(),
    parse: vi.fn(),
  });
  vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(netlist);
};

const DESIGN = "/mock/design.dsn";

describe("listComponents - available prefixes suggestion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Regression for the "Available prefixes: []" bug on unannotated designs.
  // The refdes still carry KiCad's "?" annotation placeholder (C?, D?, PS?).
  describe("unannotated-only design", () => {
    const netlist: ParsedNetlist = {
      nets: { VPP: { "C?": ["1"], "D?": ["2"], "PS?": ["3"] }, GND: { "C?": ["2"] } },
      components: {
        "C?": {
          value: "220uF",
          description: "Polarized capacitor",
          pins: { "1": "VPP", "2": "GND" },
        },
        "D?": { value: "PMEG6020ER", description: "Schottky diode", pins: { "2": "VPP" } },
        "PS?": { value: "ROF-78E3.3", pins: { "3": "VPP" } },
      },
    };

    beforeEach(() => mockParse(netlist));

    it("matches an unannotated refdes by its letter prefix", async () => {
      const result = await listComponents(DESIGN, "C");
      expect(isErrorResult(result)).toBe(false);
      const refdes = (result as ListComponentsResult).components.flatMap((c) => c.refdes);
      expect(refdes).toContain("C?");
    });

    it("lists real prefixes (not []) when the queried prefix is absent", async () => {
      const result = await listComponents(DESIGN, "U");
      expect(isErrorResult(result)).toBe(true);
      const msg = (result as ErrorResult).error;
      expect(msg).toContain("Available prefixes: [C, D, PS]");
      expect(msg).not.toContain("Available prefixes: []");
    });
  });

  it("dedupes and sorts prefixes across annotated and unannotated refdes", async () => {
    mockParse({
      nets: { N1: { U1: ["1"] } },
      components: {
        U1: { pins: { "1": "N1" } },
        "C?": { pins: { "1": "N1" } },
        R10: { pins: { "1": "N1" } },
      },
    });
    const result = await listComponents(DESIGN, "Q");
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("Available prefixes: [C, R, U]");
  });

  it("excludes Cadence-path and numeric-only keys from the suggestion list", async () => {
    mockParse({
      nets: { N1: { U1: ["1"] } },
      components: {
        U1: { pins: { "1": "N1" } },
        "@DESIGN.SH:INS1@PART": { pins: { "1": "N1" } },
        "123": { pins: { "1": "N1" } },
      },
    });
    const result = await listComponents(DESIGN, "Z");
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("Available prefixes: [U]");
  });

  it("reports an empty prefix list for a genuinely empty design", async () => {
    mockParse({ nets: {}, components: {} });
    const result = await listComponents(DESIGN, "U");
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("Available prefixes: []");
  });

  it("returns grouped components for an annotated design (happy path)", async () => {
    mockParse({
      nets: { VDD: { U1: ["1"] } },
      components: { U1: { mpn: "TPS62088", description: "Buck Converter", pins: { "1": "VDD" } } },
    });
    const result = await listComponents(DESIGN, "U");
    expect(isErrorResult(result)).toBe(false);
    expect((result as ListComponentsResult).components.flatMap((c) => c.refdes)).toContain("U1");
  });
});

// Issue #169: the unmatched-type error suggested prefixes that the same
// query, at the same default, then returned nothing for; and a prefix whose
// parts are all DNS came back as a bare empty list, which reads as "none".
describe("listComponents - DNS and the suggestion list", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const netlist: ParsedNetlist = {
    nets: { VDD: { U1: ["1"], R1: ["1"], TP1: ["1"], TP2: ["1"] } },
    components: {
      U1: { mpn: "PART-1", pins: { "1": "VDD" } },
      R1: { value: "1k", dns: true, pins: { "1": "VDD" } },
      R2: { value: "2k", pins: { "1": "" } },
      TP1: { description: "TEST POINT", dns: true, pins: { "1": "VDD" } },
      TP2: { description: "TEST POINT", dns: true, pins: { "1": "VDD" } },
    },
  };

  beforeEach(() => mockParse(netlist));

  it("suggests only prefixes the same query would return, and names the DNS-only ones apart", async () => {
    const result = await listComponents(DESIGN, "X");
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toBe(
      "No components with prefix 'X' found in design 'design'. Available prefixes: [R, U] " +
        "Prefixes whose components are all DNS, listed only with include_dns=true: [TP]"
    );
  });

  it("suggests every prefix when include_dns is true, with no DNS clause", async () => {
    const result = await listComponents(DESIGN, "X", true);
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toBe(
      "No components with prefix 'X' found in design 'design'. Available prefixes: [R, TP, U]"
    );
  });

  it("says so when every component under the prefix is DNS", async () => {
    const result = await listComponents(DESIGN, "TP");
    expect(isErrorResult(result)).toBe(false);
    expect(result).toEqual({
      components: [],
      notes: [
        "All 2 components with prefix 'TP' in design 'design' are DNS (Do Not Stuff) and were left out. Pass include_dns=true to list them.",
      ],
    });
  });

  it("lists the DNS-only prefix with include_dns=true", async () => {
    const result = (await listComponents(DESIGN, "TP", true)) as ListComponentsResult;
    expect(result.notes).toBeUndefined();
    expect(result.components.flatMap((c) => c.refdes).sort()).toEqual(["TP1", "TP2"]);
    expect(result.components.every((c) => c.dns === true)).toBe(true);
  });

  it("adds no note when some parts under the prefix are stuffed", async () => {
    const result = (await listComponents(DESIGN, "R")) as ListComponentsResult;
    expect(result.notes).toBeUndefined();
    expect(result.components.flatMap((c) => c.refdes)).toEqual(["R2"]);
  });

  it("the DNS clause is absent when no prefix is DNS-only", async () => {
    mockParse({
      nets: {},
      components: { U1: { pins: {} }, C1: { dns: true, pins: {} }, C2: { pins: {} } },
    });
    const result = await listComponents(DESIGN, "X");
    expect((result as ErrorResult).error).toBe(
      "No components with prefix 'X' found in design 'design'. Available prefixes: [C, U]"
    );
  });
});
