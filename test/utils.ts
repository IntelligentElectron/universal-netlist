/**
 * Test utilities for golden reference testing.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ParsedNetlist } from "../src/types.js";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES_DIR = path.join(TEST_DIR, "fixtures");
const GOLDEN_DIR = path.join(TEST_DIR, "golden");

export type Format = "cadence" | "altium";

export interface Fixture {
  name: string;
  path: string;
  format: Format;
}

/**
 * List all fixture directories for a given format.
 * Returns an empty array if no fixtures exist.
 */
export const listFixtures = async (format: Format): Promise<Fixture[]> => {
  const formatDir = path.join(FIXTURES_DIR, format);

  try {
    const entries = await fs.readdir(formatDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(formatDir, entry.name),
        format,
      }));
  } catch {
    return [];
  }
};

/**
 * List all fixtures across all formats.
 */
export const listAllFixtures = async (): Promise<Fixture[]> => {
  const formats: Format[] = ["cadence", "altium"];
  const results = await Promise.all(formats.map(listFixtures));
  return results.flat();
};

/**
 * Load golden output JSON for a fixture.
 * Returns null if the golden file doesn't exist.
 */
export const loadGolden = async (
  format: Format,
  designName: string,
): Promise<ParsedNetlist | null> => {
  const goldenPath = path.join(GOLDEN_DIR, format, `${designName}.json`);

  try {
    const content = await fs.readFile(goldenPath, "utf-8");
    return JSON.parse(content) as ParsedNetlist;
  } catch {
    return null;
  }
};

/**
 * Save golden output JSON for a fixture.
 */
export const saveGolden = async (
  format: Format,
  designName: string,
  data: ParsedNetlist,
): Promise<void> => {
  const goldenDir = path.join(GOLDEN_DIR, format);
  await fs.mkdir(goldenDir, { recursive: true });

  const goldenPath = path.join(goldenDir, `${designName}.json`);
  await fs.writeFile(goldenPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
};

/**
 * Recursively find design files within a directory.
 */
const findDesignFilesRecursive = async (
  dir: string,
  extensions: string[],
): Promise<string[]> => {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDesignFilesRecursive(fullPath, extensions);
      results.push(...nested);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.some((e) => e.toLowerCase() === ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
};

/**
 * Find all design files within a fixture directory (recursively).
 * For Cadence: looks for .dsn or .cpm files
 * For Altium: looks for .PrjPcb files
 */
export const findDesignFiles = async (fixture: Fixture): Promise<string[]> => {
  const extensions =
    fixture.format === "cadence"
      ? [".dsn", ".cpm"]
      : [".prjpcb"];

  return findDesignFilesRecursive(fixture.path, extensions);
};

/**
 * Find a design file within a fixture directory.
 * Returns the first design file found (for backwards compatibility).
 */
export const findDesignFile = async (fixture: Fixture): Promise<string | null> => {
  const files = await findDesignFiles(fixture);
  return files[0] ?? null;
};
