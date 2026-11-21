/**
 * Pins a part's package shorts together (PACK_SHORT, docs/cadence-dsn-format.md §5.8).
 *
 * Fixture: Clay R6's top level. Its GPIO_3X3_100 connectors J3-J6 mark pins
 * 5-8 (VDD1, VDD2, GND2, GND1) Pin Ignore, none of them wired, and the library
 * part's PACK_SHORT `(VDD,VDD1,VDD2)(GND,GND1,GND2)` ties them to VDD and GND.
 * The board's Allegro export, in the same fixture, is the oracle: top-level
 * parts keep the board's reference designators.
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { parseDsnFile } from "./dsn-parser.js";
import { parsePstxnet } from "../dat/pstxnet-parser.js";
import { fixturePath, hasFixtures } from "../../../../test/utils.js";

const CLAY = fixturePath("cadence", "clay-r6");
const TOP = join(CLAY, "top", "CLAYR6.DSN");
const EXPORT = join(CLAY, "allegro", "pstxnet.dat");

const hasClay = hasFixtures && existsSync(TOP) && existsSync(EXPORT);

const netOf = (nets: Record<string, Record<string, string[]>>, ref: string, pin: string) =>
  Object.keys(nets).find((n) => nets[n][ref]?.includes(pin));

describe.skipIf(!hasClay)("pins a part's package shorts together", () => {
  const SHORTED = ["J3", "J4", "J5", "J6"].flatMap((ref) =>
    ["5", "6", "7", "8"].map((pin) => [ref, pin] as const)
  );

  it("puts every PACK_SHORT pin on the net Capture's export gives it", async () => {
    const ours = parseDsnFile(TOP).nets;
    const exported = await parsePstxnet(EXPORT);

    for (const [ref, pin] of SHORTED) {
      const expected = netOf(exported, ref, pin);
      expect(expected, `${ref}.${pin} in the export`).toBeDefined();
      expect(netOf(ours, ref, pin), `${ref}.${pin}`).toBe(expected);
    }
  });

  it("joins VDD1 and VDD2 to VDD's net, and GND1 and GND2 to GND's", () => {
    const ours = parseDsnFile(TOP).nets;
    expect(netOf(ours, "J3", "5")).toBe(netOf(ours, "J3", "4"));
    expect(netOf(ours, "J3", "8")).toBe(netOf(ours, "J3", "9"));
  });
});
