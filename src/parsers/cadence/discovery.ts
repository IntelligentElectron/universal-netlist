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
import { isNetlistDirFor, REQUIRED_DAT_FILES } from "../../paths.js";

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

/** A path component naming the design outweighs any amount of distance. */
const NAME_MATCH_BONUS = 1000;
/**
 * The export directory outranks a bare name match by more than the depth
 * penalty can erode, so a fresh export still wins from a directory or two
 * deeper than a stale one carrying the same name.
 */
const EXPORT_DIR_BONUS = NAME_MATCH_BONUS + 100;

type NameMatch = "none" | "named" | "exported";

/**
 * How a path names a design: as a bare `<design>` component, or as the
 * `<design>_netlist` directory `export_cadence_netlist` writes to.
 *
 * The two are distinguished because they can both be present, and then one is
 * a fresh export and the other is whatever was there before. Scoring the export
 * higher means a successful export is not silently ignored in favour of a stale
 * directory that happens to carry the design's name.
 */
const designNameInRelativePath = (relPath: string, designName: string): NameMatch => {
  if (relPath === "" || relPath === ".") return "none";
  const components = relPath.split(path.sep);
  const lowerName = designName.toLowerCase();

  if (components.some((c) => isNetlistDirFor(c, designName))) return "exported";
  if (components.some((c) => c.toLowerCase() === lowerName)) return "named";
  return "none";
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
  const match = designNameInRelativePath(relPath, designName);
  if (match === "exported") score += EXPORT_DIR_BONUS;
  else if (match === "named") score += NAME_MATCH_BONUS;

  // Prefer closer paths (fewer directory levels between design and dat)
  score -= depth;

  return score;
};

/**
 * Order two paths by code unit.
 *
 * Not `localeCompare`: its collation follows the host locale, so which dat set a
 * design gets changed with LANG (Czech sorts the digraph "ch" after "h", Danish
 * orders "Allegro" against "allegro" the other way round from English), and Bun
 * pins en-US while Node honours the environment, so CI cannot observe what the
 * shipped binaries do. It is also not a total order: two distinct strings that
 * differ only by a soft hyphen compare equal, and the sort then falls back to
 * readdir order. Code-unit order is the same everywhere.
 */
const comparePaths = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A candidate pairing of a design with a dat set.
 */
