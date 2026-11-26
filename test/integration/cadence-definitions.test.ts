/**
 * Every Cadence fixture against its own part definitions.
 *
 * A placed part names its package, library, view and section, and the file
 * holds the package and view it means. The check in
 * scripts/lib/dsn-definition-check.ts walks those links directly and compares
 * each pin's number, Pin Ignore flag and name with what the parser resolves.
 * It is what decides the cells of the tables `section-pin-map` and
 * `part-definition` that real files reach: the last test lists them.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkPartDefinitions,
  type DefinitionCheck,
} from "../../scripts/lib/dsn-definition-check.js";
import { findDsnFiles, hasFixtures, listFixtures, unsupportedRefusal } from "../utils.js";
import path from "node:path";

const CHECK_TIMEOUT = 180_000;

describe.skipIf(!hasFixtures)("Cadence fixtures against their own part definitions", async () => {
  const designs = (
    await Promise.all((await listFixtures("cadence")).map((fixture) => findDsnFiles(fixture)))
  )
    .flat()
    .sort();
  const nameOf = (design: string): string => path.basename(design, path.extname(design));
  const supported = designs.filter((d) => !unsupportedRefusal("cadence", nameOf(d)));

  const checks = new Map<string, DefinitionCheck>();
  beforeAll(() => {
    for (const design of supported) checks.set(design, checkPartDefinitions(design));
  }, CHECK_TIMEOUT);

  it("finds the fixture designs", () => {
    expect(supported.length).toBeGreaterThanOrEqual(19);
  });

  for (const design of supported) {
    it(`${nameOf(design)}: every pin is the file's own`, () => {
      const check = checks.get(design)!;

      expect(check.pins).toBeGreaterThan(0);
      expect(check.differences).toEqual([]);
      // Every part names a library that holds a package of its name.
      expect(check.unchecked).toEqual([]);
    });
  }

  for (const design of designs.filter((d) => unsupportedRefusal("cadence", nameOf(d)))) {
    it(`${nameOf(design)}: is refused, as the parser refuses it`, () => {
      expect(() => checkPartDefinitions(design)).toThrow(
        unsupportedRefusal("cadence", nameOf(design))
      );
    });
  }

  it("reaches every table cell that is decided on real files", () => {
    const reached = (cells: (check: DefinitionCheck) => Record<string, number>): string[] =>
      [...new Set([...checks.values()].flatMap((check) => Object.keys(cells(check))))].sort();

    // section-pin-map: unit_suffix, section_index, sections_listed_under, a_map_under.
    expect(reached((check) => check.sectionCells)).toEqual([
      "no,in-range,source,none",
      "no,in-range,source,source",
      "unmapped,in-range,source,none",
      "yes,in-range,source,none",
      "yes,in-range,source,source",
    ]);
    // part-definition: own_library | packages_stream | other_library.
    expect(reached((check) => check.definitionCells)).toEqual([
      "defines the part | holds the part | defines the part",
      "defines the part | holds the part | none",
      "defines the part | none | defines the part",
      "defines the part | none | none",
    ]);
  });
});
