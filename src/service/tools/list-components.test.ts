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
      nets: { VPP: { "C?": "1", "D?": "2", "PS?": "3" }, GND: { "C?": "2" } },
      components: {
        "C?": { value: "220uF", description: "Polarized capacitor", pins: { "1": "VPP", "2": "GND" } },
        "D?": { value: "PMEG6020ER", description: "Schottky diode", pins: { "2": "VPP" } },
        "PS?": { value: "ROF-78E3.3", pins: { "3": "VPP" } },
      },
    };

    beforeEach(() => mockParse(netlist));

    it("matches an unannotated refdes by its letter prefix", async () => {
      const result = await listComponents(DESIGN, "C");
      expect(isErrorResult(result)).toBe(false);
      const refdes = (result as ListComponentsResult).components.map((c) => c.refdes);
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
      nets: { N1: { U1: "1" } },
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
      nets: { N1: { U1: "1" } },
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
      nets: { VDD: { U1: "1" } },
      components: { U1: { mpn: "TPS62088", description: "Buck Converter", pins: { "1": "VDD" } } },
    });
    const result = await listComponents(DESIGN, "U");
    expect(isErrorResult(result)).toBe(false);
    expect((result as ListComponentsResult).components.map((c) => c.refdes)).toContain("U1");
  });
});
