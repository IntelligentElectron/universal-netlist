/**
 * Verify pin number resolution from Package streams.
 * Compare DSN parser output pin numbers against DAT golden for components
 * that have Package stream data (non-sequential pin numbering).
 */
import fs from "fs";
import path from "path";
import { parseDsnFile } from "../src/parsers/cadence/dsn/dsn-parser.js";
import type { ParsedNetlist, PinEntry } from "../src/types.js";

const goldenDir = "test/golden/cadence";

function getPinNet(entry: PinEntry): string {
  return typeof entry === "string" ? entry : entry.net;
}

function findDsnFiles(dir: string): string[] {
  const results: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) results.push(...findDsnFiles(full));
    else if (item.name.toLowerCase().endsWith(".dsn")) results.push(full);
  }
  return results;
}

const dsnFiles = findDsnFiles("test/fixtures/cadence");

for (const dsnPath of dsnFiles) {
  const projectName = path.basename(dsnPath, path.extname(dsnPath));
  const goldenPath = path.join(goldenDir, `${projectName}.json`);
  if (!fs.existsSync(goldenPath)) continue;

  const dsn = parseDsnFile(dsnPath);
  const golden: ParsedNetlist = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));

  // Compare pin numbers for shared components
  let totalPins = 0;
  let matchingPins = 0;
  const mismatchExamples: string[] = [];

  for (const refdes of Object.keys(golden.components)) {
    const gc = golden.components[refdes];
    const dc = dsn.components[refdes];
    if (!dc) continue;

    const goldenPinNumbers = new Set(Object.keys(gc.pins));
    const dsnPinNumbers = new Set(Object.keys(dc.pins));

    for (const pin of goldenPinNumbers) {
      totalPins++;
      if (dsnPinNumbers.has(pin)) {
        matchingPins++;
      } else if (mismatchExamples.length < 5) {
        const goldenNet = getPinNet(gc.pins[pin]);
        mismatchExamples.push(
          `  ${refdes}.${pin} golden_net=${goldenNet} dsn_pins=[${[...dsnPinNumbers].join(",")}]`
        );
      }
    }
  }

  const pct = totalPins > 0 ? ((matchingPins / totalPins) * 100).toFixed(1) : "N/A";
  console.log(`${projectName}: ${matchingPins}/${totalPins} pin numbers match (${pct}%)`);
  if (mismatchExamples.length > 0) {
    console.log("  Mismatches:");
    for (const ex of mismatchExamples) console.log(ex);
  }
}
