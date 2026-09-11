import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { altiumHandler } from "./index.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";
import { listVariants } from "../../service/tools/list-variants.js";
import { loadNetlist } from "../../service/load-netlist.js";
import { listComponents } from "../../service/tools/list-components.js";
import { queryComponent } from "../../service/tools/query-component.js";
import { queryXnetByNetName } from "../../service/tools/query-xnet.js";
import { runErc } from "../../service/tools/run-erc.js";
import type { AggregatedCircuitResult, ErrorResult, ListComponentsResult } from "../../types.js";

const PROJECT = fixturePath("altium", "qfsae-bspd-variant", "BSPD_002.PrjPcb");
const hasProject = hasFixtures && existsSync(PROJECT);
const DNP = ["R23", "R24", "R25", "R26", "R40"];

describe.skipIf(!hasProject)("Altium project variant DNP", () => {
  it("discovers the named assembly variant and the explicit core design", async () => {
    expect(await listVariants(PROJECT)).toEqual({
      variants: [
        {
          name: "<Default>",
          description: "Unmodified/core design",
          is_default: true,
        },
        { name: "BSPD-DNP" },
      ],
    });
  });

  it("refuses an ambiguous query that omits the project variant", async () => {
    const result = await loadNetlist(PROJECT);
    expect((result as ErrorResult).error).toContain("defines assembly variants [BSPD-DNP]");
    expect((result as ErrorResult).error).toContain("variant='<Default>'");
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

  it("makes include_dns change component queries and preserve dns=true", async () => {
    const hidden = (await listComponents(PROJECT, "R", false, "BSPD-DNP")) as ListComponentsResult;
    const shown = (await listComponents(PROJECT, "R", true, "BSPD-DNP")) as ListComponentsResult;
    const hiddenRefs = hidden.components.flatMap((group) => group.refdes);
    const shownDns = shown.components
      .filter((group) => group.dns)
      .flatMap((group) => group.refdes)
      .sort();

    expect(DNP.every((refdes) => !hiddenRefs.includes(refdes))).toBe(true);
    expect(shownDns).toEqual(DNP);
    expect(await queryComponent(PROJECT, "R23", "BSPD-DNP")).toMatchObject({
      refdes: "R23",
      dns: true,
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

    expect(withoutDns.circuit_hash).not.toBe(withDns.circuit_hash);
    expect(withDns.components_by_mpn.flatMap((group) => group.refdes)).toContain("R40");
    expect(await runErc(PROJECT, { variant: "BSPD-DNP" })).toMatchObject({
      skipped: { dns: 5 },
    });
  });
});
