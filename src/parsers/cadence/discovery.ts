/**
 * Cadence design discovery module.
 * Finds Cadence CIS (.dsn) and HDL (.cpm) designs with their .dat netlist files.
 *
 * Uses subtree-scoped matching: .dat files are matched to the design whose directory
 * contains them (same directory or any subdirectory). This handles arbitrary folder
 * structures since users can export netlists to any directory they choose.
 */

import { readdir } from "fs/promises";
import path from "path";

const CADENCE_EXTENSIONS = [".dsn", ".cpm"] as const;

/**
 * Cadence-specific discovered design with .dat file paths.
 */
export interface CadenceDiscoveredDesign {
  name: string;
  sourcePath: string;
  format: "cadence-cis" | "cadence-hdl";
  datFiles: {
    pstxnet: string | null;
    pstxprt: string | null;
    pstchip: string | null;
  };
  error?: string;
}

/** Required .dat files for a complete netlist export */
const REQUIRED_DAT_FILES = [
  "pstxnet.dat",
  "pstxprt.dat",
  "pstchip.dat",
] as const;

interface CadenceDatFiles {
  pstxnet: string | null;
  pstxprt: string | null;
  pstchip: string | null;
}

/**
 * A complete set of .dat files in a single directory.
 */
interface DatFileSet {
  directory: string;
  pstxnet: string;
  pstxprt: string;
  pstchip: string;
}

/**
 * Walk directory tree to find Cadence design files and complete .dat file sets.
 */
const walkForCadenceFiles = async (
  rootDir: string,
): Promise<{ designFiles: string[]; datSets: DatFileSet[] }> => {
  const designFiles: string[] = [];
  const datFilesByDir = new Map<string, Map<string, string>>();

  const walk = async (currentDir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EACCES"
      ) {
        throw error;
      }
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      const baseName = entry.name.toLowerCase();

      // Collect design files
      if (
        CADENCE_EXTENSIONS.includes(ext as (typeof CADENCE_EXTENSIONS)[number])
      ) {
        designFiles.push(fullPath);
      }

      // Collect .dat files grouped by directory
      if (
        ext === ".dat" &&
        REQUIRED_DAT_FILES.includes(
          baseName as (typeof REQUIRED_DAT_FILES)[number],
        )
      ) {
        if (!datFilesByDir.has(currentDir)) {
          datFilesByDir.set(currentDir, new Map());
        }
        datFilesByDir.get(currentDir)!.set(baseName, fullPath);
      }
    }
  };

  await walk(rootDir);

  // Convert to complete DatFileSets (only directories with all 3 required files)
  const datSets: DatFileSet[] = [];
  for (const [dir, files] of datFilesByDir) {
    if (files.size === REQUIRED_DAT_FILES.length) {
      datSets.push({
        directory: dir,
        pstxnet: files.get("pstxnet.dat")!,
        pstxprt: files.get("pstxprt.dat")!,
        pstchip: files.get("pstchip.dat")!,
      });
    }
  }

  return { designFiles, datSets };
};

/**
 * Normalize a path for comparison.
 * - Converts to native separators (handles both / and \ regardless of platform)
 * - Lowercases on Windows (case-insensitive filesystem)
 */
