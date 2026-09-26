/**
 * The builds `list_designs` offers for each design.
 *
 * The list is what a caller may pass as `design_variant`, so it never names a
 * build the design does not have: a design that declares variants has only
 * those, and a design that declares none has its base build.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as parsers from "../../parsers/index.js";
import { listDesigns } from "./list-designs.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";
import type { EDAProjectFormatHandler, ListDesignsResult } from "../../types.js";

const JETSON = ["cadence", "OSHW-Jetson-Series"];

const mockHandler = (
  overrides: Partial<EDAProjectFormatHandler> = {}
): EDAProjectFormatHandler => ({
  name: "mock",
  extensions: [".prjpcb"],
  canHandle: () => true,
  discoverDesigns: vi.fn(),
  listVariants: vi.fn().mockResolvedValue([{ name: "Production" }, { name: "Debug" }]),
  parse: vi.fn(),
  ...overrides,
});

const variantsOf = async (searchPath: string, endsWith: string) => {
  const result = (await listDesigns({ searchPath })) as ListDesignsResult;
  const design = result.designs.find((entry) => entry.path.endsWith(endsWith));
  return design?.design_variants;
};

describe("design_variants", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists only the declared variants of a design that declares any", async () => {
    vi.spyOn(parsers, "findHandler").mockReturnValue(mockHandler());
    vi.spyOn(parsers, "discoverDesigns").mockResolvedValue([
      { name: "board", format: "universal", sourcePath: "/mock/board.PrjPcb" },
    ]);

    expect(await variantsOf("/mock", "board.PrjPcb")).toEqual([
      { name: "Production" },
      { name: "Debug" },
    ]);
  });

  it("lists the base build of a design that declares none", async () => {
    vi.spyOn(parsers, "findHandler").mockReturnValue(
      mockHandler({ listVariants: vi.fn().mockResolvedValue([]) })
    );
    vi.spyOn(parsers, "discoverDesigns").mockResolvedValue([
      { name: "board", format: "universal", sourcePath: "/mock/board.DSN" },
    ]);

    expect(await variantsOf("/mock", "board.DSN")).toEqual([
      { name: "<Default>", is_default: true },
    ]);
  });

  it("lists the base build of a format that records no variants at all", async () => {
    vi.spyOn(parsers, "findHandler").mockReturnValue(
      mockHandler({ listVariants: undefined })
    );
    vi.spyOn(parsers, "discoverDesigns").mockResolvedValue([
      { name: "demo", format: "universal", sourcePath: "/mock/demo.netlist.json" },
    ]);

    expect(await variantsOf("/mock", "demo.netlist.json")).toEqual([
      { name: "<Default>", is_default: true },
    ]);
  });
});

describe.skipIf(!hasFixtures)("design_variants on real designs", () => {
  it("lists a Cadence CIS design's BOM variant as its one build", async () => {
    const dir = fixturePath(...JETSON, "reServer Jetson carrier board", "reServer J2032");
    expect(await variantsOf(dir, "reServer J2032_V1.DSN")).toEqual([
      { name: "Main", fabrication: true },
    ]);
  });

  it("lists the base build for a CIS design whose variant store is empty", async () => {
    const dir = fixturePath(...JETSON, "reComputer Jetson carrier board", "reComputer J401");
    expect(await variantsOf(dir, "reComputer J401_V1.0.DSN")).toEqual([
      { name: "<Default>", is_default: true },
    ]);
  });

  it("lists an Altium project's variant as its one build, with the vendor's fabrication flag", async () => {
    const dir = fixturePath("altium", "qfsae-bspd-variant");
    expect(await variantsOf(dir, "BSPD_002.PrjPcb")).toEqual([
      { name: "BSPD-DNP", fabrication: false },
    ]);
  });

  it("lists a KiCad project's variants as its builds, with no fabrication flag", async () => {
    const dir = fixturePath("kicad", "kicad-qa-variants");
    expect(await variantsOf(dir, "variants.kicad_pro")).toEqual([
      { name: "Variant 1" },
      { name: "Variant2" },
    ]);
  });
});
