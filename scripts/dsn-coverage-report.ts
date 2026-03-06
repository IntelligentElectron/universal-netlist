/**
 * DSN Coverage Report
 *
 * Compares DSN parser output against DAT golden files for all Cadence fixtures.
 * Reports net/component coverage, field-level parity (Value, PinNum, PinName, MPN),
 * and categorizes gaps.
 *
 * Usage:
 *   npx tsx scripts/dsn-coverage-report.ts                    # All fixtures (summary)
 *   npx tsx scripts/dsn-coverage-report.ts BEAGLEBONEBLK_C3   # Single fixture (verbose)
 */

import fs from "fs";
import path from "path";
import { parseDsnFile } from "../src/parsers/cadence/dsn/dsn-parser.js";
import type { ParsedNetlist, PinEntry } from "../src/types.js";

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

const getPinName = (entry: PinEntry): string | undefined =>
  typeof entry === "string" ? undefined : entry.name;

const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + "%" : "N/A");

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

interface FieldStats {
  match: number;
  total: number;
  hasDsn: number;
  mismatches: string[];
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
  mpn: FieldStats;
  value: FieldStats;
  pinNum: FieldStats;
  pinName: FieldStats;
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
  const commonCompKeys = [...dsnComps].filter((c) => goldenComps.has(c));

  const missingNets = [...goldenNets]
    .filter((n) => !dsnNets.has(n))
    .map((name) => ({ name, category: categorizeNet(name), connections: golden.nets[name] }));

  const extraNets = [...dsnNets]
    .filter((n) => !goldenNets.has(n))
    .map((name) => ({ name, category: categorizeNet(name) }));

  // Field-level stats
  const mpn: FieldStats = { match: 0, total: 0, hasDsn: 0, mismatches: [] };
  const value: FieldStats = { match: 0, total: 0, hasDsn: 0, mismatches: [] };
  const pinNum: FieldStats = { match: 0, total: 0, hasDsn: 0, mismatches: [] };
  const pinName: FieldStats = { match: 0, total: 0, hasDsn: 0, mismatches: [] };

  for (const ref of commonCompKeys) {
    const gc = golden.components[ref];
    const dc = dsn.components[ref];

    if (gc.mpn) {
      mpn.total++;
      if (dc.mpn) mpn.hasDsn++;
      if (dc.mpn === gc.mpn) mpn.match++;
      else if (dc.mpn) mpn.mismatches.push(`${ref}: golden="${gc.mpn}" dsn="${dc.mpn}"`);
    }

    if (gc.value) {
      value.total++;
      if (dc.value) value.hasDsn++;
      if (dc.value === gc.value) value.match++;
      else if (dc.value) value.mismatches.push(`${ref}: golden="${gc.value}" dsn="${dc.value}"`);
    }

    const goldenPins = gc.pins || {};
    const dsnPins = dc.pins || {};
    for (const pin of Object.keys(goldenPins)) {
      const gp = goldenPins[pin];
      const dp = dsnPins[pin];

      pinNum.total++;
      if (dp) pinNum.match++;

      const gpName = getPinName(gp);
      const dpName = dp ? getPinName(dp) : undefined;
      if (gpName) {
        pinName.total++;
        if (dpName) pinName.hasDsn++;
        if (dpName === gpName) pinName.match++;
        else if (dpName)
          pinName.mismatches.push(`${ref}.${pin}: golden="${gpName}" dsn="${dpName}"`);
      }
    }
  }

