import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchComponentsByRefdes,
  searchComponentsByMpn,
  searchComponentsByDescription,
} from "./search-components.js";
import type { ParsedNetlist, ErrorResult } from "../../types.js";
import * as parsersModule from "../../parsers/index.js";

const isErrorResult = (result: unknown): result is ErrorResult =>
  typeof result === "object" && result !== null && "error" in result;

describe("search tools - broad pattern rejection", () => {
  const mockNetlist: ParsedNetlist = {
    nets: {
      VDD_1V8: { U1: ["1"] },
      GND: { U1: ["2"], R1: ["2"] },
      SIG_A: { R1: ["1"] },
    },
    components: {
      U1: {
        mpn: "TPS62088",
        description: "Buck Converter",
        pins: { "1": "VDD_1V8", "2": "GND" },
      },
      R1: {
        mpn: "RC0402FR-0710KL",
        description: "10K Resistor",
        pins: { "1": "SIG_A", "2": "GND" },
      },
    },
  };

  beforeEach(() => {
    vi.spyOn(parsersModule, "findHandler").mockReturnValue({
      name: "mock",
      extensions: [".dsn"],
      canHandle: () => true,
      discoverDesigns: vi.fn(),
      parse: vi.fn(),
    });
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(mockNetlist);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("searchComponentsByRefdes", () => {
    it("rejects .* pattern that matches all components", async () => {
      const result = await searchComponentsByRefdes(".*", "/mock/design.dsn");
      expect(isErrorResult(result)).toBe(true);
      expect((result as ErrorResult).error).toContain("list_components");
      expect((result as ErrorResult).error).toContain("all 2 items");
    });

    it("allows specific pattern that matches subset", async () => {
      const result = await searchComponentsByRefdes("^U", "/mock/design.dsn");
      expect(isErrorResult(result)).toBe(false);
    });
  });

  describe("searchComponentsByMpn", () => {
    it("rejects .* pattern that matches all components with MPN", async () => {
      const result = await searchComponentsByMpn(".*", "/mock/design.dsn");
      expect(isErrorResult(result)).toBe(true);
      expect((result as ErrorResult).error).toContain("list_components");
      expect((result as ErrorResult).error).toContain("all 2 items");
    });

    it("allows specific pattern that matches subset", async () => {
      const result = await searchComponentsByMpn("TPS", "/mock/design.dsn");
      expect(isErrorResult(result)).toBe(false);
    });
  });

  describe("searchComponentsByDescription", () => {
    it("rejects .* pattern that matches all components with description", async () => {
      const result = await searchComponentsByDescription(".*", "/mock/design.dsn");
      expect(isErrorResult(result)).toBe(true);
      expect((result as ErrorResult).error).toContain("list_components");
      expect((result as ErrorResult).error).toContain("all 2 items");
    });

    it("allows specific pattern that matches subset", async () => {
      const result = await searchComponentsByDescription("Buck", "/mock/design.dsn");
      expect(isErrorResult(result)).toBe(false);
    });
  });
});
