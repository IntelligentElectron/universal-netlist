/**
 * Replays the golden duplicate-refdes table in docs/decision-tables/duplicate-refdes
 * against separateDuplicateRefdes and mergeRepeatedSections, one test per cell.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cellName, readTable } from "../../../../test/helpers/decision-table.js";
import { mergeRepeatedSections, separateDuplicateRefdes } from "./duplicate-refdes.js";
import type { ComponentDetails, NetConnections } from "../../../types.js";
import type { PageData } from "./page-parser.js";
import type { PlacedInstance } from "./structures.js";

const TABLES = path.resolve(__dirname, "../../../../docs/decision-tables/duplicate-refdes");

const strLst: string[] = ["", "PART_NUMBER", "PN-1", "PN-2"];
let nextDbId = 1;
const inst = (sourcePackage: string, sectionIndex: number, pn?: string): PlacedInstance => ({
  pkgName: `${sourcePackage}.Normal`,
  dbId: nextDbId++,
  reference: "U1",
  sourcePackage,
  partValueIdx: 0,
  prefixProperties: pn ? [[1, strLst.indexOf(pn)] as const] : [],
  locX: 0,
  locY: 0,
  symbolDisplayProps: [],
  t0x10s: [],
  sectionIndex,
});
const page = (name: string, placed: PlacedInstance): PageData =>
  ({ name, placedInstances: [placed] }) as unknown as PageData;

describe("golden table: duplicate-refdes parts", () => {
  const dims = ["package", "part_number", "section", "wiring"];
  for (const row of readTable(TABLES, "parts")) {
    if (row.outcome === "n/a") continue;
    it(cellName(row, dims), () => {
      const pages = [
        page("P1", inst("CONN", 0, "PN-1")),
        page(
          "P2",
          inst(
            row.package === "same" ? "CONN" : "HDR",
            row.section === "new" ? 1 : 0,
            { same: "PN-1", one_missing: undefined, different: "PN-2" }[row.part_number]
          )
        ),
      ];
      const result = separateDuplicateRefdes(pages, strLst);
      const second = { agree: "A", nc_vs_net: "NC", conflict: "B" }[row.wiring]!;
      const nets: NetConnections = { A: { "U1~1": ["1"] } };
      const components: ComponentDetails = { "U1~1": { pins: { "1": "A" } } };
      if (result.duplicates.U1) {
        components["U1~2"] = { pins: { "1": second } };
        (nets[second] ??= {})["U1~2"] = ["1"];
      }
      const repeated = mergeRepeatedSections(result, nets, components, new Map());

      const outcome = result.duplicates.U1
        ? "separate parts, refdes.duplicate"
        : repeated.U1
          ? "one part, refdes.section_repeated"
          : "one part";
      expect(outcome).toBe(row.outcome);
    });
  }
});
