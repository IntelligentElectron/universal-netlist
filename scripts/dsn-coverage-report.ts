/**
 * DSN Coverage Report
 *
 * Compares DSN parser output against DAT golden files for all Cadence fixtures.
 * Reports net and component coverage, missing/extra nets, and categorizes gaps.
 *
 * Usage:
 *   npx tsx scripts/dsn-coverage-report.ts                    # All fixtures
 *   npx tsx scripts/dsn-coverage-report.ts BEAGLEBONEBLK_C3   # Single fixture (verbose)
 */

import fs from "fs";
import path from "path";
import { parseDsnFile } from "../src/parsers/cadence/dsn/dsn-parser.js";
import type { ParsedNetlist } from "../src/types.js";

const fixturesDir = "test/fixtures/cadence";
const goldenDir = "test/golden/cadence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findDsnFiles(dir: string): string[] {
  const results: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) results.push(...findDsnFiles(full));
    else if (item.name.toLowerCase().endsWith(".dsn")) results.push(full);
  }
  return results;
}

function categorizeNet(name: string): string {
  if (name === "NC") return "no-connect";
  if (/^N\d+$/.test(name)) return "auto-generated";
  if (/\[.*\.\.]/.test(name)) return "bus-range";
  return "named";
}

interface CoverageResult {
  projectName: string;
  goldenNetCount: number;
  dsnNetCount: number;
  commonNets: number;
  netCoverage: number;
  goldenCompCount: number;
  dsnCompCount: number;
  commonComps: number;
  compCoverage: number;
  missingNets: { name: string; category: string; connections: Record<string, unknown> }[];
  extraNets: { name: string; category: string }[];
}

