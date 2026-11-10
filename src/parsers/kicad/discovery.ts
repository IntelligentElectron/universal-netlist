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
 * `board-tester/data-center-board-tester.kicad_pro`.)
 */

import path from "node:path";
import type { DiscoverDesignsOptions } from "../../types.js";
import { listDir, nodeFileReader, readText, type FileReader } from "../context.js";

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
  designPath: string,
  files: FileReader = nodeFileReader
): Promise<{ name: string; rootSchematic: string | null; netlistExport: string | null }> => {
  const rawExt = path.extname(designPath);
  const ext = rawExt.toLowerCase();
  const dir = path.dirname(designPath);
  // Strip with the original-case extension so an uppercase ".KICAD_PRO" is removed.
  const base = path.basename(designPath, rawExt);

  const candidateSchematic =
    ext === ".kicad_sch" ? designPath : path.join(dir, `${base}.kicad_sch`);
  const rootSchematic = (await files.exists(candidateSchematic)) ? candidateSchematic : null;

  const candidateExport = path.join(dir, `${base}${NETLIST_EXT}`);
  const netlistExport = (await files.exists(candidateExport)) ? candidateExport : null;

  return { name: base, rootSchematic, netlistExport };
};

/** A sheet a KiCad 10 project lists in `schematic.top_level_sheets`. */
export interface KicadTopLevelSheet {
  readonly uuid: string;
  /** The sheet's name, which starts its nets' paths: `/<name>/`. */
  readonly name: string;
  /** The sheet's file, relative to the project. */
  readonly filename: string;
}

/** What a project file says about its schematics. */
export interface KicadProjectSchematic {
  /** Bus aliases (`schematic.bus_aliases`), where KiCad 10 keeps them (issue 211). */
  readonly busAliases: Record<string, string[]>;
  /**
   * The top-level sheets, in project order, when the project lists two or
   * more; empty otherwise. KiCad 10 lets a project hold several top-level
   * sheets that no sheet symbol links, each a page of its own and a root of
   * its own hierarchy. With one, the root schematic is the design, as before.
   */
  readonly topLevelSheets: readonly KicadTopLevelSheet[];
}

const NO_PROJECT_SCHEMATIC: KicadProjectSchematic = { busAliases: {}, topLevelSheets: [] };

/**
 * The schematic settings of a design's project file: bus aliases and
 * top-level sheets. A `.kicad_pro` is read itself; a root `.kicad_sch` reads
 * the project of its name beside it, as kicad-cli does. Nothing for any other
 * path, or a project file that cannot be read.
 */
export const readKicadProjectSchematic = async (
  designPath: string,
  files: FileReader = nodeFileReader
): Promise<KicadProjectSchematic> => {
  const rawExt = path.extname(designPath);
  const ext = rawExt.toLowerCase();
  if (ext !== ".kicad_pro" && ext !== ".kicad_sch") return NO_PROJECT_SCHEMATIC;
  const projectPath =
    ext === ".kicad_pro"
      ? designPath
      : path.join(path.dirname(designPath), `${path.basename(designPath, rawExt)}.kicad_pro`);
  if (ext === ".kicad_sch" && !(await files.exists(projectPath))) return NO_PROJECT_SCHEMATIC;
  let schematic: { bus_aliases?: unknown; top_level_sheets?: unknown } | undefined;
  try {
    schematic = (JSON.parse(await readText(files, projectPath)) as { schematic?: typeof schematic })
      .schematic;
  } catch {
    return NO_PROJECT_SCHEMATIC;
  }
  const busAliases =
    schematic?.bus_aliases && typeof schematic.bus_aliases === "object"
      ? (schematic.bus_aliases as Record<string, string[]>)
      : {};
  const listed = Array.isArray(schematic?.top_level_sheets) ? schematic.top_level_sheets : [];
  const sheets = listed.flatMap((entry: unknown): KicadTopLevelSheet[] => {
    const { uuid, name, filename } = (entry ?? {}) as Record<string, unknown>;
    return typeof uuid === "string" && typeof filename === "string" && filename.trim()
      ? [{ uuid, name: typeof name === "string" ? name : "", filename: filename.trim() }]
      : [];
  });
  // Two or more listed make every one a root, so an entry that cannot be read
  // drops only itself, never the project's other pages.
  return { busAliases, topLevelSheets: listed.length > 1 ? sheets : [] };
};

/**
 * The schematics a design's hierarchy starts from: each top-level sheet of a
 * project that lists two or more, otherwise the root schematic alone.
 */
export const kicadRootSchematics = async (
  designPath: string,
  rootSchematic: string,
  files: FileReader = nodeFileReader
): Promise<string[]> => {
  const { topLevelSheets } = await readKicadProjectSchematic(designPath, files);
  // The listed files are relative to the project, which sits beside the root schematic.
  return topLevelSheets.length
    ? topLevelSheets.map((sheet) => path.resolve(path.dirname(rootSchematic), sheet.filename))
    : [rootSchematic];
};

/**
 * Recursively walk a directory collecting `.kicad_pro` project files.
 * Skips directories that cannot be read (EACCES), mirroring the Cadence walker.
 */
const walkForProjects = async (
  files: FileReader,
  rootDir: string,
  maxDepth?: number
): Promise<string[]> => {
  const projects: string[] = [];

  const walk = async (currentDir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await listDir(files, currentDir);
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
  options?: DiscoverDesignsOptions
): Promise<KicadDiscoveredDesign[]> => {
  const files = options?.context?.files ?? nodeFileReader;
  const absoluteRootDir = path.resolve(rootDir);
  const projectFiles = await walkForProjects(files, absoluteRootDir, options?.maxDepth);

  const designs = await Promise.all(
    projectFiles.map(async (projectPath): Promise<KicadDiscoveredDesign> => {
      const { name, rootSchematic, netlistExport } = await resolveKicadArtifacts(
        projectPath,
        files
      );
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
