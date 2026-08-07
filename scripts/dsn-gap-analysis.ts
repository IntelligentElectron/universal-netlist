/**
 * DSN Gap Analysis
 *
 * Deep-dive into gaps between DSN parser output and DAT golden files for a
 * single Cadence fixture. Categorizes every missing and extra net, maps extra
 * nets to their likely golden counterpart, and identifies schematic-to-PCB
 * net renames.
 *
 * Usage:
 *   node --import tsx scripts/dsn-gap-analysis.ts <golden-name>
 *
 * Example:
 *   node --import tsx scripts/dsn-gap-analysis.ts BEAGLEBONEBLK_C3
 *   node --import tsx scripts/dsn-gap-analysis.ts reServer_industrial_J401_Carrier_Board_v11
 */

import fs from "fs";
import path from "path";
import { parseDsnFile } from "../src/parsers/cadence/dsn/dsn-parser.js";
import type { ParsedNetlist } from "../src/types.js";

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
  return "named";
}

// ---------------------------------------------------------------------------
// Locate fixture
// ---------------------------------------------------------------------------

const fixturesDir = "test/fixtures/cadence";
const goldenDir = "test/golden/cadence";

const filterName = process.argv[2];
if (!filterName) {
  console.error("Usage: node --import tsx scripts/dsn-gap-analysis.ts <golden-name>");
  console.error("\nAvailable golden files:");
  for (const f of fs
    .readdirSync(goldenDir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    console.error(`  ${path.basename(f, ".json")}`);
  }
  process.exit(1);
}

const goldenPath = path.join(goldenDir, `${filterName}.json`);
if (!fs.existsSync(goldenPath)) {
  console.error(`Golden file not found: ${goldenPath}`);
  process.exit(1);
}

const dsnFiles = findDsnFiles(fixturesDir);
const dsnPath = dsnFiles.find((f) => path.basename(f, path.extname(f)) === filterName);
if (!dsnPath) {
  console.error(`DSN file not found for: ${filterName}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const golden: ParsedNetlist = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));
const dsn = parseDsnFile(dsnPath);

const goldenNets = new Set(Object.keys(golden.nets));
const dsnNets = new Set(Object.keys(dsn.nets));

const commonNets = [...dsnNets].filter((n) => goldenNets.has(n));
const extraNets = [...dsnNets].filter((n) => !goldenNets.has(n));
const missingNets = [...goldenNets].filter((n) => !dsnNets.has(n));

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

console.log(`\n=== DSN Gap Analysis: ${filterName} ===\n`);
console.log(`Golden nets: ${goldenNets.size}`);
console.log(`DSN nets:    ${dsnNets.size}`);
console.log(
  `Common:      ${commonNets.length} (${((commonNets.length / goldenNets.size) * 100).toFixed(1)}%)`
);
console.log(`Missing:     ${missingNets.length}`);
console.log(`Extra:       ${extraNets.length}`);

// ---------------------------------------------------------------------------
// Refdes accuracy on common nets
// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(70)}`);
console.log("REFDES ACCURACY ON COMMON NETS");
console.log(`${"=".repeat(70)}\n`);

let perfectRefdesMatch = 0;
let partialMatch = 0;
const refdesMismatches: string[] = [];

for (const netName of commonNets) {
  const goldenRefs = new Set(Object.keys(golden.nets[netName]));
  const dsnRefs = new Set(Object.keys(dsn.nets[netName]));

  const common = [...goldenRefs].filter((r) => dsnRefs.has(r));
  const missingRefs = [...goldenRefs].filter((r) => !dsnRefs.has(r));
  const extraRefs = [...dsnRefs].filter((r) => !goldenRefs.has(r));

  if (missingRefs.length === 0 && extraRefs.length === 0) {
    perfectRefdesMatch++;
  } else {
    partialMatch++;
    refdesMismatches.push(
      `  ${netName}: golden=${goldenRefs.size} dsn=${dsnRefs.size} common=${common.length}` +
        (missingRefs.length > 0 ? ` missing=[${missingRefs.join(",")}]` : "") +
        (extraRefs.length > 0 ? ` extra=[${extraRefs.join(",")}]` : "")
    );
  }
}

console.log(`Perfect refdes match: ${perfectRefdesMatch}/${commonNets.length}`);
console.log(`Partial match: ${partialMatch}/${commonNets.length}`);
if (refdesMismatches.length > 0) {
  console.log("\nNets with refdes mismatches:");
  for (const m of refdesMismatches) console.log(m);
}

// ---------------------------------------------------------------------------
// Missing nets breakdown
// ---------------------------------------------------------------------------

if (missingNets.length > 0) {
  console.log(`\n${"=".repeat(70)}`);
  console.log("MISSING NETS (in golden, not in DSN)");
  console.log(`${"=".repeat(70)}\n`);

  const byCategory = new Map<string, string[]>();
  for (const name of missingNets) {
    const cat = categorizeNet(name);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(name);
  }

  for (const [category, nets] of byCategory) {
    console.log(`[${category}] (${nets.length}):`);
    for (const name of nets) {
      const conns = golden.nets[name];
      const refs = Object.keys(conns);
      console.log(
        `  ${name} -> ${refs.length} components: ${refs.slice(0, 10).join(", ")}${refs.length > 10 ? "..." : ""}`
      );
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Extra net -> golden net mapping
// ---------------------------------------------------------------------------

if (extraNets.length > 0) {
  console.log(`${"=".repeat(70)}`);
  console.log("EXTRA NETS (in DSN, not in golden) -> LIKELY GOLDEN MATCH");
  console.log(`${"=".repeat(70)}\n`);

  for (const extraNet of extraNets) {
    const dsnConns = dsn.nets[extraNet];
    const dsnRefs = Object.keys(dsnConns);

    // Find golden nets that contain ALL the same refdes
    const candidates: string[] = [];
    for (const [gNet, gConns] of Object.entries(golden.nets) as [
      string,
      Record<string, string[]>,
    ][]) {
      const gRefs = new Set(Object.keys(gConns));
      if (dsnRefs.length > 0 && dsnRefs.every((r) => gRefs.has(r))) {
        candidates.push(gNet);
      }
    }

    const cat = categorizeNet(extraNet);
    const refs = dsnRefs.slice(0, 5).join(", ");

    if (candidates.length === 1) {
      console.log(
        `  [${cat}] ${extraNet} -> ${candidates[0]} (unique superset match) | refs: ${refs}`
      );
    } else if (candidates.length > 1) {
      let best = "";
      let bestSim = 0;
      for (const c of candidates) {
        const gRefs = new Set(Object.keys(golden.nets[c]));
        const intersection = dsnRefs.filter((r) => gRefs.has(r)).length;
        const union = new Set([...dsnRefs, ...gRefs]).size;
        const sim = intersection / union;
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      console.log(
        `  [${cat}] ${extraNet} -> ${best} (best of ${candidates.length}, sim=${bestSim.toFixed(2)}) | refs: ${refs}`
      );
    } else {
      console.log(`  [${cat}] ${extraNet} -> NO MATCH | refs: ${refs}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Schematic vs PCB net renames
// ---------------------------------------------------------------------------

const namedExtra = extraNets.filter((n) => !/^N\d+$/.test(n));
if (namedExtra.length > 0) {
  console.log(`\n${"=".repeat(70)}`);
  console.log("SCHEMATIC vs PCB NET RENAMES");
  console.log(`${"=".repeat(70)}\n`);

  for (const extraNet of namedExtra) {
    const dsnConns = dsn.nets[extraNet];
    const dsnRefs = new Set(Object.keys(dsnConns));

    let bestNet = "";
    let bestOverlap = 0;
    for (const [gNet, gConns] of Object.entries(golden.nets) as [
      string,
      Record<string, string[]>,
    ][]) {
      const overlap = Object.keys(gConns).filter((r) => dsnRefs.has(r)).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestNet = gNet;
      }
    }
    if (bestNet && bestOverlap > 0) {
      console.log(
        `  Schematic: "${extraNet}" -> PCB/DAT: "${bestNet}" (${bestOverlap} shared refs)`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Stolen refs: where did missing refdes end up?
// ---------------------------------------------------------------------------

const partialGoldenNets = commonNets.filter((n) => {
  const goldenRefs = Object.keys(golden.nets[n]);
  const dsnRefs = new Set(Object.keys(dsn.nets[n]));
  return goldenRefs.some((r) => !dsnRefs.has(r));
});

if (partialGoldenNets.length > 0) {
  console.log(`\n${"=".repeat(70)}`);
  console.log("STOLEN REFS (golden net missing a refdes, found in an extra DSN net)");
  console.log(`${"=".repeat(70)}\n`);

  for (const netName of partialGoldenNets) {
    const goldenRefs = Object.keys(golden.nets[netName]);
    const dsnRefs = new Set(Object.keys(dsn.nets[netName]));
    const missingRefs = goldenRefs.filter((r) => !dsnRefs.has(r));

    for (const ref of missingRefs) {
      const stolenTo: string[] = [];
      for (const extraNet of extraNets) {
        if (dsn.nets[extraNet][ref]) {
          stolenTo.push(extraNet);
        }
      }
      if (stolenTo.length > 0) {
        console.log(`  ${netName} missing ${ref} -> found in extra: ${stolenTo.join(", ")}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(70)}`);
console.log("SUMMARY");
console.log(`${"=".repeat(70)}\n`);

const missingByCategory = new Map<string, number>();
for (const n of missingNets) {
  const cat = categorizeNet(n);
  missingByCategory.set(cat, (missingByCategory.get(cat) || 0) + 1);
}
const extraByCategory = new Map<string, number>();
for (const n of extraNets) {
  const cat = categorizeNet(n);
  extraByCategory.set(cat, (extraByCategory.get(cat) || 0) + 1);
}

console.log(
  `Coverage: ${((commonNets.length / goldenNets.size) * 100).toFixed(1)}% (${commonNets.length}/${goldenNets.size})`
);
console.log(`\nMissing by category:`);
for (const [cat, count] of [...missingByCategory.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count}`);
}
console.log(`\nExtra by category:`);
for (const [cat, count] of [...extraByCategory.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count}`);
}