  return {
    projectName,
    goldenNetCount: goldenNets.size,
    dsnNetCount: dsnNets.size,
    commonNets: commonNets.length,
    netCoverage: goldenNets.size > 0 ? commonNets.length / goldenNets.size : 1,
    goldenCompCount: goldenComps.size,
    dsnCompCount: dsnComps.size,
    commonComps: commonCompKeys.length,
    compCoverage: goldenComps.size > 0 ? commonCompKeys.length / goldenComps.size : 1,
    missingNets,
    extraNets,
    mpn,
    value,
    pinNum,
    pinName,
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
    "Nets".padEnd(8) +
    "Comps".padEnd(8) +
    "Value".padEnd(8) +
    "PinNum".padEnd(8) +
    "PinName".padEnd(8) +
    "MPN"
);
console.log("-".repeat(98));

for (const r of results) {
  console.log(
    r.projectName.padEnd(50) +
      pct(r.commonNets, r.goldenNetCount).padEnd(8) +
      pct(r.commonComps, r.goldenCompCount).padEnd(8) +
      pct(r.value.match, r.value.total).padEnd(8) +
      pct(r.pinNum.match, r.pinNum.total).padEnd(8) +
      pct(r.pinName.match, r.pinName.total).padEnd(8) +
      `${r.mpn.hasDsn}/${r.mpn.total}`
  );
}

// ---------------------------------------------------------------------------
// Detailed per-design breakdown (verbose mode)
// ---------------------------------------------------------------------------

if (verbose) {
  for (const r of results) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(r.projectName);
    console.log(`${"=".repeat(80)}`);

    console.log(`\nField coverage:`);
    console.log(
      `  Value:   ${r.value.match}/${r.value.total} exact (${pct(r.value.match, r.value.total)}), ${r.value.hasDsn} have DSN value`
    );
    console.log(
      `  PinNum:  ${r.pinNum.match}/${r.pinNum.total} (${pct(r.pinNum.match, r.pinNum.total)})`
    );
    console.log(
      `  PinName: ${r.pinName.match}/${r.pinName.total} exact (${pct(r.pinName.match, r.pinName.total)}), ${r.pinName.hasDsn} have DSN value`
    );
    console.log(
      `  MPN:     ${r.mpn.match}/${r.mpn.total} exact (${pct(r.mpn.match, r.mpn.total)}), ${r.mpn.hasDsn} have DSN value`
    );

    if (r.value.mismatches.length > 0) {
      console.log(`\n  Value mismatches (${r.value.mismatches.length}):`);
      for (const m of r.value.mismatches.slice(0, 10)) console.log(`    ${m}`);
      if (r.value.mismatches.length > 10)
        console.log(`    ... and ${r.value.mismatches.length - 10} more`);
    }

    if (r.pinName.mismatches.length > 0) {
      console.log(`\n  PinName mismatches (${r.pinName.mismatches.length}):`);
      for (const m of r.pinName.mismatches.slice(0, 10)) console.log(`    ${m}`);
      if (r.pinName.mismatches.length > 10)
        console.log(`    ... and ${r.pinName.mismatches.length - 10} more`);
    }

    if (r.mpn.mismatches.length > 0) {
      console.log(`\n  MPN mismatches (${r.mpn.mismatches.length}):`);
      for (const m of r.mpn.mismatches.slice(0, 10)) console.log(`    ${m}`);
      if (r.mpn.mismatches.length > 10)
        console.log(`    ... and ${r.mpn.mismatches.length - 10} more`);
    }

    if (r.missingNets.length > 0) {
      const byCategory = new Map<string, typeof r.missingNets>();
      for (const net of r.missingNets) {
        if (!byCategory.has(net.category)) byCategory.set(net.category, []);
        byCategory.get(net.category)!.push(net);
      }

      console.log(`\n  Missing nets (${r.missingNets.length}):`);
      for (const [category, nets] of byCategory) {
        console.log(`\n    [${category}] (${nets.length}):`);
        for (const net of nets) {
          const refdesStr = Object.keys(net.connections).join(", ");
          console.log(
            `      ${net.name} -> ${Object.keys(net.connections).length} components: ${refdesStr}`
          );
        }
      }
    }

    if (r.extraNets.length > 0) {
      const byCategory = new Map<string, typeof r.extraNets>();
      for (const net of r.extraNets) {
        if (!byCategory.has(net.category)) byCategory.set(net.category, []);
        byCategory.get(net.category)!.push(net);
      }

      console.log(`\n  Extra nets (${r.extraNets.length}):`);
      for (const [category, nets] of byCategory) {
        console.log(`\n    [${category}] (${nets.length}):`);
        for (const net of nets.slice(0, 20)) console.log(`      ${net.name}`);
        if (nets.length > 20) console.log(`      ... and ${nets.length - 20} more`);
      }
    }

    if (r.missingNets.length === 0 && r.extraNets.length === 0) {
      console.log("\n  Perfect net parity!");
    }
  }
}

// ---------------------------------------------------------------------------
// Aggregate stats
// ---------------------------------------------------------------------------

if (results.length > 1) {
  const sum = (fn: (r: CoverageResult) => number) => results.reduce((s, r) => s + fn(r), 0);

  console.log(`\n${"=".repeat(98)}`);
  console.log("AGGREGATE");
  console.log(`${"=".repeat(98)}`);
  console.log(
    `Nets:    ${sum((r) => r.commonNets)}/${sum((r) => r.goldenNetCount)} (${pct(
      sum((r) => r.commonNets),
      sum((r) => r.goldenNetCount)
    )})`
  );
  console.log(
    `Comps:   ${sum((r) => r.commonComps)}/${sum((r) => r.goldenCompCount)} (${pct(
      sum((r) => r.commonComps),
      sum((r) => r.goldenCompCount)
    )})`
  );
  console.log(
    `Value:   ${sum((r) => r.value.match)}/${sum((r) => r.value.total)} (${pct(
      sum((r) => r.value.match),
      sum((r) => r.value.total)
    )})`
  );
  console.log(
    `PinNum:  ${sum((r) => r.pinNum.match)}/${sum((r) => r.pinNum.total)} (${pct(
      sum((r) => r.pinNum.match),
      sum((r) => r.pinNum.total)
    )})`
  );
  console.log(
    `PinName: ${sum((r) => r.pinName.match)}/${sum((r) => r.pinName.total)} (${pct(
      sum((r) => r.pinName.match),
      sum((r) => r.pinName.total)
    )})`
  );
  console.log(
    `MPN:     ${sum((r) => r.mpn.hasDsn)}/${sum((r) => r.mpn.total)} have DSN value (${sum((r) => r.mpn.match)} exact match)`
  );

  const totalMissing = sum((r) => r.missingNets.length);
  const totalExtra = sum((r) => r.extraNets.length);
  if (totalMissing > 0 || totalExtra > 0) {
    console.log(`\nMissing nets: ${totalMissing}, Extra nets: ${totalExtra}`);
    const allMissing = results.flatMap((r) => r.missingNets);
    const missingByCategory = new Map<string, number>();
    for (const net of allMissing) {
      missingByCategory.set(net.category, (missingByCategory.get(net.category) || 0) + 1);
    }
    for (const [cat, count] of [...missingByCategory.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat}: ${count}`);
    }
  }
}
