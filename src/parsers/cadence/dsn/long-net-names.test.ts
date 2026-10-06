/**
 * Net names longer than Allegro's 31-character limit.
 *
 * The parser reports a net under the name the schematic gives it. The Allegro
 * netlister cuts a longer name to 31 characters and warns ORCAP-36005, "Net is
 * renamed", so the board's export names the same net differently. Exact name
 * lookups and name-by-name compares against the export miss these nets (see
 * issue #235). These tests pin both sides on a real design, so a netlist-name
 * alias can later be checked against the export Capture itself wrote.
 *
 * Fixture: Clay R6. Its microcontroller block names each net after every
 * function of the pin, and its Allegro export truncates 27 of those names.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseDsnFile } from "./dsn-parser.js";
import { parsePstxnet } from "../dat/pstxnet-parser.js";
import { queryXnetByNetName } from "../../../service/tools/query-xnet.js";
import { isErrorResult } from "../../../types.js";
import { fixturePath, hasFixtures } from "../../../../test/utils.js";

const CLAY = fixturePath("cadence", "clay-r6");
const BLOCK = join(CLAY, "MK64FN1M0VLL12", "MK64FN1M0VLL12.DSN");
const EXPORT = join(CLAY, "allegro", "pstxnet.dat");

const hasClay = hasFixtures && existsSync(BLOCK) && existsSync(EXPORT);

const ALLEGRO_NET_NAME_LIMIT = 31;
const FULL = "PTA2/JTAG_TDO/TRACE_SWO/EZP_D0/UART0_TX/FTM0_CH7";
const TRUNCATED = "PTA2/JTAG_TDO/TRACE_SWO/EZP_D0/";

/** Each export NET_NAME record with the name its schematic path line carries. */
function exportNetNames(content: string): { netName: string; schematicName: string }[] {
  const lines = content.split(/\r?\n/);
  const records: { netName: string; schematicName: string }[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    if (lines[i].trim() !== "NET_NAME") continue;
    const netName = lines[i + 1].trim().replace(/^'|'$/g, "");
    const path = lines[i + 2];
    const schematicName = path.slice(path.lastIndexOf("):") + 2).replace(/':\s*$/, "");
    records.push({ netName, schematicName });
  }
  return records;
}

describe.skipIf(!hasClay)("net names longer than the Allegro limit", () => {
  const block = parseDsnFile(BLOCK);
  const longNames = Object.keys(block.nets).filter((n) => n.length > ALLEGRO_NET_NAME_LIMIT);

  it("keeps the schematic's full net name", () => {
    expect(block.nets[FULL]).toEqual({ J1: ["6"], U1: ["36"] });
    expect(block.nets[TRUNCATED]).toBeUndefined();
    expect(longNames).toHaveLength(63);
  });

  it("matches an export that names the net by its first 31 characters", async () => {
    const exported = await parsePstxnet(EXPORT);
    // The board annotates the block's J1 and U1 as J7 and U5; pin numbers agree.
    expect(exported[TRUNCATED]).toEqual({ J7: ["6"], U5: ["36"] });
    expect(exported[FULL]).toBeUndefined();

    const truncated = longNames.filter((n) => n.slice(0, ALLEGRO_NET_NAME_LIMIT) in exported);
    expect(truncated).toHaveLength(27);
    for (const name of longNames) expect(exported[name]).toBeUndefined();
  });

  it("finds the net when queried by the name the export gives it", async () => {
    const result = await queryXnetByNetName(BLOCK, TRUNCATED);
    if (isErrorResult(result)) throw new Error(result.error);
    expect(result.starting_point).toBe(FULL);
    expect(result.net).toBe(FULL);
    expect(result.notes?.[0]).toContain("PSTWRITER 16.6");
  });

  it("finds every renamed export net under its full name in the schematic", () => {
    const renamed = exportNetNames(readFileSync(EXPORT, "latin1")).filter(
      (r) => r.netName !== "NC" && r.netName !== r.schematicName
    );
    expect(renamed).toHaveLength(27);
    for (const { netName, schematicName } of renamed) {
      expect(netName).toBe(schematicName.slice(0, ALLEGRO_NET_NAME_LIMIT));
      expect(block.nets[schematicName]).toBeDefined();
    }
  });
});