const normalizeForComparison = (p: string): string => {
  // On Windows, path.normalize converts / to \
  // On Unix, we must manually convert \ to / since path.normalize doesn't
  const normalized =
    process.platform === "win32"
      ? path.normalize(p)
      : path.normalize(p.replace(/\\/g, "/"));
  // Windows is case-insensitive, Unix is case-sensitive
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

/**
 * Check if a directory is a descendant of (or equal to) another directory.
 * Uses proper path boundary checking to avoid false matches like "test_design_1" matching "test_design_2".
 * Case-insensitive on Windows.
 */
const isDescendantOrEqual = (childDir: string, parentDir: string): boolean => {
  const normalizedChild = normalizeForComparison(childDir);
  const normalizedParent = normalizeForComparison(parentDir);

  if (normalizedChild === normalizedParent) return true;
  // Ensure path boundary: parent must end with separator or child must start with parent + separator
  const parentWithSep = normalizedParent.endsWith(path.sep)
    ? normalizedParent
    : normalizedParent + path.sep;
  return normalizedChild.startsWith(parentWithSep);
};

/**
 * Check if design name appears as an exact directory component in a relative path.
 * Case-insensitive matching.
 */
const designNameInRelativePath = (
  relPath: string,
  designName: string,
): boolean => {
  if (relPath === "" || relPath === ".") return false;
  const components = relPath.split(path.sep);
  const lowerName = designName.toLowerCase();
  return components.some((c) => c.toLowerCase() === lowerName);
};

/**
 * Score a dat set candidate for a design. Higher score = better match.
 */
const scoreDatSetMatch = (
  designDir: string,
  designName: string,
  datSet: DatFileSet,
): number => {
  let score = 0;

  // Get relative path from design directory to dat set
  const relPath = path.relative(designDir, datSet.directory);
  const depth = relPath === "" ? 0 : relPath.split(path.sep).length;

  // Bonus for design name appearing as a path component in the RELATIVE path
  // (not the absolute path, which might contain project folder names)
  if (designNameInRelativePath(relPath, designName)) {
    score += 1000;
  }

  // Prefer closer paths (fewer directory levels between design and dat)
  score -= depth;

  return score;
};

/**
 * Match dat sets to designs using subtree-scoped matching.
 * A dat set belongs to a design if it's in the same directory or any subdirectory.
 */
const matchDatSetsToDesigns = (
  designFiles: string[],
  datSets: DatFileSet[],
): Map<string, DatFileSet | null> => {
  const assignments = new Map<string, DatFileSet | null>();
  const usedDatSets = new Set<string>();

  // Initialize all designs with null
  for (const designPath of designFiles) {
    assignments.set(designPath, null);
  }

  // For each design, find matching dat sets in its subtree
  for (const designPath of designFiles) {
    const designDir = path.dirname(designPath);
    const designName = path.basename(designPath, path.extname(designPath));

    // Find dat sets that are descendants of (or in) this design's directory
    const candidates = datSets.filter(
      (ds) =>
        !usedDatSets.has(ds.directory) &&
        isDescendantOrEqual(ds.directory, designDir),
    );

    if (candidates.length === 0) {
      continue;
    }

    let matchedSet: DatFileSet;

    if (candidates.length === 1) {
      matchedSet = candidates[0];
    } else {
      // Multiple candidates - score and pick best
      const scored = candidates.map((ds) => ({
        datSet: ds,
        score: scoreDatSetMatch(designDir, designName, ds),
      }));
      scored.sort((a, b) => b.score - a.score);
      matchedSet = scored[0].datSet;
    }

    assignments.set(designPath, matchedSet);
    usedDatSets.add(matchedSet.directory);
  }

  return assignments;
};

/**
 * Normalize path separators to native format.
 * On Unix, converts backslashes to forward slashes before normalizing.
 */
const normalizeSeparators = (p: string): string => {
  if (process.platform === "win32") {
    return path.normalize(p);
  }
  return path.normalize(p.replace(/\\/g, "/"));
};

/**
 * Discover Cadence designs in a directory.
 * Uses subtree-scoped matching to associate .dat files with designs.
 */
export const discoverCadenceDesigns = async (
  rootDir: string,
): Promise<CadenceDiscoveredDesign[]> => {
  // Normalize separators before resolving to handle cross-platform paths
  const absoluteRootDir = path.resolve(normalizeSeparators(rootDir));
  const { designFiles, datSets } = await walkForCadenceFiles(absoluteRootDir);

  // Match dat sets to designs
  const assignments = matchDatSetsToDesigns(designFiles, datSets);

  const designs: CadenceDiscoveredDesign[] = [];

  for (const designPath of designFiles) {
    const rawExt = path.extname(designPath);
    const ext = rawExt.toLowerCase();
    const name = path.basename(designPath, rawExt);

    const format = ext === ".dsn" ? "cadence-cis" : "cadence-hdl";
    const matchedDatSet = assignments.get(designPath);

    const datFiles: CadenceDatFiles = matchedDatSet
      ? {
          pstxnet: matchedDatSet.pstxnet,
          pstxprt: matchedDatSet.pstxprt,
          pstchip: matchedDatSet.pstchip,
        }
      : { pstxnet: null, pstxprt: null, pstchip: null };

    const design: CadenceDiscoveredDesign = {
      name,
      format,
      sourcePath: designPath,
      datFiles,
    };

    if (!matchedDatSet) {
      design.error =
        "Netlist files not exported. Run export_cadence_netlist to generate them.";
    }

    designs.push(design);
  }

  return designs;
};

/**
 * Find Cadence .dat files for a specific design file.
 * Searches in the design's directory and all subdirectories.
 */
export const findCadenceDatFiles = async (
  designFilePath: string,
): Promise<CadenceDatFiles> => {
  // Normalize separators before processing to handle cross-platform paths
  const normalizedPath = normalizeSeparators(designFilePath);
  const designDir = path.dirname(normalizedPath);
  const designName = path.basename(
    normalizedPath,
    path.extname(normalizedPath),
  );

  const { datSets } = await walkForCadenceFiles(designDir);

  // Find dat sets in this design's subtree
  const candidates = datSets.filter((ds) =>
    isDescendantOrEqual(ds.directory, designDir),
  );

  if (candidates.length === 0) {
    return { pstxnet: null, pstxprt: null, pstchip: null };
  }

  // If multiple candidates, pick best by score
  if (candidates.length === 1) {
    const ds = candidates[0];
    return { pstxnet: ds.pstxnet, pstxprt: ds.pstxprt, pstchip: ds.pstchip };
  }

  const scored = candidates.map((ds) => ({
    datSet: ds,
    score: scoreDatSetMatch(designDir, designName, ds),
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].datSet;

  return {
    pstxnet: best.pstxnet,
    pstxprt: best.pstxprt,
    pstchip: best.pstchip,
  };
};

/**
 * Check if a file path is a Cadence design file.
 */
export const isCadenceFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return CADENCE_EXTENSIONS.includes(
    ext as (typeof CADENCE_EXTENSIONS)[number],
  );
};

/** Cadence file extensions */
export { CADENCE_EXTENSIONS };
