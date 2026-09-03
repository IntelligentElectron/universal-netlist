/**
 * Golden reference tests for netlist parsers.
 *
 * These tests compare parser output against committed golden JSON files,
 * enabling regression detection without mocks.
 *
 * To add a new test fixture:
 * 1. Add design files to test/fixtures/{format}/{design-name}/
 * 2. Run `npm test` - the test will fail with "missing golden output"
 * 3. Generate golden output: npm run golden -- <format> <name> <path>
 * 4. Commit the golden JSON file to test/golden/{format}/{name}.netlist.json
 */

import path from "node:path";
import { describe, it, expect } from "vitest";
import { listAllFixtures, loadGolden, findDesignFiles, findDsnFiles } from "../utils.js";
import { parseDesign } from "../../src/parsers/index.js";
import { parseCadenceDatDesign } from "../../src/parsers/cadence/index.js";
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
                `Generate it with: npm run golden -- ${fixture.format} ${projectName} "${designFile}"`
            );
          }

          const parsePath = await resolveGoldenParsePath(designFile);
          // DAT remains an independent test oracle, outside the MCP handler.
          const actual = await (/\.(dat|cpm)$/i.test(parsePath)
            ? parseCadenceDatDesign(parsePath)
            : parseDesign(parsePath));

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
  const cadenceDsnFixtures: {
    designFile: string;
    projectName: string;
    golden: ParsedNetlist;
    /** True when the golden came from pstxnet.dat rather than from our own DSN output. */
    isOracle: boolean;
  }[] = [];

  for (const fixture of fixtures) {
    if (fixture.format !== "cadence") continue;
    // Find .dsn files directly (findDesignFiles prefers DAT for golden tests)
    const dsnFiles = await findDsnFiles(fixture);
    for (const designFile of dsnFiles) {
      const projectName = path.basename(designFile, path.extname(designFile));
      const golden = await loadGolden("cadence", projectName);
      if (golden) {
        const datFiles = await findCadenceDatFiles(designFile);
        cadenceDsnFixtures.push({
          designFile,
          projectName,
          golden,
          isOracle: Boolean(datFiles.pstxnet),
        });
      }
    }
  }

  if (cadenceDsnFixtures.length === 0) {
    it.skip("no cadence DSN fixtures with golden files", () => {});
    return;
  }

  // The pin-level comparison below is gated on a fixture having a real
  // pstxnet.dat. A gate that silently turns false everywhere reports as skipped,
  // not failed, so the whole comparison could vanish behind a green run.
  it("should have oracle-backed fixtures to compare against", () => {
    const oracles = cadenceDsnFixtures.filter((f) => f.isOracle);
    console.log(
      `[cadence] oracle-backed fixtures: ${oracles.length} of ${cadenceDsnFixtures.length}`
    );
    expect(oracles.length).toBeGreaterThanOrEqual(10);
  });

  // One parse per design, shared by the three checks below. Each used to parse
  // the same .DSN again, which tripled the cost of the slowest tests in the suite.
  const parsed = new Map<string, ParsedNetlist>();
  const parseOnce = (designFile: string): ParsedNetlist => {
    let result = parsed.get(designFile);
    if (!result) parsed.set(designFile, (result = parseDsnFile(designFile)));
    return result;
  };

  for (const { designFile, projectName, golden, isOracle } of cadenceDsnFixtures) {
    describe(projectName, () => {
      /**
       * Net and component coverage above count names only. A pin can sit on the
       * wrong net while both names are present, so those two checks stay green
       * through the failure that matters most: a power symbol whose drawn box
       * overlaps a neighbouring rail used to pull that rail's pins onto its own
       * net, and name coverage never moved.
       *
       * This compares the pins themselves, and only against a golden that came
       * from Cadence's own pstxnet.dat. Comparing our DSN output to a golden we
       * generated from that same DSN would agree with itself by construction.
       *
       * Every oracle-backed fixture agrees exactly, so the bar is exact
       * agreement. A new fixture that does not clear it is telling you the
       * parser has a gap on it, and the failure names the nets that differ.
       */
      it.runIf(isOracle)("should place pins on the same nets as the DAT export", () => {
        const dsn = parseOnce(designFile);

        const pinSet = (conns: Record<string, string[]> | undefined): Set<string> => {
          const pins = new Set<string>();
          for (const [refdes, numbers] of Object.entries(conns ?? {})) {
            for (const number of numbers) pins.add(`${refdes}.${number}`);
          }
          return pins;
        };
        const sameSet = (a: Set<string>, b: Set<string>): boolean =>
          a.size === b.size && [...a].every((pin) => b.has(pin));

        const common = Object.keys(golden.nets).filter((net) => net in dsn.nets);
        const differing = common.filter(
          (net) => !sameSet(pinSet(golden.nets[net]), pinSet(dsn.nets[net]))
        );
        const agreement = common.length > 0 ? (common.length - differing.length) / common.length : 1;

        // `common` is an intersection, so a net the parser lost and a net it
        // invented are both filtered out of it. Those are the two ways a net can
        // go wrong without any pin set disagreeing, so they are asserted too.
        const missing = Object.keys(golden.nets).filter((net) => !(net in dsn.nets));
        const invented = Object.keys(dsn.nets).filter((net) => !(net in golden.nets));

        console.log(
          `[${projectName}] Connectivity: common=${common.length} exact=${common.length - differing.length} differing=${differing.length} (${(agreement * 100).toFixed(2)}%) missing=${missing.length} invented=${invented.length}` +
            (differing.length > 0 ? ` -> ${differing.slice(0, 8).join(", ")}` : "")
        );

        expect(differing).toEqual([]);
        expect(missing).toEqual([]);
        expect(invented).toEqual([]);
      });

      /**
       * Pin function names come from the Cache stream's LibraryPart records,
       * a different path from the pin numbers, and nothing else here reads it.
       * A design whose Cache walk recovered Packages but no LibraryParts still
       * scored 100% on every other measure while reporting no pin names at all.
       */
      it.runIf(isOracle)("should give pins the same function names as the DAT export", () => {
        const dsn = parseOnce(designFile);
        const mismatches: string[] = [];
        let compared = 0;

        for (const [refdes, goldenComp] of Object.entries(golden.components)) {
          const dsnComp = dsn.components[refdes];
          if (!dsnComp) continue;
          for (const [pinNumber, goldenPin] of Object.entries(goldenComp.pins ?? {})) {
            const goldenName = typeof goldenPin === "string" ? undefined : goldenPin.name;
            if (!goldenName) continue;
            const dsnPin = dsnComp.pins?.[pinNumber];
            if (dsnPin === undefined) continue;
            compared++;
            const dsnName = typeof dsnPin === "string" ? undefined : dsnPin.name;
            if (dsnName !== goldenName && mismatches.length < 8) {
              mismatches.push(`${refdes}.${pinNumber}: dat="${goldenName}" dsn="${dsnName ?? "<none>"}"`);
            }
          }
        }

        console.log(`[${projectName}] Pin names: compared=${compared} mismatched=${mismatches.length}`);
        expect(mismatches).toEqual([]);
      });

      /**
       * Do Not Stuff reaches a design by two roads that meet nowhere else: a
       * marker written into a part's value, and the CIS variant store in the
       * schematic. The DAT export carries the first and not the second, a `.DSN`
       * read on its own carries the second and, until the marker was read out of
       * the value it was being cleaned from, not the first. Whichever path a
       * query takes, it is the same board, so the answer has to be the same:
       * the two disagreed on 65 parts across three designs before this ran.
       */
      it.runIf(isOracle)("should mark the same components Do Not Stuff as the DAT export", () => {
        const dsn = parseOnce(designFile);
        const disagreements: string[] = [];
        let compared = 0;

        for (const [refdes, goldenComp] of Object.entries(golden.components)) {
          const dsnComp = dsn.components[refdes];
          if (!dsnComp) continue;
          compared++;
          const fromDat = goldenComp.dns === true;
          const fromDsn = dsnComp.dns === true;
          if (fromDat !== fromDsn && disagreements.length < 8) {
            disagreements.push(`${refdes}: dat=${fromDat} dsn=${fromDsn}`);
          }
        }

        console.log(`[${projectName}] DNS: compared=${compared} disagreed=${disagreements.length}`);
        expect(disagreements).toEqual([]);
      });

      it("should have >50% net coverage", () => {
        const dsn = parseOnce(designFile);
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
        const dsn = parseOnce(designFile);
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
