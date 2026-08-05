/**
 * Cadence design discovery module.
 * Finds Cadence CIS (.dsn), HDL (.cpm), and dat-only designs with their .dat netlist files.
 *
 * Uses subtree-scoped matching: .dat files are matched to the design whose directory
 * contains them (same directory or any subdirectory). This handles arbitrary folder
 * structures since users can export netlists to any directory they choose.
 *
 * Unmatched .dat trios (no parent .DSN/.cpm) become standalone cadence-dat designs
 * with pstxnet.dat as the design path and names extracted from ROOT_DRAWING in pstxprt.dat.
 */

import { readdir, readFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";

const CADENCE_EXTENSIONS = [".dsn", ".cpm"] as const;

/**
 * Cadence-specific discovered design with .dat file paths.
 */
export interface CadenceDiscoveredDesign {
  name: string;
  sourcePath: string;
  format: "cadence-cis" | "cadence-hdl" | "cadence-dat";
  datFiles: {
    pstxnet: string | null;
    pstxprt: string | null;
    pstchip: string | null;
  };
  error?: string;
}

/** Required .dat files for a complete netlist export */
const REQUIRED_DAT_FILES = ["pstxnet.dat", "pstxprt.dat", "pstchip.dat"] as const;

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
 *
 * @param rootDir - Root directory to search
 * @param maxDepth - Maximum recursion depth (0 = root only). Omit for unlimited.
 */
const walkForCadenceFiles = async (
  rootDir: string,
  maxDepth?: number
): Promise<{ designFiles: string[]; datSets: DatFileSet[] }> => {
  const designFiles: string[] = [];
  const datFilesByDir = new Map<string, Map<string, string>>();

  const walk = async (currentDir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EACCES") {
        throw error;
      }
      return;
    }

    for (const entry of entries) {
      // macOS writes AppleDouble sidecars (`._name`) beside real files on network
      // volumes (NFS/SMB). They are metadata, never designs — skip files and dirs alike.
      if (entry.name.startsWith("._")) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (maxDepth === undefined || depth < maxDepth) {
          await walk(fullPath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      const baseName = entry.name.toLowerCase();

      // Collect design files
      if (CADENCE_EXTENSIONS.includes(ext as (typeof CADENCE_EXTENSIONS)[number])) {
        designFiles.push(fullPath);
      }

      // Collect .dat files grouped by directory
      if (
        ext === ".dat" &&
        REQUIRED_DAT_FILES.includes(baseName as (typeof REQUIRED_DAT_FILES)[number])
      ) {
        if (!datFilesByDir.has(currentDir)) {
          datFilesByDir.set(currentDir, new Map());
        }
        datFilesByDir.get(currentDir)!.set(baseName, fullPath);
      }
    }
  };

  await walk(rootDir, 0);

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
    process.platform === "win32" ? path.normalize(p) : path.normalize(p.replace(/\\/g, "/"));
  // Windows is case-insensitive, Unix is case-sensitive
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

/**
 * Check if a directory is a descendant of (or equal to) another directory.
 * Uses proper path boundary checking to avoid false matches like "test_design_1" matching "test_design_1_v2".
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
const designNameInRelativePath = (relPath: string, designName: string): boolean => {
  if (relPath === "" || relPath === ".") return false;
  const components = relPath.split(path.sep);
  const lowerName = designName.toLowerCase();
  return components.some((c) => c.toLowerCase() === lowerName);
};

/**
 * Score a dat set candidate for a design. Higher score = better match.
 */
const scoreDatSetMatch = (designDir: string, designName: string, datSet: DatFileSet): number => {
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
 * A candidate pairing of a design with a dat set.
 */
interface MatchCandidate {
  designPath: string;
  datSet: DatFileSet;
  score: number;
}

/**
 * Match dat sets to designs using global score-based assignment.
 * This ensures deterministic results regardless of readdir order.
 *
 * Algorithm:
 * 1. Build all valid (design, datSet, score) pairs
 * 2. Sort globally by score (desc), then by paths for determinism
 * 3. Assign greedily from highest score, skipping already-assigned pairs
 */
const matchDatSetsToDesigns = (
  designFiles: string[],
  datSets: DatFileSet[]
): Map<string, DatFileSet | null> => {
  const assignments = new Map<string, DatFileSet | null>();

  // Initialize all designs with null
  for (const designPath of designFiles) {
    assignments.set(designPath, null);
  }

  // Build all valid candidate pairings
  const candidates: MatchCandidate[] = [];
  for (const designPath of designFiles) {
    const designDir = path.dirname(designPath);
    const designName = path.basename(designPath, path.extname(designPath));

    for (const datSet of datSets) {
      if (isDescendantOrEqual(datSet.directory, designDir)) {
        candidates.push({
          designPath,
          datSet,
          score: scoreDatSetMatch(designDir, designName, datSet),
        });
      }
    }
  }

  // Sort by score (descending), then by paths for determinism
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreaker: sort by design path, then dat directory
    if (a.designPath !== b.designPath) {
      return a.designPath.localeCompare(b.designPath);
    }
    return a.datSet.directory.localeCompare(b.datSet.directory);
  });

  // Assign greedily from highest score
  const usedDatSets = new Set<string>();
  const assignedDesigns = new Set<string>();

  for (const candidate of candidates) {
    if (assignedDesigns.has(candidate.designPath) || usedDatSets.has(candidate.datSet.directory)) {
      continue;
    }

    assignments.set(candidate.designPath, candidate.datSet);
    assignedDesigns.add(candidate.designPath);
    usedDatSets.add(candidate.datSet.directory);
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
 * Extract ROOT_DRAWING name from pstxprt.dat DIRECTIVES header.
 * Returns null if ROOT_DRAWING is not found.
 */
const extractRootDrawing = async (pstxprtPath: string): Promise<string | null> => {
  const content = await readFile(pstxprtPath, "utf-8");
  const match = content.match(/ROOT_DRAWING='([^']+)'/);
  return match ? match[1] : null;
};

/**
 * Generate a short deterministic hash suffix from a path.
 * Used to disambiguate dat-only designs with the same name.
 */
const shortPathHash = (p: string): string =>
  createHash("sha256").update(p).digest("hex").slice(0, 4);

/**
 * Collect the set of dat directories consumed by DSN/CPM design assignments.
 */
const consumedDirectories = (assignments: Map<string, DatFileSet | null>): Set<string> => {
  const dirs = new Set<string>();
  for (const datSet of assignments.values()) {
    if (datSet) dirs.add(datSet.directory);
  }
  return dirs;
};

/**
 * Build standalone cadence-dat designs from unmatched dat trios.
 * Extracts design names from ROOT_DRAWING in pstxprt.dat, falling back to
 * the containing folder name. Disambiguates duplicate names with a hash suffix.
 */
const buildStandaloneDesigns = async (
  datSets: DatFileSet[],
  consumedDatDirs: Set<string>
): Promise<CadenceDiscoveredDesign[]> => {
  const unmatchedSets = datSets.filter((ds) => !consumedDatDirs.has(ds.directory));

  if (unmatchedSets.length === 0) return [];

  // Extract names for all unmatched sets
  const nameEntries = await Promise.all(
    unmatchedSets.map(async (ds) => {
      const rootDrawing = await extractRootDrawing(ds.pstxprt);
      const name = rootDrawing ?? path.basename(ds.directory);
      return { datSet: ds, name };
    })
  );

  // Detect duplicate names and disambiguate
  const nameCounts = new Map<string, number>();
  for (const entry of nameEntries) {
    nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
  }

  return nameEntries.map((entry) => {
    const finalName =
      nameCounts.get(entry.name)! > 1
        ? `${entry.name}_${shortPathHash(entry.datSet.directory)}`
        : entry.name;

    return {
      name: finalName,
      format: "cadence-dat" as const,
      sourcePath: entry.datSet.pstxnet,
      datFiles: {
        pstxnet: entry.datSet.pstxnet,
        pstxprt: entry.datSet.pstxprt,
        pstchip: entry.datSet.pstchip,
      },
    };
  });
};

/**
 * Discover Cadence designs in a directory.
 * Uses subtree-scoped matching to associate .dat files with DSN/CPM designs.
 * Unmatched dat trios (no parent DSN/CPM) become standalone cadence-dat designs.
 */
export const discoverCadenceDesigns = async (
  rootDir: string,
  options?: { maxDepth?: number }
): Promise<CadenceDiscoveredDesign[]> => {
  // Normalize separators before resolving to handle cross-platform paths
  const absoluteRootDir = path.resolve(normalizeSeparators(rootDir));
  const { designFiles, datSets } = await walkForCadenceFiles(absoluteRootDir, options?.maxDepth);

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

    designs.push(design);
  }

  // Append standalone designs from unmatched dat trios
  const standalones = await buildStandaloneDesigns(datSets, consumedDirectories(assignments));
  designs.push(...standalones);

  return designs;
};

/**
 * Find Cadence .dat files for a specific design file.
 * Searches in the design's directory and all subdirectories.
 */
export const findCadenceDatFiles = async (designFilePath: string): Promise<CadenceDatFiles> => {
  // Normalize separators before processing to handle cross-platform paths
  const normalizedPath = normalizeSeparators(designFilePath);
  const designDir = path.dirname(normalizedPath);
  const designName = path.basename(normalizedPath, path.extname(normalizedPath));

  const { datSets } = await walkForCadenceFiles(designDir);

  // Find dat sets in this design's subtree
  const candidates = datSets.filter((ds) => isDescendantOrEqual(ds.directory, designDir));

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
  if (CADENCE_EXTENSIONS.includes(ext as (typeof CADENCE_EXTENSIONS)[number])) {
    return true;
  }
  // Also recognize pstxnet.dat as a Cadence dat-only design path
  return path.basename(filePath).toLowerCase() === "pstxnet.dat";
};

/** Cadence file extensions */
export { CADENCE_EXTENSIONS };
