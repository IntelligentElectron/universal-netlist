/**
 * KiCad design discovery.
 *
 * A KiCad design is identified by its `.kicad_pro` project file. Each project
 * has a root schematic (`<basename>.kicad_sch`) and, in our fixtures, a committed
 * resolved netlist export (`<basename>.net`, kicadsexpr) sitting beside it — the
 * KiCad analogue of Cadence's committed `.dat` files, which keeps CI KiCad-free.
 *
 * Discovery keys off the `.kicad_pro` basename: the root schematic and the
 * committed export share that basename. (This is robust even when the design
 * directory name differs from the project basename, e.g.
 * `rdimm-ddr4-tester/data-center-rdimm-ddr4-tester.kicad_pro`.)
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { isReadable } from "./fs-utils.js";

/** Extensions a caller may hand directly to the KiCad handler. */
export const KICAD_EXTENSIONS = [".kicad_pro", ".kicad_sch"] as const;

/** Resolved netlist export extension (kicadsexpr, format "E"). */
const NETLIST_EXT = ".net";

/**
 * KiCad-specific discovered design.
 * `rootSchematic` is used for live `kicad-cli` export; `netlistExport` is the
 * committed resolved netlist parsed directly when present (preferred).
 */
export interface KicadDiscoveredDesign {
  name: string;
  sourcePath: string;
  format: "kicad";
  /** Root `.kicad_sch` for this project, or null if not found. */
  rootSchematic: string | null;
  /** Committed kicadsexpr `.net` export beside the project, or null. */
  netlistExport: string | null;
  error?: string;
}

/**
 * Resolve the design artifacts for a KiCad path (a `.kicad_pro` or a root
 * `.kicad_sch`). Returns the project basename, the root schematic, and the
 * sibling committed `.net` export when present.
 */
export const resolveKicadArtifacts = async (
  designPath: string
): Promise<{ name: string; rootSchematic: string | null; netlistExport: string | null }> => {
  const rawExt = path.extname(designPath);
  const ext = rawExt.toLowerCase();
  const dir = path.dirname(designPath);
  // Strip with the original-case extension so an uppercase ".KICAD_PRO" is removed.
  const base = path.basename(designPath, rawExt);

  const candidateSchematic = ext === ".kicad_sch" ? designPath : path.join(dir, `${base}.kicad_sch`);
  const rootSchematic = (await isReadable(candidateSchematic)) ? candidateSchematic : null;

  const candidateExport = path.join(dir, `${base}${NETLIST_EXT}`);
  const netlistExport = (await isReadable(candidateExport)) ? candidateExport : null;

  return { name: base, rootSchematic, netlistExport };
};

/**
 * Recursively walk a directory collecting `.kicad_pro` project files.
 * Skips directories that cannot be read (EACCES), mirroring the Cadence walker.
 */
const walkForProjects = async (rootDir: string, maxDepth?: number): Promise<string[]> => {
  const projects: string[] = [];

  const walk = async (currentDir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      // Skip unreadable, missing, or non-directory paths (e.g. permission denied,
      // or a directory removed/replaced mid-walk by a concurrent change).
      const skippable = new Set(["EACCES", "ENOENT", "ENOTDIR"]);
      if (!(error instanceof Error) || !("code" in error) || !skippable.has(String(error.code))) {
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
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".kicad_pro") {
        projects.push(fullPath);
      }
    }
  };

  await walk(rootDir, 0);
  return projects;
};

/**
 * Discover KiCad designs under a directory.
 */
export const discoverKicadDesigns = async (
  rootDir: string,
  options?: { maxDepth?: number }
): Promise<KicadDiscoveredDesign[]> => {
  const absoluteRootDir = path.resolve(rootDir);
  const projectFiles = await walkForProjects(absoluteRootDir, options?.maxDepth);

  const designs = await Promise.all(
    projectFiles.map(async (projectPath): Promise<KicadDiscoveredDesign> => {
      const { name, rootSchematic, netlistExport } = await resolveKicadArtifacts(projectPath);
      return {
        name,
        sourcePath: projectPath,
        format: "kicad",
        rootSchematic,
        netlistExport,
      };
    })
  );

  return designs.sort((a, b) => a.name.localeCompare(b.name));
};

/** Check if a file path is a KiCad design file the handler can process. */
export const isKicadFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return KICAD_EXTENSIONS.includes(ext as (typeof KICAD_EXTENSIONS)[number]);
};
