import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { kicadHandler } from "./index.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";
import { listDesigns } from "../../service/tools/list-designs.js";
import { loadNetlist } from "../../service/load-netlist.js";
import { queryComponent } from "../../service/tools/query-component.js";
import { runErc } from "../../service/tools/run-erc.js";
import type { ErrorResult, ListDesignsResult } from "../../types.js";

/**
 * KiCad's own qa/data/cli/variants project: `Variant 1` leaves J1 off the
 * board and `Variant2` leaves R14 off. kicad-cli exports the same netlist for
 * both, so this is the design that proves the overlay is read from the
 * schematic rather than from the export.
 */
const PROJECT = fixturePath("kicad", "kicad-qa-variants", "variants.kicad_pro");
const hasProject = hasFixtures && existsSync(PROJECT);

const dnsRefdes = async (variant: string): Promise<string[]> => {
  const parsed = await kicadHandler.parse(PROJECT, { variant });
  return Object.entries(parsed.components)
    .filter(([, component]) => component.dns)
    .map(([refdes]) => refdes)
    .sort();
};

describe.skipIf(!hasProject)("KiCad design variant DNP", () => {
  it("lists both native variants after the core design, with no fabrication flag", async () => {
    const listed = (await listDesigns({ searchPath: path.dirname(PROJECT) })) as ListDesignsResult;
    const design = listed.designs.find((entry) => entry.path === PROJECT);
    expect(design?.design_variants.map((variant) => variant.name).sort()).toEqual([
      "<Default>",
      "Variant 1",
      "Variant2",
    ]);
    expect(design?.design_variants.every((variant) => variant.fabrication === undefined)).toBe(
      true
    );
  });

  it("refuses a query that omits the selector", async () => {
    expect((await loadNetlist(PROJECT)) as ErrorResult).toMatchObject({
      error: expect.stringContaining("defines design variants ['Variant 1', 'Variant2']"),
    });
  });

  it("applies each variant's not-fitted rows from the schematic", async () => {
    expect(await dnsRefdes("<Default>")).toEqual([]);
    expect(await dnsRefdes("Variant 1")).toEqual(["J1"]);
    expect(await dnsRefdes("variant2")).toEqual(["R14"]);
  });

  it("echoes the variant and counts the skipped part in ERC", async () => {
    expect(await queryComponent(PROJECT, "R14", "Variant2")).toMatchObject({
      design_variant: "Variant2",
      refdes: "R14",
      value: "470",
      dns: true,
    });
    expect(await runErc(PROJECT, { designVariant: "Variant2" })).toMatchObject({
      design_variant: "Variant2",
      skipped: { dns: 1 },
    });
  });
});
