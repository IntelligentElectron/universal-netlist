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
import { listAllFixtures, loadGolden, findDesignFiles, findDsnFiles } from "../utils.js";
import { parseDesign } from "../../src/parsers/index.js";
import { findCadenceDatFiles } from "../../src/parsers/cadence/discovery.js";
import { parseDsnFile } from "../../src/parsers/cadence/dsn/dsn-parser.js";
import type { ParsedNetlist } from "../../src/types.js";

/**
 * Resolve the DAT parsing path for a Cadence design file.
 * Golden files are always generated from DAT output (gold standard).
 * For .dsn files with available DAT exports, returns the pstxnet.dat path.
 * Otherwise returns the original design file path.
 */
const resolveGoldenParsePath = async (designFile: string): Promise<string> => {
  const ext = path.extname(designFile).toLowerCase();
  if (ext === ".dsn") {
    const datFiles = await findCadenceDatFiles(designFile);
    if (datFiles.pstxnet) return datFiles.pstxnet;
  }
  return designFile;
};

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
      // For dat-only Cadence designs, use the fixture directory name instead of "pstxnet"
      const baseName = path.basename(designFile);
      const projectName =
        baseName.toLowerCase() === "pstxnet.dat"
          ? fixture.name
          : path.basename(designFile, path.extname(designFile));

      describe(`${fixture.format}/${projectName}`, () => {
        it("should match golden output", async () => {
          const golden = await loadGolden(fixture.format, projectName);

          if (!golden) {
            throw new Error(
              `Missing golden output for ${fixture.format}/${projectName}. ` +
                `Generate it with: npx tsx scripts/gen-golden.ts ${fixture.format} ${projectName} "${designFile}"`
            );
          }

          const parsePath = await resolveGoldenParsePath(designFile);
          const actual = await parseDesign(parsePath);

          expect(actual).toEqual(golden);
        });
      });
    }
  }
});

/**
 * DSN Parser Coverage - Compare direct DSN binary parsing against DAT golden output.
 *
 * For each Cadence .DSN fixture that has a golden JSON (from .dat parsing),
 * parse the .DSN directly and measure net/component coverage.
 */
describe("DSN Parser Coverage vs DAT Golden", async () => {
  const fixtures = await listAllFixtures();
  const cadenceDsnFixtures: { designFile: string; projectName: string; golden: ParsedNetlist }[] =
    [];

  for (const fixture of fixtures) {
    if (fixture.format !== "cadence") continue;
    // Find .dsn files directly (findDesignFiles prefers DAT for golden tests)
    const dsnFiles = await findDsnFiles(fixture);
    for (const designFile of dsnFiles) {
      const projectName = path.basename(designFile, path.extname(designFile));
      const golden = await loadGolden("cadence", projectName);
      if (golden) {
        cadenceDsnFixtures.push({ designFile, projectName, golden });
      }
    }
  }

  if (cadenceDsnFixtures.length === 0) {
    it.skip("no cadence DSN fixtures with golden files", () => {});
    return;
  }

  for (const { designFile, projectName, golden } of cadenceDsnFixtures) {
    describe(projectName, () => {
      it("should have >50% net coverage", () => {
        const dsn = parseDsnFile(designFile);
        const dsnNets = new Set(Object.keys(dsn.nets));
        const goldenNets = new Set(Object.keys(golden.nets));
        const common = [...dsnNets].filter((n) => goldenNets.has(n));
        const coverage = goldenNets.size > 0 ? common.length / goldenNets.size : 1;

        console.log(
          `[${projectName}] Nets: golden=${goldenNets.size} dsn=${dsnNets.size} common=${common.length} (${(coverage * 100).toFixed(1)}%)`
        );

        expect(coverage).toBeGreaterThan(0.5);
      });

      it("should have >50% component coverage", () => {
        const dsn = parseDsnFile(designFile);
        const dsnComponents = new Set(Object.keys(dsn.components));
        const goldenComponents = new Set(Object.keys(golden.components));
        const common = [...dsnComponents].filter((c) => goldenComponents.has(c));
        const coverage = goldenComponents.size > 0 ? common.length / goldenComponents.size : 1;

        console.log(
          `[${projectName}] Components: golden=${goldenComponents.size} dsn=${dsnComponents.size} common=${common.length} (${(coverage * 100).toFixed(1)}%)`
        );

        expect(coverage).toBeGreaterThan(0.5);
      });
    });
  }
});
