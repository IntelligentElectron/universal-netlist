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

    const result = (await loadNetlist(DESIGN)) as { error: string };
    expect(result.error).toContain("defines design variants ['Production', 'Debug']");
    expect(result.error).toContain("they are the only builds it records");
    expect(result.error).not.toContain("<Default>");
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

  /**
   * A design that declares variants has only those to build. The base design
   * is the drawing with everything fitted, which used to be accepted here and
   * answered ERC and XNET for a board that is never built.
   */
  it("refuses the base build of a design that declares variants, under either spelling", async () => {
    vi.spyOn(parsers, "findHandler").mockReturnValue(mockHandler());
    const parse = vi.spyOn(parsers, "parseDesign").mockResolvedValue(structuredClone(parsed));

    for (const selector of ["<Default>", "<default>", "default", "DEFAULT"]) {
      expect(await loadNetlist(DESIGN, selector)).toEqual({
        error:
          "'<Default>' is not a build of design 'board.PrjPcb': its variants " +
          "['Production', 'Debug'] are the assemblies it records, and nothing in the design " +
          "marks the bare schematic as one. Pass design_variant as one of those names.",
      });
    }
    expect(parse).not.toHaveBeenCalled();
  });

  it("rejects unknown names, listing only the builds the design has", async () => {
    vi.spyOn(parsers, "findHandler").mockReturnValue(mockHandler());
    const parse = vi.spyOn(parsers, "parseDesign").mockResolvedValue(structuredClone(parsed));

    expect(await loadNetlist(DESIGN, "missing")).toEqual({
      error: expect.stringContaining("Available: ['Production', 'Debug']."),
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it("offers the base build, explicitly or by alias, when no native variants exist", async () => {
    const handler = mockHandler();
    handler.listVariants = vi.fn().mockResolvedValue([]);
    vi.spyOn(parsers, "findHandler").mockReturnValue(handler);
    const parse = vi.spyOn(parsers, "parseDesign").mockResolvedValue(structuredClone(parsed));

    await expect(loadNetlist(DESIGN)).resolves.toMatchObject({
      design_variant: "<Default>",
      components: {},
    });
    expect(parse).toHaveBeenLastCalledWith(DESIGN, { variant: "<Default>" });
    for (const selector of ["<default>", "default"]) {
      await expect(loadNetlist(DESIGN, selector)).resolves.toMatchObject({
        design_variant: "<Default>",
      });
      expect(parse).toHaveBeenLastCalledWith(DESIGN, { variant: "<Default>" });
    }

    expect(await loadNetlist(DESIGN, "missing")).toEqual({
      error: expect.stringContaining("Available: ['<Default>']."),
    });
  });

  /**
   * The alias used to shadow a declared variant of the same name: asking for
   * `default` returned the base build with `<Default>` echoed, and the declared
   * variant could not be reached at all. Six of the Altium designs read for
   * this call their one production variant `Default`, so the declared name
   * wins and the literal stays the one spelling of the base build.
   */
  it("reaches a declared variant called `default` through its own name", async () => {
    const handler = mockHandler();
    handler.listVariants = vi.fn().mockResolvedValue([{ name: "Default" }, { name: "Main" }]);
    vi.spyOn(parsers, "findHandler").mockReturnValue(handler);
    const parse = vi.spyOn(parsers, "parseDesign").mockResolvedValue(structuredClone(parsed));

    await expect(loadNetlist(DESIGN, "default")).resolves.toMatchObject({
      design_variant: "Default",
    });
    expect(parse).toHaveBeenLastCalledWith(DESIGN, { variant: "Default" });

    expect(await loadNetlist(DESIGN, "<Default>")).toEqual({
      error: expect.stringContaining("'<Default>' is not a build of design 'board.PrjPcb'"),
    });
  });
});
