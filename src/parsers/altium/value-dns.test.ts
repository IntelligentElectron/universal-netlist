/**
 * Do Not Populate written into Value, measured on a design that does it.
 *
 * `temperatureSensor` marks R1 and R3 by writing `DNP` into Value and leaving
 * every other field ordinary, which is the usual Altium convention. Value was
 * not among the fields the marker was looked for in, so both parts were
 * reported as stuffed and counted in every result that leaves Do Not Stuff out.
 *
 * A marker test that reads the value field can also unstuff a fitted part by
 * mistaking a unit for a marker, so what matters is not only how many parts it
 * finds but how many it invents. Across the sixteen Altium projects in the
 * corpus these two are the only parts it reaches, and the other fifteen carry
 * golden files that fail on any flag this moves; temperatureSensor has none,
 * which is why its own count is pinned here.
 */

import { describe, expect, it } from "vitest";
import { altiumHandler } from "./index.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";

const TEMPERATURE_SENSOR = fixturePath(
  "cadence",
  "LAUNCHXL-CC1310",
  "hardware",
  "devices",
  "temperatureSensor",
  "temperatureSensor",
  "temperatureSensor.PrjPcb"
);

describe.skipIf(!hasFixtures)("Do Not Populate written into Value", () => {
  it("reports the parts whose Value is the marker", async () => {
    const parsed = await altiumHandler.parse(TEMPERATURE_SENSOR);
    const dns = Object.entries(parsed.components)
      .filter(([, component]) => component.dns)
      .map(([refdes]) => refdes)
      .sort();

    expect(dns).toEqual(["R1", "R3"]);
  });

  it("leaves the rest of the design stuffed", async () => {
    const parsed = await altiumHandler.parse(TEMPERATURE_SENSOR);
    const total = Object.keys(parsed.components).length;
    const stuffed = Object.values(parsed.components).filter((c) => !c.dns).length;

    expect(total).toBeGreaterThan(40);
    expect(stuffed).toBe(total - 2);
  });
});
