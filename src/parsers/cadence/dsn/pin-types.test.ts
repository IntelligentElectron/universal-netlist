/**
 * Pin electrical types and hidden power pins (docs/cadence-dsn-format.md §5.2.5).
 *
 * Fixtures: Clay R6's top level and BeagleBone Black, each with the board's
 * Allegro export. The export's pstchip.dat states every pin's attributes, which
 * map one-to-one to Capture's `pin_type` values; pstxprt.dat names each refdes's
 * primitive.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseDsnFile } from "./dsn-parser.js";
import { libraryPinDetails } from "./component-builder.js";
import { fixturePath, hasFixtures } from "../../../../test/utils.js";

const CLAY = fixturePath("cadence", "clay-r6");
const BBB = fixturePath("cadence", "BeagleBone-Black", "ALLEGRO");
const DESIGNS = [
  { design: join(CLAY, "top", "CLAYR6.DSN"), exportDir: join(CLAY, "allegro"), atLeast: 50 },
  { design: join(BBB, "BEAGLEBONEBLK_C3.DSN"), exportDir: BBB, atLeast: 1000 },
];

/** The pin type a pstchip pin's attributes state. */
const exportType = (attributes: string): string | undefined => {
  if (/BIDIRECTIONAL='TRUE'/i.test(attributes)) return "bidirectional";
  if (/OUTPUT_TYPE='\(OC,AND\)'/i.test(attributes)) return "open_collector";
  if (/OUTPUT_TYPE='\(TS,TS\)'/i.test(attributes)) return "tristate";
  if (/PINUSE='POWER'/i.test(attributes)) return "power";
  if (/PINUSE='UNSPEC'/i.test(attributes)) return "passive";
  if (/OUTPUT_LOAD/i.test(attributes)) return "output";
  if (/INPUT_LOAD/i.test(attributes)) return "input";
  return undefined;
};

describe.each(DESIGNS)(
  "pin electrical types against Capture's export",
  ({ design, exportDir, atLeast }) => {
    const CHIP = join(exportDir, "pstchip.dat");
    const XPRT = join(exportDir, "pstxprt.dat");
    it.skipIf(!(hasFixtures && existsSync(design) && existsSync(CHIP) && existsSync(XPRT)))(
      `gives every pin of ${design.split("/").pop()} the type the export states`,
      () => {
        const primitives = new Map<string, Map<string, string>>();
        for (const m of readFileSync(CHIP, "latin1").matchAll(
          /primitive '([^']+)';([\s\S]*?)end_primitive;/g
        )) {
          const pins = new Map<string, string>();
          for (const p of m[2].matchAll(/'[^']*':\s*([\s\S]*?)(?=\n\s*'[^']*':|\n\s*end_pin;)/g)) {
            const numbers = /PIN_NUMBER='\(([^)]*)\)'/.exec(p[1])?.[1];
            const type = exportType(p[1]);
            if (numbers && type)
              for (const n of numbers.split(",")) if (n !== "0") pins.set(n, type);
          }
          primitives.set(m[1], pins);
        }
        const partOf = new Map<string, string>();
        for (const m of readFileSync(XPRT, "latin1").matchAll(
          /PART_NAME\s*\n\s*(\S+)\s+'([^']+)'/g
        )) {
          partOf.set(m[1], m[2]);
        }

        let compared = 0;
        for (const [refdes, component] of Object.entries(parseDsnFile(design).components)) {
          const pins = primitives.get(partOf.get(refdes) ?? "");
          if (!pins) continue;
          for (const [pin, entry] of Object.entries(component.pins)) {
            const want = pins.get(pin);
            if (!want || typeof entry === "string" || entry.type === undefined) continue;
            expect(entry.type, `${refdes}.${pin}`).toBe(want);
            compared++;
          }
        }
        expect(compared).toBeGreaterThan(atLeast);
      }
    );
  }
);

describe("libraryPinDetails", () => {
  const part = {
    pinNames: ["A", "GND", ""],
    pinTypes: [0, 7, -1],
    // A visible input; a power pin with the visible bit clear; an empty slot.
    pinShapes: [0x20, 0x81, 0],
  };

  it("names the type of the pin at a 1-based pin index", () => {
    expect(libraryPinDetails(part, 1)).toEqual({ type: "input" });
  });

  it("marks a power pin the symbol does not draw as hidden", () => {
    expect(libraryPinDetails(part, 2)).toEqual({ type: "power", hidden: true });
  });

  it("gives nothing for an empty slot, an unknown index or no library part", () => {
    expect(libraryPinDetails(part, 3)).toEqual({});
    expect(libraryPinDetails(part, undefined)).toEqual({});
    expect(libraryPinDetails(undefined, 1)).toEqual({});
  });
});
