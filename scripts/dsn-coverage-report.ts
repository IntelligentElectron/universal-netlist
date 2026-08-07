/**
 * DSN Coverage Report (dev script)
 *
 * Compares DSN parser output against DAT golden files for all Cadence fixtures.
 *
 * Usage:
 *   node --import tsx scripts/dsn-coverage-report.ts                    # All fixtures (summary)
 *   node --import tsx scripts/dsn-coverage-report.ts BEAGLEBONEBLK_C3   # Single fixture (verbose)
 */

import fs from "fs";
import path from "path";
import { parseDsnFile } from "../src/parsers/cadence/dsn/dsn-parser.js";
import { findCadenceDatFiles } from "../src/parsers/cadence/discovery.js";
import {
  analyzeCoverage,
  formatCoverageReport,
  type CoverageResult,
} from "../src/dsn-vs-dat-coverage.js";
import type { ParsedNetlist } from "../src/types.js";

const fixturesDir = "test/fixtures/cadence";
const goldenDir = "test/golden/cadence";

function findDsnFiles(dir: string): string[] {
  const results: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) results.push(...findDsnFiles(full));
    else if (item.name.toLowerCase().endsWith(".dsn")) results.push(full);
  }
  return results;
}

const filterName = process.argv[2];
const verbose = !!filterName;

const dsnFiles = findDsnFiles(fixturesDir);
const results: CoverageResult[] = [];
const selfSnapshots: string[] = [];

for (const dsnFile of dsnFiles) {
  const projectName = path.basename(dsnFile, path.extname(dsnFile));
  const goldenFile = path.join(goldenDir, `${projectName}.json`);

  if (filterName && !projectName.includes(filterName)) continue;
  if (!fs.existsSync(goldenFile)) continue;

  // gen-golden parses pstxnet.dat when one sits beside the design, and falls
  // back to the .DSN when none does. A golden of the second kind is our own
  // output, so measuring against it reports agreement with ourselves. Say so
  // rather than let a stale snapshot read as a Cadence reference.
  const datFiles = await findCadenceDatFiles(dsnFile);
  if (!datFiles.pstxnet) selfSnapshots.push(projectName);

  try {
    const golden: ParsedNetlist = JSON.parse(fs.readFileSync(goldenFile, "utf-8"));
    const dsn = parseDsnFile(dsnFile);
    results.push(analyzeCoverage(projectName, dsn, golden));
  } catch (e: unknown) {
    console.error(`ERROR parsing ${projectName}: ${e instanceof Error ? e.message : e}`);
  }
}

console.log(formatCoverageReport(results, { verbose }));

if (selfSnapshots.length > 0) {
  console.log(
    `\nNOT MEASURED AGAINST CADENCE: ${selfSnapshots.join(", ")}\n` +
      `  No pstxnet.dat beside the design, so the golden is a snapshot of this\n` +
      `  parser's own output. Its numbers say the parser is self-consistent,\n` +
      `  not that it is correct.`
  );
}
