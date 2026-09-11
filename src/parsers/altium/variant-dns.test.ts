import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { altiumHandler } from "./index.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";
import { listDesigns } from "../../service/tools/list-designs.js";
import { loadNetlist } from "../../service/load-netlist.js";
import { listComponents } from "../../service/tools/list-components.js";
import { queryComponent } from "../../service/tools/query-component.js";
import { queryXnetByNetName } from "../../service/tools/query-xnet.js";
import { runErc } from "../../service/tools/run-erc.js";
import type {
  AggregatedCircuitResult,
  ErrorResult,
  ListComponentsResult,
  ListDesignsResult,
} from "../../types.js";

const PROJECT = fixturePath("altium", "qfsae-bspd-variant", "BSPD_002.PrjPcb");
const hasProject = hasFixtures && existsSync(PROJECT);
const DNP = ["R23", "R24", "R25", "R26", "R40"];

describe.skipIf(!hasProject)("Altium project variant DNP", () => {
  it("lists the design variants with the core design first and the fabrication flag", async () => {
    const listed = (await listDesigns({ searchPath: path.dirname(PROJECT) })) as ListDesignsResult;
    expect(listed.designs).toEqual([
      {
        name: "BSPD_002",
        path: PROJECT,
        design_variants: [
          { name: "<Default>", is_default: true },
          { name: "BSPD-DNP", fabrication: false },
        ],
        error: undefined,
      },
    ]);
  });

  it("refuses an ambiguous query that omits the design variant, quoting the names", async () => {
    const result = await loadNetlist(PROJECT);
    expect((result as ErrorResult).error).toContain("defines design variants ['BSPD-DNP']");
    expect((result as ErrorResult).error).toContain("design_variant='<Default>'");
  });

  it("marks exactly the five Not Fitted rows in the selected variant", async () => {
    const parsed = await altiumHandler.parse(PROJECT, { variant: "BSPD-DNP" });
    expect(
      Object.entries(parsed.components)
        .filter(([, component]) => component.dns)
        .map(([refdes]) => refdes)
        .sort()
    ).toEqual(DNP);
  });

  it("lists DNS parts by default, hides them on request, and echoes the variant", async () => {
    const shown = (await listComponents(
      PROJECT,
      "R",
      undefined,
      "bspd-dnp"
    )) as ListComponentsResult;
    const hidden = (await listComponents(PROJECT, "R", false, "BSPD-DNP")) as ListComponentsResult;
    const hiddenRefs = hidden.components.flatMap((group) => group.refdes);
    const shownDns = shown.components
      .filter((group) => group.dns)
      .flatMap((group) => group.refdes)
      .sort();

    expect(shown.design_variant).toBe("BSPD-DNP");
    expect(shownDns).toEqual(DNP);
    expect(DNP.every((refdes) => !hiddenRefs.includes(refdes))).toBe(true);
    expect(await queryComponent(PROJECT, "R23", "BSPD-DNP")).toMatchObject({
      design_variant: "BSPD-DNP",
      refdes: "R23",
      dns: true,
    });
    expect(await queryComponent(PROJECT, "R23", "default")).toMatchObject({
      design_variant: "<Default>",
      refdes: "R23",
    });
  });

  it("changes XNET membership/hash and reports the ERC skipped count", async () => {
    const withoutDns = (await queryXnetByNetName(
      PROJECT,
      "RESET",
      [],
      false,
      "BSPD-DNP"
    )) as AggregatedCircuitResult;
    const withDns = (await queryXnetByNetName(
      PROJECT,
      "RESET",
      [],
      true,
      "BSPD-DNP"
    )) as AggregatedCircuitResult;

    expect(withoutDns.design_variant).toBe("BSPD-DNP");
    expect(withoutDns.circuit_hash).not.toBe(withDns.circuit_hash);
    expect(withDns.components_by_mpn.flatMap((group) => group.refdes)).toContain("R40");
    expect(await runErc(PROJECT, { designVariant: "BSPD-DNP" })).toMatchObject({
      design_variant: "BSPD-DNP",
      skipped: { dns: 5 },
    });
    expect(await runErc(PROJECT, { designVariant: "<Default>" })).toMatchObject({
      design_variant: "<Default>",
      skipped: { dns: 0 },
    });
  });
});
