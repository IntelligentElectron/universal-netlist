/**
 * Test utilities for golden reference testing.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ParsedNetlist } from "../src/types.js";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES_DIR = path.join(TEST_DIR, "fixtures");
const GOLDEN_DIR = path.join(TEST_DIR, "golden");

/**
 * Root of the `test/fixtures` submodule.
 *
 * The submodule is absent from source tarballs, shallow or non-recursive
 * clones, vendored copies, and anything installed from a packed archive, so
 * every fixture path is built from here and guarded by {@link hasFixtures}.
 */
export const FIXTURES = FIXTURES_DIR;

/**
 * Resolve a path inside the fixtures submodule.
 *
 * ```ts
 * const OPENMD = fixturePath("kicad", "openmd-motordriver", "OpenMD.kicad_pro");
 * ```
 */
export const fixturePath = (...segments: string[]): string => path.join(FIXTURES, ...segments);

/**
 * Whether the fixtures submodule is checked out.
 *
 * `git` leaves an empty directory where an uninitialized submodule sits, so the
 * presence of a format directory inside it is what distinguishes "fetched" from
 * "declared". Suites that need fixture designs guard on this:
 *
 * ```ts
 * describe.skipIf(!hasFixtures)("kicad parser", () => { ... });
 * ```
 */
export const hasFixtures = existsSync(path.join(FIXTURES_DIR, "kicad"));

export type Format = "cadence" | "altium" | "kicad";

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
  const formats: Format[] = ["cadence", "altium", "kicad"];
  const results = await Promise.all(formats.map(listFixtures));
  return results.flat();
};

/**
 * Load golden output JSON for a fixture.
 * Returns null if the golden file doesn't exist.
 */
export const loadGolden = async (
  format: Format,
  designName: string
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
  data: ParsedNetlist
): Promise<boolean> => {
  const goldenDir = path.join(GOLDEN_DIR, format);
  await fs.mkdir(goldenDir, { recursive: true });

  // Only rewrite a golden whose content actually moved. The tests compare
  // structurally, so a parser that reorders the keys it writes leaves every
  // golden passing and every golden rewritten, burying the one design that
  // changed under thousands of lines of key-order churn.
  //
  // The comparison is against the new data round-tripped through JSON, not the
  // data itself: serializing drops a key whose value is `undefined`, so the two
  // sides have to be compared in the form that reaches the file.
  const serialized = JSON.stringify(data, null, 2) + "\n";
  const existing = await loadGolden(format, designName);
  if (existing && deepEqual(existing, JSON.parse(serialized))) return false;

  const goldenPath = path.join(goldenDir, `${designName}.json`);
  await fs.writeFile(goldenPath, serialized, "utf-8");
  return true;
};

/** Structural equality, key order and property order disregarded. */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && deepEqual(left[key], right[key]));
};

/**
 * Recursively find design files within a directory.
 */
const findDesignFilesRecursive = async (
  dir: string,
  extensions: string[],
  filenames: string[] = []
): Promise<string[]> => {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDesignFilesRecursive(fullPath, extensions, filenames);
      results.push(...nested);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const name = entry.name.toLowerCase();
      if (
        extensions.some((e) => e.toLowerCase() === ext) ||
        filenames.some((f) => f.toLowerCase() === name)
      ) {
        results.push(fullPath);
      }
    }
  }

  return results;
};

/**
 * Find all design files within a fixture directory (recursively).
 * For Cadence: looks for .dsn or .cpm files, falling back to pstxnet.dat for dat-only fixtures
 * For Altium: looks for .PrjPcb files
 */
export const findDesignFiles = async (fixture: Fixture): Promise<string[]> => {
  const extensionsByFormat: Record<Format, string[]> = {
    cadence: [".dsn", ".cpm"],
    altium: [".prjpcb"],
    kicad: [".kicad_pro"],
  };
  const extensions = extensionsByFormat[fixture.format];

  const results = await findDesignFilesRecursive(fixture.path, extensions);

  // For Cadence: fall back to pstxnet.dat if no schematic files found
  if (results.length === 0 && fixture.format === "cadence") {
    return findDesignFilesRecursive(fixture.path, [], ["pstxnet.dat"]);
  }

  return results;
};

/**
 * Find .dsn files within a Cadence fixture directory (for DSN coverage tests).
 */
export const findDsnFiles = async (fixture: Fixture): Promise<string[]> =>
  findDesignFilesRecursive(fixture.path, [".dsn"]);

/**
 * Find a design file within a fixture directory.
 * Returns the first design file found (for backwards compatibility).
 */
export const findDesignFile = async (fixture: Fixture): Promise<string | null> => {
  const files = await findDesignFiles(fixture);
  return files[0] ?? null;
};
