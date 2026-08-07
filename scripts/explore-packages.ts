/**
 * Explore Package streams in DSN files to validate parsing approach.
 *
 * Usage: node --import tsx scripts/explore-packages.ts
 */

import fs from "fs";
import path from "path";
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";
import { skipStructure } from "../src/parsers/cadence/dsn/generic-parser.js";
import { parsePackage } from "../src/parsers/cadence/dsn/structures.js";

function findDsnFiles(dir: string): string[] {
  const results: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) results.push(...findDsnFiles(full));
    else if (item.name.toLowerCase().endsWith(".dsn")) results.push(full);
  }
  return results;
}

function parsePackageStream(buf: Buffer) {
  const reader = new BinaryReader(buf);
  const lenPartCells = reader.readUint16();
  for (let i = 0; i < lenPartCells; i++) {
    skipStructure(reader); // PartCell
    const lenLibraryParts = reader.readUint16();
    for (let j = 0; j < lenLibraryParts; j++) {
      skipStructure(reader); // LibraryPart
    }
  }
  return parsePackage(reader);
}

const dsnFiles = findDsnFiles("test/fixtures/cadence");

for (const dsn of dsnFiles) {
  const ole = new OleReader(dsn);
  const entries = ole.listAllEntries();
  const pkgEntries = entries.filter((e) => e.path.startsWith("Packages/") && e.entry.type === 2);

  if (pkgEntries.length === 0) {
    console.log(`\n${path.basename(dsn)} - No Package streams`);
    continue;
  }

  console.log(`\n${path.basename(dsn)} - ${pkgEntries.length} Package streams`);

  let parsed = 0;
  let failed = 0;
  for (const pe of pkgEntries) {
    try {
      const buf = ole.readStreamByPath(pe.path);
      const pkg = parsePackageStream(buf);
      parsed++;

      // Show first 3 per file
      if (parsed <= 3) {
        console.log(`  ${pe.path}:`);
        console.log(`    name=${pkg.name} refDes=${pkg.refDes} footprint=${pkg.pcbFootprint}`);
        for (const d of pkg.devices) {
          const pinSample = d.pinMap
            .map((p, i) => (p !== null ? `${i + 1}:${p}` : null))
            .filter(Boolean)
            .slice(0, 8);
          console.log(
            `    device: unitRef=${d.unitRef} refDes=${d.refDes} pins(${d.pinMap.length}): [${pinSample.join(", ")}${d.pinMap.length > 8 ? ", ..." : ""}]`
          );
        }
      }
    } catch (e) {
      failed++;
      if (failed <= 3) {
        console.log(`  FAILED ${pe.path}: ${(e as Error).message}`);
      }
    }
  }
  console.log(`  Summary: ${parsed}/${pkgEntries.length} parsed, ${failed} failed`);
}

// Also explore the Library stream for CIS cache
console.log("\n\n=== Library Stream Exploration ===");
for (const dsn of dsnFiles.slice(0, 3)) {
  const ole = new OleReader(dsn);
  const entries = ole.listAllEntries();
  const libEntry = entries.find((e) => e.path === "Library");
  if (!libEntry) continue;

  const buf = ole.readStreamByPath("Library");
  console.log(`\n${path.basename(dsn)} - Library stream: ${buf.length} bytes`);

  // Look for readable strings that look like component properties
  // Search for known value patterns
  const text = buf.toString("latin1");
  const valuePatterns = ["4.87k", "100nF", "10uF", "0.1uF", "RESC", "CAPC", "Value"];
  for (const pat of valuePatterns) {
    const idx = text.indexOf(pat);
    if (idx !== -1) {
      // Show surrounding context
      const start = Math.max(0, idx - 30);
      const end = Math.min(text.length, idx + pat.length + 30);
      const context = [...text.substring(start, end)]
        .map((ch) => (ch.charCodeAt(0) < 0x20 ? "." : ch))
        .join("");
      console.log(`  Found "${pat}" at offset ${idx}: ...${context}...`);
    }
  }
}
