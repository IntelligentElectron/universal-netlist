import { afterEach, describe, expect, it, vi } from "vitest";
import * as parsers from "../parsers/index.js";
import { loadNetlist } from "./load-netlist.js";
import type { EDAProjectFormatHandler, ParsedNetlist } from "../types.js";

const DESIGN = "/mock/board.PrjPcb";
const parsed: ParsedNetlist = {
  nets: { N1: { R1: ["1"] } },
  components: { R1: { pins: { "1": "N1", "2": "" } } },
};

const mockHandler = (): EDAProjectFormatHandler => ({
  name: "mock",
  extensions: [".prjpcb"],
  canHandle: () => true,
  discoverDesigns: vi.fn(),
  listVariants: vi.fn().mockResolvedValue([{ name: "Production" }, { name: "Debug" }]),
  parse: vi.fn(),
});

describe("loadNetlist variant selection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses to guess when a design exposes named assembly variants", async () => {
    const handler = mockHandler();
    vi.spyOn(parsers, "findHandler").mockReturnValue(handler);
    const parse = vi.spyOn(parsers, "parseDesign").mockResolvedValue(structuredClone(parsed));

    expect(await loadNetlist(DESIGN)).toEqual({
      error: expect.stringContaining("defines design variants ['Production', 'Debug']"),
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it("matches a native variant case-insensitively and passes its canonical spelling", async () => {
    vi.spyOn(parsers, "findHandler").mockReturnValue(mockHandler());
    const parse = vi.spyOn(parsers, "parseDesign").mockResolvedValue(structuredClone(parsed));

    const result = await loadNetlist(DESIGN, "production");
    expect(parse).toHaveBeenCalledWith(DESIGN, { variant: "Production" });
    expect("components" in result && result.components.R1.pins["2"]).toBe("NC");
    expect("design_variant" in result && result.design_variant).toBe("Production");
  });

  it("accepts the explicit core design and rejects unknown names", async () => {
    vi.spyOn(parsers, "findHandler").mockReturnValue(mockHandler());
    const parse = vi.spyOn(parsers, "parseDesign").mockResolvedValue(structuredClone(parsed));

    await expect(loadNetlist(DESIGN, "<default>")).resolves.toMatchObject({
      design_variant: "<Default>",
      components: {},
    });
    expect(parse).toHaveBeenLastCalledWith(DESIGN, { variant: "<Default>" });
    // The plain word is an alias, so a caller need not type the angle brackets.
    await expect(loadNetlist(DESIGN, "default")).resolves.toMatchObject({
      design_variant: "<Default>",
    });
    expect(parse).toHaveBeenLastCalledWith(DESIGN, { variant: "<Default>" });

    expect(await loadNetlist(DESIGN, "missing")).toEqual({
      error: expect.stringContaining("Available: ['Production', 'Debug', '<Default>']"),
    });
  });

  it("passes the core design explicitly when no native variants exist", async () => {
    const handler = mockHandler();
    handler.listVariants = vi.fn().mockResolvedValue([]);
    vi.spyOn(parsers, "findHandler").mockReturnValue(handler);
    const parse = vi.spyOn(parsers, "parseDesign").mockResolvedValue(structuredClone(parsed));

    await loadNetlist(DESIGN);

    expect(parse).toHaveBeenCalledWith(DESIGN, { variant: "<Default>" });
  });
});
