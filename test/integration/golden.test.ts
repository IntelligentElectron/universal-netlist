/**
 * Golden reference tests for netlist parsers.
 *
 * These tests compare parser output against committed golden JSON files,
 * enabling regression detection without mocks.
 *
 * To add a new test fixture:
 * 1. Add design files to test/fixtures/{format}/{design-name}/
 * 2. Run `npm test` - the test will fail with "missing golden output"
 * 3. Generate golden output: npx tsx scripts/gen-golden.ts <format> <name> <path>
 * 4. Commit the golden JSON file to test/golden/{format}/{name}.json
 */

import path from "node:path";
import { describe, it, expect } from "vitest";
import { listAllFixtures, loadGolden, findDesignFiles } from "../utils.js";
import { parseDesign } from "../../src/parsers/index.js";

describe("Golden Reference Tests", () => {
  it("should pass when no fixtures are present", async () => {
    const fixtures = await listAllFixtures();
    if (fixtures.length === 0) {
      expect(true).toBe(true);
    }
  });
});

describe("Parser Golden Output", async () => {
  const fixtures = await listAllFixtures();

  if (fixtures.length === 0) {
    it.skip("no fixtures available", () => {});
    return;
  }

  for (const fixture of fixtures) {
    const designFiles = await findDesignFiles(fixture);

    if (designFiles.length === 0) {
      describe(`${fixture.format}/${fixture.name}`, () => {
        it.skip("no design files found", () => {});
      });
      continue;
    }

    for (const designFile of designFiles) {
      const projectName = path.basename(designFile, path.extname(designFile));

      describe(`${fixture.format}/${projectName}`, () => {
        it("should match golden output", async () => {
          const golden = await loadGolden(fixture.format, projectName);

          if (!golden) {
            throw new Error(
              `Missing golden output for ${fixture.format}/${projectName}. ` +
                `Generate it with: npx tsx scripts/gen-golden.ts ${fixture.format} ${projectName} "${designFile}"`,
            );
          }

          const actual = await parseDesign(designFile);

          expect(actual).toEqual(golden);
        });
      });
    }
  }
});
