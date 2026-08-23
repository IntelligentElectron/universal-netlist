/**
 * Universal Netlist design discovery.
 *
 * A Universal Netlist design is a `.json` file in the Universal Netlist shape:
 * an object with `nets` and `components` (docs/schemas/universal-netlist.md).
 * Any other `.json` file is not a design and is not listed. A file that has the
 * shape but fails validation is listed with its error, so a broken netlist is
 * visible rather than silently absent.
 *
 * Design name: the file basename without `.json`, the same rule every other
 * tool applies to a design path.
 *
 * Directories named `node_modules` and directories whose name starts with `.`
 * are not walked. They hold `.json` in quantity and designs never.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { hasUniversalShape, validateUniversalNetlist } from "./reader.js";

/** Extensions a caller may hand directly to the Universal Netlist handler. */
export const UNIVERSAL_EXTENSIONS = [".json"] as const;

/** Discovered Universal Netlist design. The `.json` file is the design. */
export interface UniversalDiscoveredDesign {
  name: string;
  sourcePath: string;
  format: "universal";
  error?: string;
}

/** Both keys must appear in the text before the file is parsed at all. */
const SHAPE_HINTS = [/"nets"\s*:/, /"components"\s*:/];

const SKIPPED_DIRECTORIES = new Set(["node_modules"]);

/** Check if a file path is one the Universal Netlist handler can process. */
export const isUniversalFile = (filePath: string): boolean =>
  UNIVERSAL_EXTENSIONS.includes(
    path.extname(filePath).toLowerCase() as (typeof UNIVERSAL_EXTENSIONS)[number]
  );

/** The design name for a Universal Netlist file path: the basename without `.json`. */
export const universalDesignName = (filePath: string): string =>
  path.basename(filePath, path.extname(filePath));

const walkForJson = async (rootDir: string, maxDepth?: number): Promise<string[]> => {
  const files: string[] = [];

  const walk = async (currentDir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      const skippable = new Set(["EACCES", "ENOENT", "ENOTDIR"]);
      if (!(error instanceof Error) || !("code" in error) || !skippable.has(String(error.code))) {
        throw error;
      }
      return;
    }

    for (const entry of entries) {
      // macOS AppleDouble sidecars (`._name`) are metadata, never designs.
      if (entry.name.startsWith("._")) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (maxDepth === undefined || depth < maxDepth) {
          await walk(fullPath, depth + 1);
        }
        continue;
      }
      if (entry.isFile() && isUniversalFile(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  await walk(rootDir, 0);
  return files;
};

/**
 * Discover Universal Netlist designs under a directory.
 */
export const discoverUniversalDesigns = async (
  rootDir: string,
  options?: { maxDepth?: number }
): Promise<UniversalDiscoveredDesign[]> => {
  const absoluteRootDir = path.resolve(rootDir);
  const files = await walkForJson(absoluteRootDir, options?.maxDepth);

  const designs = await Promise.all(
    files.map(async (filePath): Promise<UniversalDiscoveredDesign | null> => {
      let text: string;
      try {
        text = await readFile(filePath, "utf-8");
      } catch {
        return null;
      }
      if (!SHAPE_HINTS.every((hint) => hint.test(text))) return null;

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return null;
      }
      if (!hasUniversalShape(raw)) return null;

      const design: UniversalDiscoveredDesign = {
        name: universalDesignName(filePath),
        sourcePath: filePath,
        format: "universal",
      };
      try {
        validateUniversalNetlist(raw, path.basename(filePath));
      } catch (error) {
        design.error = error instanceof Error ? error.message : String(error);
      }
      return design;
    })
  );

  return designs
    .filter((design): design is UniversalDiscoveredDesign => design !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
};