interface MatchCandidate {
  designPath: string;
  datSet: DatFileSet;
  score: number;
  match: NameMatch;
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
): { assignments: Map<string, DatFileSet | null>; withheld: Map<string, string[]> } => {
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
      if (!isDescendantOrEqual(datSet.directory, designDir)) continue;
      candidates.push({
        designPath,
        datSet,
        score: scoreDatSetMatch(designDir, designName, datSet),
        match: designNameInRelativePath(path.relative(designDir, datSet.directory), designName),
      });
    }
  }

  // A dat set no design can claim by name, that two designs reach equally well,
  // belongs to neither of them. Greedy assignment would hand it to whichever
  // design sorted first, and the other would answer every query with that
  // design's circuit and show no error for it. This is the shape a folder is
  // left in mid-migration: one design re-exported to its own directory, the
  // shared one they used to overwrite each other in now orphaned.
  //
  // Leaving it unassigned costs a fallback to parsing the schematic directly,
  // which now reproduces the DAT export exactly, so the cost is time rather
  // than fidelity.
  const bestByDatSet = new Map<string, { score: number; designs: Set<string> }>();
  for (const c of candidates) {
    const seen = bestByDatSet.get(c.datSet.directory);
    if (!seen || c.score > seen.score) {
      bestByDatSet.set(c.datSet.directory, { score: c.score, designs: new Set([c.designPath]) });
    } else if (c.score === seen.score) {
      seen.designs.add(c.designPath);
    }
  }
  const contested = new Set(
    [...bestByDatSet.entries()]
      .filter(([, best]) => best.score < NAME_MATCH_BONUS && best.designs.size > 1)
      .map(([directory]) => directory)
  );

  // Two designs can name one directory by different conventions and both be
  // right: `X_netlist/` is where export_cadence_netlist puts design `X`, and it
  // is also the directory named for a design called `X_netlist`. The export
  // bonus outranks the bare name match unconditionally, so `X` took it and
  // `X_netlist` was told it had no netlist. Nothing on disk settles which
  // reading is correct, so neither design gets it.
  for (const [directory, best] of bestByDatSet) {
    if (best.designs.size !== 1) continue;
    const claimant = [...best.designs][0];
    const claim = candidates.find(
      (c) => c.datSet.directory === directory && c.designPath === claimant
    );
    if (claim?.match !== "exported") continue;

    const basename = path.basename(directory).toLowerCase();
    const namesake = candidates.some(
      (c) =>
        c.datSet.directory === directory &&
        c.designPath !== claimant &&
        path.basename(c.designPath, path.extname(c.designPath)).toLowerCase() === basename
    );
    if (namesake) contested.add(directory);
  }

  // Sort by score (descending), then by paths for determinism
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    // `<design>_netlist/` is export_cadence_netlist's own convention and that
    // tool only accepts a .DSN, so when a .DSN and a .cpm share a stem and
    // therefore tie for it, it belongs to the design that produced it. Without
    // this the CIS design that had just exported got nothing while its HDL
    // namesake took the directory, and a caller following the documented loop
    // (export, re-list, still no netlist) re-exported forever.
    if (a.match === "exported" && b.match === "exported") {
      const aIsDsn = path.extname(a.designPath).toLowerCase() === ".dsn";
      const bIsDsn = path.extname(b.designPath).toLowerCase() === ".dsn";
      if (aIsDsn !== bIsDsn) return aIsDsn ? -1 : 1;
    }

    // Tiebreaker: sort by design path, then dat directory
    if (a.designPath !== b.designPath) {
      return comparePaths(a.designPath, b.designPath);
    }
    return comparePaths(a.datSet.directory, b.datSet.directory);
  });

  // Assign greedily from highest score
  const usedDatSets = new Set<string>();
  const assignedDesigns = new Set<string>();

  // Which designs were refused which directories, so a withheld netlist can say
  // so. Left silent, a design whose netlist was withheld looked byte for byte
  // like one that had never been exported, and the advice for that (run
  // export_cadence_netlist) does not help: exporting to its own directory does,
  // and nothing said so.
  const withheld = new Map<string, string[]>();

  for (const candidate of candidates) {
    if (assignedDesigns.has(candidate.designPath) || usedDatSets.has(candidate.datSet.directory)) {
      continue;
    }
    if (contested.has(candidate.datSet.directory)) {
      const dirs = withheld.get(candidate.designPath) ?? [];
      dirs.push(candidate.datSet.directory);
      withheld.set(candidate.designPath, dirs);
      continue;
    }

    assignments.set(candidate.designPath, candidate.datSet);
    assignedDesigns.add(candidate.designPath);
    usedDatSets.add(candidate.datSet.directory);
  }

  // A design that ended up with a directory of its own was never short of one.
  for (const designPath of assignedDesigns) withheld.delete(designPath);

  return { assignments, withheld };
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
  // A name is a nicety; the walk already deliberately swallows EACCES to keep one
  // unreadable directory from hiding a tree. An unguarded read here rejected the
  // Promise.all above it, which rejected discoverCadenceDesigns, which rejected
  // the Promise.all over the format handlers in parsers/index.ts: one ACL-locked
  // or Cadence-held pstxprt.dat made every design of every format in the tree
  // invisible, reported as a single "Failed to search" error.
  let content: string;
  try {
    content = await readFile(pstxprtPath, "utf-8");
  } catch {
    return null;
  }
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
  consumedDatDirs: Set<string>,
  takenNames: ReadonlySet<string> = new Set()
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
  // A leftover set answers to the name Cadence recorded for it, which is often
  // a live design's name. Compared case-insensitively because that name comes
  // from ROOT_DRAWING, which Cadence always writes uppercase, while a design
  // takes its name from the filename.
  const nameCounts = new Map<string, number>();
  for (const entry of nameEntries) {
    const key = entry.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const taken = new Set([...takenNames].map((n) => n.toLowerCase()));

  return nameEntries.map((entry) => {
    const key = entry.name.toLowerCase();
    const finalName =
      nameCounts.get(key)! > 1 || taken.has(key)
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
  const { assignments, withheld } = matchDatSetsToDesigns(designFiles, datSets);

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

    const refused = withheld.get(designPath);
    if (refused && refused.length > 0) {
      design.error =
        `A netlist in ${refused.join(", ")} could belong to this design or to another one nearby, ` +
        `so it is not attributed to either. Export ${name} to a directory of its own to resolve it.`;
    }

    designs.push(design);
  }

  // Append standalone designs from unmatched dat trios
  const standalones = await buildStandaloneDesigns(
    datSets,
    consumedDirectories(assignments),
    new Set(designs.map((d) => d.name))
  );
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

  const { designFiles, datSets } = await walkForCadenceFiles(designDir);

  // Find dat sets in this design's subtree
  const candidates = datSets.filter((ds) => isDescendantOrEqual(ds.directory, designDir));
  if (candidates.length === 0) {
    return { pstxnet: null, pstxprt: null, pstchip: null };
  }

  const nothing: CadenceDatFiles = { pstxnet: null, pstxprt: null, pstchip: null };
  const filesOf = (ds: DatFileSet): CadenceDatFiles => ({
    pstxnet: ds.pstxnet,
    pstxprt: ds.pstxprt,
    pstchip: ds.pstchip,
  });

  // Run the same assignment discoverCadenceDesigns runs, and read this design's
  // answer out of it. Re-deriving the choice here let the two disagree: this
  // function once returned a netlist for a design that list_designs had
  // correctly left unmatched, and every query then answered about that design
  // with a neighbour's circuit.
  //
  // Same scope, same answer. The scopes are not always the same: this walk
  // starts at the design's directory and is unbounded, while list_designs walks
  // from the root it was given and honours max_depth. Queries arrive with the
  // path list_designs handed out, which for a design that has a netlist is the
  // pstxnet.dat itself and is resolved exactly below, so the two only diverge
  // when a caller names a .cpm directly under a narrowed max_depth.
  const self = findDesignFile(designFiles, normalizedPath);
  if (self) {
    const assigned = matchDatSetsToDesigns(designFiles, datSets).assignments.get(self);
    if (!assigned) return nothing;
    // The walk starts at this design's own directory, so a design sitting above
    // it is invisible here while discoverCadenceDesigns, walking from the root
    // the caller asked about, can see it and award the set to that one instead.
    // Declining rather than guessing keeps the answer either right or absent.
    const selfDir = path.dirname(self);
    const selfName = path.basename(self, path.extname(self));
    const outranked = await outrankedFromAbove(
      assigned,
      selfDir,
      scoreDatSetMatch(selfDir, selfName, assigned)
    );
    return outranked ? nothing : filesOf(assigned);
  }

  // The caller named a dat file rather than a design: list_designs hands out
  // pstxnet.dat for any design that has one, and that is the path queries then
  // arrive with. Its own directory is the answer, and saying so directly avoids
  // the scoring fallback that used to sit here, which could reach past it to a
  // neighbouring directory and did not honour the contested rule.
  const own = candidates.find(
    (ds) => normalizeForComparison(ds.directory) === normalizeForComparison(designDir)
  );
  if (own) return filesOf(own);

  // Not a design the walk recognises and not a dat directory. Naming a netlist
  // here would be a guess, and a guess reads as an answer.
  return nothing;
};

/**
 * The walked design file the caller meant.
 *
 * Cadence writes `.DSN`; callers, agents and documentation all write `.dsn`, and
 * on Windows and macOS both spellings name one file. Comparing exactly sent
 * every case-mismatched path down the fallback branch, which answered with a
 * neighbouring design's netlist and reported no error. The insensitive match is
 * only accepted when it is unambiguous, so a case-sensitive volume holding two
 * files that differ only in case declines instead of guessing.
 */
const findDesignFile = (designFiles: string[], normalizedPath: string): string | undefined => {
  const wanted = normalizeForComparison(normalizedPath);
  const exact = designFiles.find((d) => normalizeForComparison(d) === wanted);
  if (exact) return exact;

  const wantedLower = wanted.toLowerCase();
  const insensitive = designFiles.filter(
    (d) => normalizeForComparison(d).toLowerCase() === wantedLower
  );
  return insensitive.length === 1 ? insensitive[0] : undefined;
};

/**
 * Does a design above this one claim this dat set more strongly?
 *
 * Only the directories on the way up are read, and only their own entries, so
 * this costs one readdir per level rather than another tree walk.
 */
const outrankedFromAbove = async (
  datSet: DatFileSet,
  designDir: string,
  ownScore: number
): Promise<boolean> => {
  let dir = path.dirname(designDir);
  for (let level = 0; level < 32; level++) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      break;
    }

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith("._")) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!CADENCE_EXTENSIONS.includes(ext as (typeof CADENCE_EXTENSIONS)[number])) continue;
      const rivalName = path.basename(entry.name, path.extname(entry.name));
      if (scoreDatSetMatch(dir, rivalName, datSet) > ownScore) return true;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
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