function analyze(dsnPath: string, goldenPath: string): CoverageResult {
  const projectName = path.basename(dsnPath, path.extname(dsnPath));
  const golden: ParsedNetlist = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));
  const dsn = parseDsnFile(dsnPath);

  const goldenNets = new Set(Object.keys(golden.nets));
  const dsnNets = new Set(Object.keys(dsn.nets));
  const commonNets = [...dsnNets].filter((n) => goldenNets.has(n));

  const goldenComps = new Set(Object.keys(golden.components));
  const dsnComps = new Set(Object.keys(dsn.components));
  const commonComps = [...dsnComps].filter((c) => goldenComps.has(c));

  const missingNets = [...goldenNets]
    .filter((n) => !dsnNets.has(n))
    .map((name) => ({
      name,
      category: categorizeNet(name),
      connections: golden.nets[name],
    }));

  const extraNets = [...dsnNets]
    .filter((n) => !goldenNets.has(n))
    .map((name) => ({ name, category: categorizeNet(name) }));

  return {
    projectName,
    goldenNetCount: goldenNets.size,
    dsnNetCount: dsnNets.size,
    commonNets: commonNets.length,
    netCoverage: goldenNets.size > 0 ? commonNets.length / goldenNets.size : 1,
    goldenCompCount: goldenComps.size,
    dsnCompCount: dsnComps.size,
    commonComps: commonComps.length,
    compCoverage: goldenComps.size > 0 ? commonComps.length / goldenComps.size : 1,
    missingNets,
    extraNets,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const filterName = process.argv[2];
const verbose = !!filterName;

const dsnFiles = findDsnFiles(fixturesDir);
const results: CoverageResult[] = [];

for (const dsnFile of dsnFiles) {
  const projectName = path.basename(dsnFile, path.extname(dsnFile));
  const goldenFile = path.join(goldenDir, `${projectName}.json`);

  if (filterName && !projectName.includes(filterName)) continue;
  if (!fs.existsSync(goldenFile)) continue;

  try {
    results.push(analyze(dsnFile, goldenFile));
  } catch (e: unknown) {
    console.error(`ERROR parsing ${projectName}: ${e instanceof Error ? e.message : e}`);
  }
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

console.log("\n=== DSN vs DAT Golden Coverage Report ===\n");
console.log(
  "Design".padEnd(50) +
    "Nets (golden/dsn/common)".padEnd(28) +
    "Net%".padEnd(8) +
    "Comps (golden/dsn/common)".padEnd(28) +
    "Comp%"
);
console.log("-".repeat(122));

for (const r of results) {
  const netCol = `${r.goldenNetCount}/${r.dsnNetCount}/${r.commonNets}`;
  const compCol = `${r.goldenCompCount}/${r.dsnCompCount}/${r.commonComps}`;
  console.log(
    `${r.projectName.padEnd(50)}${netCol.padEnd(28)}${(r.netCoverage * 100).toFixed(1).padStart(5)}%  ${compCol.padEnd(28)}${(r.compCoverage * 100).toFixed(1).padStart(5)}%`
  );
}

// ---------------------------------------------------------------------------
// Detailed per-design breakdown (verbose mode or single fixture)
// ---------------------------------------------------------------------------

if (verbose) {
  for (const r of results) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`${r.projectName}`);
    console.log(`${"=".repeat(80)}`);

    if (r.missingNets.length > 0) {
      // Group missing nets by category
      const byCategory = new Map<string, typeof r.missingNets>();
      for (const net of r.missingNets) {
        if (!byCategory.has(net.category)) byCategory.set(net.category, []);
        byCategory.get(net.category)!.push(net);
      }

      console.log(`\nMissing nets (${r.missingNets.length}):`);
      for (const [category, nets] of byCategory) {
        console.log(`\n  [${category}] (${nets.length}):`);
        for (const net of nets) {
          const refdesCount = Object.keys(net.connections).length;
          const refdesStr = Object.keys(net.connections).join(", ");
          console.log(`    ${net.name} -> ${refdesCount} components: ${refdesStr}`);
        }
      }
    }

    if (r.extraNets.length > 0) {
      const byCategory = new Map<string, typeof r.extraNets>();
      for (const net of r.extraNets) {
        if (!byCategory.has(net.category)) byCategory.set(net.category, []);
        byCategory.get(net.category)!.push(net);
      }

      console.log(`\nExtra nets (${r.extraNets.length}):`);
      for (const [category, nets] of byCategory) {
        console.log(`\n  [${category}] (${nets.length}):`);
        for (const net of nets.slice(0, 20)) {
          console.log(`    ${net.name}`);
        }
        if (nets.length > 20) console.log(`    ... and ${nets.length - 20} more`);
      }
    }

    if (r.missingNets.length === 0 && r.extraNets.length === 0) {
      console.log("\n  Perfect parity!");
    }
  }
}

// ---------------------------------------------------------------------------
// Aggregate stats
// ---------------------------------------------------------------------------

if (results.length > 1) {
  const totalGoldenNets = results.reduce((s, r) => s + r.goldenNetCount, 0);
  const totalCommonNets = results.reduce((s, r) => s + r.commonNets, 0);
  const totalMissing = results.reduce((s, r) => s + r.missingNets.length, 0);
  const totalExtra = results.reduce((s, r) => s + r.extraNets.length, 0);

  // Category breakdown across all fixtures
  const allMissing = results.flatMap((r) => r.missingNets);
  const missingByCategory = new Map<string, number>();
  for (const net of allMissing) {
    missingByCategory.set(net.category, (missingByCategory.get(net.category) || 0) + 1);
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("AGGREGATE");
  console.log(`${"=".repeat(80)}`);
  console.log(`Total golden nets: ${totalGoldenNets}`);
  console.log(
    `Total common nets: ${totalCommonNets} (${((totalCommonNets / totalGoldenNets) * 100).toFixed(1)}%)`
  );
  console.log(`Total missing: ${totalMissing}`);
  console.log(`Total extra: ${totalExtra}`);
  console.log(`\nMissing by category:`);
  for (const [cat, count] of [...missingByCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
}
