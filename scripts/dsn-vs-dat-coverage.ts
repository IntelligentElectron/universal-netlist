/**
 * DSN vs DAT Coverage (dev script)
 *
 * Compares DSN parser output against DAT netlist exports for every Cadence design under a
 * directory that has both, and writes a markdown report to the working directory. On
 * Windows, a design without exports gets them from the Cadence exporter first.
 *
 * Usage:
 *   node --import tsx scripts/dsn-vs-dat-coverage.ts [path] [--verbose]
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDsnFile, parseCadence, buildCadencePinMap } from "../src/parsers/cadence/index.js";
import { discoverCadenceDesignsWithDat } from "../src/parsers/cadence/discovery.js";
import { exportCadenceNetlist } from "../src/service/index.js";
import { isErrorResult } from "../src/types.js";
import {
  analyzeCoverage,
  formatCoverageReport,
  type CoverageResult,
} from "./lib/dsn-vs-dat-coverage.js";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const resolvedPath = resolve(args.find((arg) => !arg.startsWith("--")) ?? ".");

const designs = await discoverCadenceDesignsWithDat(resolvedPath);
const dsnDesigns = designs.filter((d) => d.format === "cadence-cis");

if (dsnDesigns.length === 0) {
  console.error(`No Cadence .DSN files found in ${resolvedPath}`);
  process.exit(1);
}

console.error("");
console.error(`Found ${dsnDesigns.length} DSN design(s) in ${resolvedPath}`);

const results: CoverageResult[] = [];

for (const design of dsnDesigns) {
  let { datFiles } = design;

  // On Windows, attempt export if .dat files are missing
  if (!datFiles.pstxnet && process.platform === "win32") {
    console.error(`Exporting netlist for ${design.name}...`);
    const exportResult = await exportCadenceNetlist(design.sourcePath);
    if (isErrorResult(exportResult)) {
      console.error(`  Export failed: ${exportResult.error}`);
    } else {
      // The export already reports the directory it wrote, and it has verified
      // all three files came from this run. Re-deriving the location instead
      // could land on a different directory than the one just written.
      datFiles = {
        pstxnet: join(exportResult.outputDir, "pstxnet.dat"),
        pstxprt: join(exportResult.outputDir, "pstxprt.dat"),
        pstchip: join(exportResult.outputDir, "pstchip.dat"),
      };
    }
  }

  if (!datFiles.pstxnet || !datFiles.pstxprt) {
    console.error(`Skipping ${design.name}: no .dat files found`);
    continue;
  }

  try {
    console.error(`  Analyzing ${design.name}...`);
    const dsn = parseDsnFile(design.sourcePath);
    const raw = await parseCadence({
      pstxnetPath: datFiles.pstxnet,
      pstxprtPath: datFiles.pstxprt,
      pstchipPath: datFiles.pstchip ?? undefined,
    });
    const datComponents = buildCadencePinMap(raw.nets, raw.components, raw.chips, raw.partNames);
    const dat = { nets: raw.nets, components: datComponents };

    results.push(analyzeCoverage(design.name, dsn, dat));
  } catch (e: unknown) {
    console.error(`ERROR parsing ${design.name}: ${e instanceof Error ? e.message : e}`);
  }
}

if (results.length === 0) {
  console.error("No designs could be analyzed (all skipped or errored)");
  process.exit(1);
}

// Terminal output: plain text, truncated verbose sections
console.log(formatCoverageReport(results, { verbose }));

// File output: markdown with full verbose (no truncation) when verbose is enabled
const fileReport = formatCoverageReport(results, { verbose, truncate: false, markdown: true });
const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const outFile = resolve(`dsn-vs-dat-coverage-${ts}.md`);
writeFileSync(outFile, fileReport + "\n");
console.error(`\nExported to:\n${outFile}`);
