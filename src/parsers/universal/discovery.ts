/**
 * Universal Netlist design discovery.
 *
 * A Universal Netlist design is a `.netlist.json` file carrying the required
 * schema version marker (docs/schemas/universal-netlist.md). Other JSON files
 * are not opened. A `.netlist.json` file that fails validation is listed with
 * its error, so a broken netlist is visible rather than silently absent.
 *
 * Design name: the file basename without `.netlist.json`.
 *
 * Directories named `node_modules` and directories whose name starts with `.`
 * are not walked. They hold `.json` in quantity and designs never.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseUniversalNetlist } from "./reader.js";
import {
  isUniversalNetlistPath,
  UNIVERSAL_NETLIST_SUFFIX,
  universalNetlistName,
} from "../../universal-format.js";

/** Canonical suffix a caller may hand directly to the Universal Netlist handler. */
export const UNIVERSAL_EXTENSIONS = [UNIVERSAL_NETLIST_SUFFIX] as const;

/** Discovered Universal Netlist design. The `.netlist.json` file is the design. */
export interface UniversalDiscoveredDesign {
  name: string;
  sourcePath: string;
  format: "universal";
  error?: string;
}

const SKIPPED_DIRECTORIES = new Set(["node_modules"]);

/** Check if a file path is one the Universal Netlist handler can process. */
export const isUniversalFile = (filePath: string): boolean => isUniversalNetlistPath(filePath);

/** The design name for a Universal Netlist file path: basename without its canonical suffix. */
export const universalDesignName = universalNetlistName;

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
      const design: UniversalDiscoveredDesign = {
        name: universalDesignName(filePath),
        sourcePath: filePath,
        format: "universal",
      };
      try {
        parseUniversalNetlist(text, path.basename(filePath));
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
