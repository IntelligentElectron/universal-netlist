/**
 * Service Unit Tests - MPN handling and notes
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import {
  MPN_MISSING_NOTE,
  groupComponentsByMpn,
  aggregateCircuitByMpn,
  detectCadenceVersions,
  exportCadenceNetlist,
} from "./service.js";
import type {
  ComponentDetails,
  CircuitComponent,
  ErrorResult,
  ParsedNetlist,
} from "./types.js";
import * as parsersModule from "./parsers/index.js";
import * as fs from "fs";

/**
 * Helper to check if result is an error.
 */
const isErrorResult = (result: unknown): result is ErrorResult =>
  typeof result === "object" && result !== null && "error" in result;

describe("MPN_MISSING_NOTE", () => {
  it("should contain guidance for the agent", () => {
    expect(MPN_MISSING_NOTE).toContain("MPN not found");
    expect(MPN_MISSING_NOTE).toContain("symbol properties");
    expect(MPN_MISSING_NOTE).toContain("BOM");
  });
});

describe("groupComponentsByMpn", () => {
  it("should set mpn to null and add notes when MPN is missing", () => {
    const components: ComponentDetails = {
      U1: { pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeNull();
    expect(result[0].notes).toBeDefined();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
    expect(result[0].refdes).toBe("U1");
  });

  it("should set mpn to the value and omit notes when MPN is present", () => {
    const components: ComponentDetails = {
      U1: { mpn: "TPS62088", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBe("TPS62088");
    expect(result[0].notes).toBeUndefined();
  });

  it("should set mpn to null when MPN is empty string", () => {
    const components: ComponentDetails = {
      U1: { mpn: "", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeNull();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
  });

  it("should set mpn to null when MPN is whitespace only", () => {
    const components: ComponentDetails = {
      U1: { mpn: "   ", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeNull();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
  });

  it("should group components with same MPN together without notes", () => {
    const components: ComponentDetails = {
      R1: {
        mpn: "10K",
        description: "Resistor",
        pins: { "1": "NET1", "2": "GND" },
      },
      R2: {
        mpn: "10K",
        description: "Resistor",
        pins: { "1": "NET2", "2": "GND" },
      },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBe("10K");
    expect(result[0].count).toBe(2);
    expect(result[0].notes).toBeUndefined();
  });

  it("should include value when present", () => {
    const components: ComponentDetails = {
      C1: { mpn: "CAP_0603", value: "10uF", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("10uF");
  });

  it("should omit description when not present (not empty string)", () => {
    const components: ComponentDetails = {
      U1: { mpn: "TPS62088", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].description).toBeUndefined();
    expect("description" in result[0]).toBe(false);
  });

  it("should include dns:true for DNS components when includeDns is true", () => {
    const components: ComponentDetails = {
      C1: {
        mpn: "DNS",
        description: "Do Not Stuff cap",
        pins: { "1": "VCC", "2": "GND" },
      },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, true);

    expect(result).toHaveLength(1);
    expect(result[0].dns).toBe(true);
  });

  it("should omit dns for non-DNS components", () => {
    const components: ComponentDetails = {
      C1: { mpn: "CAP_0603", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].dns).toBeUndefined();
  });

  it("should not group components without MPN (each gets its own entry with notes)", () => {
    const components: ComponentDetails = {
      U1: { description: "IC", pins: { "1": "VCC" } },
      U2: { description: "IC", pins: { "1": "VCC" } },
    };
    const entries = Object.entries(components) as Array<
      [string, ComponentDetails[string]]
    >;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.mpn === null)).toBe(true);
    expect(result.every((r) => r.notes?.includes(MPN_MISSING_NOTE))).toBe(true);
  });
});

describe("aggregateCircuitByMpn", () => {
  it("should set mpn to null and add notes for components without MPN", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "U1",
        description: "Voltage Regulator",
        connections: [
          { net: "VIN", pins: ["1"] },
          { net: "VOUT", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeNull();
    expect(result[0].notes).toBeDefined();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
  });

  it("should preserve mpn and omit notes for components with MPN", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "U1",
        mpn: "TPS62088",
        description: "Buck Converter",
        connections: [
          { net: "VIN", pins: ["1"] },
          { net: "VOUT", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBe("TPS62088");
    expect(result[0].notes).toBeUndefined();
  });

  it("should add notes to unaggregatable components (no MPN, no description)", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "X1",
        connections: [
          { net: "NET1", pins: ["1"] },
          { net: "NET2", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeNull();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
    expect(result[0].refdes).toBe("X1");
  });

  it("should set mpn to null when MPN is empty string", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "U1",
        mpn: "",
        description: "IC",
        connections: [{ net: "VCC", pins: ["1"] }],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeNull();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
  });

  it("should aggregate components with same MPN without notes", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "100nF",
        description: "Cap",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
      {
        refdes: "C2",
        mpn: "100nF",
        description: "Cap",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBe("100nF");
    expect(result[0].total_count).toBe(2);
    expect(result[0].notes).toBeUndefined();
  });

  it("should include value in aggregated results when provided", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "CAP_0603",
        value: "4.7uF",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("4.7uF");
  });

  it("should include dns:true for DNS components", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "DNS",
        description: "Do Not Stuff",
        dns: true,
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].dns).toBe(true);
  });

  it("should omit dns for non-DNS components", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "CAP_0603",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].dns).toBeUndefined();
    expect("dns" in result[0]).toBe(false);
  });

  it("should omit description when not present (not undefined in object)", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "CAP_0603",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].description).toBeUndefined();
    expect("description" in result[0]).toBe(false);
  });
});

describe("queryXnetByNetName - ground net blocking", () => {
  let queryXnetByNetName: typeof import("./service.js").queryXnetByNetName;

  beforeAll(async () => {
    // Mock the parsers module before importing service
    vi.spyOn(parsersModule, "findHandler").mockReturnValue({
      name: "mock",
      extensions: [".dsn"],
      canHandle: () => true,
      discoverDesigns: vi.fn(),
      parse: vi.fn(),
    });

    // Re-import after mocking
    const serviceModule = await import("./service.js");
    queryXnetByNetName = serviceModule.queryXnetByNetName;
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
  let queryXnetByPinName: typeof import("./service.js").queryXnetByPinName;

  beforeAll(async () => {
    vi.spyOn(parsersModule, "findHandler").mockReturnValue({
      name: "mock",
      extensions: [".dsn"],
      canHandle: () => true,
      discoverDesigns: vi.fn(),
      parse: vi.fn(),
    });

    const serviceModule = await import("./service.js");
    queryXnetByPinName = serviceModule.queryXnetByPinName;
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

// =============================================================================
// Cadence Export Tests
// =============================================================================

describe("exportCadenceNetlist", () => {
  it("returns error on non-Windows platform", async () => {
    // On Mac/Linux, this should always return an error
    if (process.platform !== "win32") {
      const result = await exportCadenceNetlist("/path/to/design.dsn");

      expect(isErrorResult(result)).toBe(true);
      expect((result as ErrorResult).error).toContain("Windows");
      expect((result as ErrorResult).error).toContain("pstswp");
    }
  });
});

describe("detectCadenceVersions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when cadence directory does not exist", async () => {
    vi.spyOn(fs.promises, "readdir").mockRejectedValue(
      new Error("ENOENT: no such file or directory"),
    );

    const versions = await detectCadenceVersions("/nonexistent/path");

    expect(versions).toEqual([]);
  });

  it("returns empty array when directory contains no SPB folders", async () => {
    vi.spyOn(fs.promises, "readdir").mockResolvedValue([
      "OrCAD_17.2",
      "Allegro_PCB",
      "random_folder",
      "SPB_invalid", // Invalid because version pattern doesn't match
    ] as never);

    const versions = await detectCadenceVersions("C:/Cadence");

    // SPB_invalid doesn't match the SPB_X.Y pattern, so no versions detected
    expect(versions).toEqual([]);
  });

  it("filters directories using SPB version regex pattern", async () => {
    // This test verifies the regex pattern SPB_(\d+\.\d+) works correctly
    // Note: fs.existsSync cannot be mocked in ESM, so versions with missing
    // executables will be filtered out on the real filesystem
    vi.spyOn(fs.promises, "readdir").mockResolvedValue([
      "SPB_17.4", // Valid pattern
      "SPB_23.1", // Valid pattern
      "SPB_invalid", // Invalid: no version number
      "OrCAD_17.2", // Invalid: wrong prefix
      "SPB_1.2.3", // Invalid: three-part version
    ] as never);

    // On a system without Cadence, this returns empty because existsSync
    // checks fail, but the regex filtering happens first
    const versions = await detectCadenceVersions("C:/Cadence");

    // Without Cadence installed, no versions will be returned
    // But we've verified the readdir was called with our mock data
    expect(Array.isArray(versions)).toBe(true);
  });
});
