import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ParsedNetlist, ErrorResult } from "../../types.js";
import * as parsersModule from "../../parsers/index.js";

const isErrorResult = (result: unknown): result is ErrorResult =>
  typeof result === "object" && result !== null && "error" in result;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KICAD_FIXTURES = path.resolve(HERE, "../../../test/fixtures/kicad");
// OpenMD's committed .net declares its ground as the hierarchical "/GND", so it
// parses without kicad-cli and exercises the real classify+reject path in CI.
const OPENMD = path.join(KICAD_FIXTURES, "openmd-motordriver", "OpenMD.kicad_pro");
const hasOpenMd = existsSync(OPENMD);

describe("queryXnetByNetName - ground net blocking", () => {
  let queryXnetByNetName: typeof import("./query-xnet.js").queryXnetByNetName;

  beforeAll(async () => {
    vi.spyOn(parsersModule, "findHandler").mockReturnValue({
      name: "mock",
      extensions: [".dsn"],
      canHandle: () => true,
      discoverDesigns: vi.fn(),
      parse: vi.fn(),
    });

    const mod = await import("./query-xnet.js");
    queryXnetByNetName = mod.queryXnetByNetName;
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should return error for GND net", async () => {
    const mockNetlist: ParsedNetlist = {
      nets: { GND: { R1: "2" } },
      components: { R1: { pins: { "1": "SIGNAL", "2": "GND" }, mpn: "10k" } },
    };
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);

    const result = await queryXnetByNetName("/mock/design.dsn", "GND");

    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("ground net");
    expect((result as ErrorResult).error).toContain("cannot be queried");
  });

  it("should return error for DGND net", async () => {
    const mockNetlist: ParsedNetlist = {
      nets: { DGND: { U1: "1" } },
      components: { U1: { pins: { "1": "DGND" }, mpn: "IC" } },
    };
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);

    const result = await queryXnetByNetName("/mock/design.dsn", "DGND");

    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("ground net");
    expect((result as ErrorResult).error).toContain("cannot be queried");
  });

  it("should return error for GNDREF (KiCad's default global ground)", async () => {
    // Regression: GNDREF previously slipped the guard and the trace flooded the
    // whole ground tree, overflowing the token limit.
    const mockNetlist: ParsedNetlist = {
      nets: { GNDREF: { U1: "1" } },
      components: { U1: { pins: { "1": "GNDREF" }, mpn: "IC" } },
    };
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);

    const result = await queryXnetByNetName("/mock/design.dsn", "GNDREF");

    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("ground net");
    expect((result as ErrorResult).error).toContain("cannot be queried");
  });

  it("should return error for a hierarchical (sheet-path-prefixed) ground net", async () => {
    const mockNetlist: ParsedNetlist = {
      nets: { "/GND": { U1: "1" } },
      components: { U1: { pins: { "1": "/GND" }, mpn: "IC" } },
    };
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);

    const result = await queryXnetByNetName("/mock/design.dsn", "/GND");

    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("ground net");
    expect((result as ErrorResult).error).toContain("cannot be queried");
  });

  it("should allow non-ground net queries", async () => {
    const mockNetlist: ParsedNetlist = {
      nets: { SIGNAL: { R1: "1" }, GND: { R1: "2" } },
      components: { R1: { pins: { "1": "SIGNAL", "2": "GND" }, mpn: "10k" } },
    };
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);

    const result = await queryXnetByNetName("/mock/design.dsn", "SIGNAL");

    expect(isErrorResult(result)).toBe(false);
  });
});

describe("queryXnetByPinName - ground net blocking", () => {
  let queryXnetByPinName: typeof import("./query-xnet.js").queryXnetByPinName;

  beforeAll(async () => {
    vi.spyOn(parsersModule, "findHandler").mockReturnValue({
      name: "mock",
      extensions: [".dsn"],
      canHandle: () => true,
      discoverDesigns: vi.fn(),
      parse: vi.fn(),
    });

    const mod = await import("./query-xnet.js");
    queryXnetByPinName = mod.queryXnetByPinName;
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("should return error when pin is connected to GND", async () => {
    const mockNetlist: ParsedNetlist = {
      nets: { GND: { R1: "2" }, SIGNAL: { R1: "1" } },
      components: { R1: { pins: { "1": "SIGNAL", "2": "GND" }, mpn: "10k" } },
    };
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);

    const result = await queryXnetByPinName("/mock/design.dsn", "R1.2");

    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("(ground)");
    expect((result as ErrorResult).error).toContain("cannot be queried");
    expect((result as ErrorResult).error).toContain("R1.2");
  });

  it("should return error when pin is connected to GNDREF", async () => {
    const mockNetlist: ParsedNetlist = {
      nets: { GNDREF: { R1: "2" }, SIGNAL: { R1: "1" } },
      components: { R1: { pins: { "1": "SIGNAL", "2": "GNDREF" }, mpn: "10k" } },
    };
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);

    const result = await queryXnetByPinName("/mock/design.dsn", "R1.2");

    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("(ground)");
    expect((result as ErrorResult).error).toContain("cannot be queried");
    // The offending net name must appear, so a future regression can't blame the wrong net.
    expect((result as ErrorResult).error).toContain("GNDREF");
  });

  it("should allow non-ground pin queries", async () => {
    const mockNetlist: ParsedNetlist = {
      nets: { GND: { R1: "2" }, SIGNAL: { R1: "1" } },
      components: { R1: { pins: { "1": "SIGNAL", "2": "GND" }, mpn: "10k" } },
    };
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);

    const result = await queryXnetByPinName("/mock/design.dsn", "R1.1");

    expect(isErrorResult(result)).toBe(false);
  });

  it("should still handle NC pins correctly", async () => {
    const mockNetlist: ParsedNetlist = {
      nets: { NC: {}, SIGNAL: { U1: "2" } },
      components: { U1: { pins: { "1": "NC", "2": "SIGNAL" }, mpn: "IC" } },
    };
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);

    const result = await queryXnetByPinName("/mock/design.dsn", "U1.1");

    expect(isErrorResult(result)).toBe(false);
    expect("net" in result && result.net).toBe("NC");
  });
});

// End-to-end against a real committed fixture (no mocks): OpenMD's ground net is
// the hierarchical "/GND", which previously slipped the guard and flooded the
// trace. This drives the real parser + classifier through the public tool.
describe.skipIf(!hasOpenMd)("queryXnetByNetName - real fixture (OpenMD /GND)", () => {
  it("rejects the hierarchical /GND ground net", async () => {
    const { queryXnetByNetName } = await import("./query-xnet.js");

    const result = await queryXnetByNetName(OPENMD, "/GND");

    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).error).toContain("ground net");
    expect((result as ErrorResult).error).toContain("cannot be queried");
  });
});
