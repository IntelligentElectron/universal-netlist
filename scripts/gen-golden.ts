#!/usr/bin/env npx tsx
import path from "node:path";
import { parseDesign } from "../src/parsers/index.js";
import { findCadenceDatFiles } from "../src/parsers/cadence/discovery.js";
import { listAllFixtures, findDesignFiles, saveGolden, type Format } from "../test/utils.js";

/**
 * Resolve the parse path for golden generation.
 * For .dsn files with available DAT exports, uses pstxnet.dat (richer data).
 */
const resolveGoldenParsePath = async (designFile: string): Promise<string> => {
  const ext = path.extname(designFile).toLowerCase();
  if (ext === ".dsn") {
    const datFiles = await findCadenceDatFiles(designFile);
    if (datFiles.pstxnet) return datFiles.pstxnet;
  }
  return designFile;
};

/**
 * Generate golden for a single design.
 */
const generateOne = async (format: Format, name: string, designPath: string): Promise<void> => {
  const parsePath = await resolveGoldenParsePath(designPath);
  console.log(`Parsing: ${format}/${name}`);
  const result = await parseDesign(parsePath);
  console.log(
    `  Components: ${Object.keys(result.components).length}, Nets: ${Object.keys(result.nets).length}`
  );
  await saveGolden(format, name, result);
  console.log(`  Saved: test/golden/${format}/${name}.json`);
};

/**
 * Regenerate all golden files from discovered fixtures.
 */
const generateAll = async (): Promise<void> => {
  const fixtures = await listAllFixtures();
  let count = 0;

  for (const fixture of fixtures) {
    const designFiles = await findDesignFiles(fixture);

    for (const designFile of designFiles) {
      const baseName = path.basename(designFile);
      const projectName =
        baseName.toLowerCase() === "pstxnet.dat"
          ? fixture.name
          : path.basename(designFile, path.extname(designFile));

      await generateOne(fixture.format, projectName, designFile);
      count++;
    }
  }

  console.log(`\nRegenerated ${count} golden files.`);
};

// CLI dispatch
const args = process.argv.slice(2);

if (args[0] === "--all") {
  await generateAll();
} else {
  const [format, name, designPath] = args;

  if (!format || !name || !designPath) {
    console.error("Usage:");
    console.error("  npx tsx scripts/gen-golden.ts <format> <name> <path>");
    console.error("  npx tsx scripts/gen-golden.ts --all");
    process.exit(1);
  }

  await generateOne(format as Format, name, designPath);
}
