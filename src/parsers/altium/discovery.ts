/**
 * Altium design discovery module.
 * Finds Altium Designer projects (.PrjPcb) and their schematic files (.SchDoc).
 */

import { open, readFile, readdir } from "fs/promises";
import path from "path";

const ALTIUM_EXTENSIONS = [".prjpcb"] as const;

/**
 * Altium-specific discovered design with schematic document paths.
 */
export interface AltiumDiscoveredDesign {
  name: string;
  sourcePath: string;
  format: "altium";
  schdocPaths: string[];
  error?: string;
}
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Check if a file is an OLE-format SchDoc file.
 */
const isOleSchDoc = async (filePath: string): Promise<boolean> => {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(OLE_MAGIC.length);
    const { bytesRead } = await handle.read(buffer, 0, OLE_MAGIC.length, 0);
    if (bytesRead < OLE_MAGIC.length) {
      return false;
    }
    return buffer.equals(OLE_MAGIC);
  } catch {
    return false;
  } finally {
    if (handle) {
      await handle.close();
    }
  }
};

/**
 * Read SchDoc paths from an Altium project file.
 * Returns absolute paths to valid SchDoc files.
 */
const readProjectSchDocs = async (projectPath: string): Promise<string[]> => {
  let content: string;
  try {
    content = await readFile(projectPath, "utf-8");
  } catch {
    return [];
  }

  const projectDir = path.dirname(projectPath);
  const schdocs = new Set<string>();

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*DocumentPath=(.+)$/i);
    if (!match) continue;

    const rawPath = match[1].trim();
    if (!rawPath) continue;

    const trimmed = rawPath.replace(/^"+|"+$/g, "");
    const pathPart = trimmed.split("|")[0]?.trim();
    if (!pathPart) continue;

    const normalized = pathPart.replace(/\\/g, "/");
    if (!normalized.toLowerCase().endsWith(".schdoc")) {
      continue;
    }

    // Skip absolute paths from the project file
    if (
      path.win32.isAbsolute(normalized) ||
      path.posix.isAbsolute(normalized)
    ) {
      continue;
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(projectDir, normalized);

    if (await isOleSchDoc(absolutePath)) {
      schdocs.add(absolutePath);
    }
  }

  return Array.from(schdocs.values()).sort((a, b) => a.localeCompare(b));
};

/**
 * Walk directory tree to find Altium-related files.
 */
const walkForAltiumFiles = async (
  rootDir: string,
): Promise<{ projects: string[]; schdocs: string[] }> => {
  const projects: string[] = [];
  const schdocs: string[] = [];

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

      if (ext === ".prjpcb") {
        projects.push(fullPath);
      } else if (ext === ".schdoc") {
        if (await isOleSchDoc(fullPath)) {
          schdocs.push(fullPath);
        }
      }
    }
  };

  await walk(rootDir);
  return { projects, schdocs };
};

/**
 * Fallback: find SchDoc files in the project directory if none found in project file.
 */
const fallbackProjectSchDocs = (
  projectDir: string,
  schdocs: string[],
): string[] => {
  const candidates = schdocs.filter((schdoc) => {
    const schdocDir = path.dirname(schdoc);
    return schdocDir === projectDir || schdoc.startsWith(projectDir + path.sep);
  });

  return candidates.length === 1 ? candidates : [];
};

/**
 * Discover Altium designs in a directory.
 */
export const discoverAltiumDesigns = async (
  rootDir: string,
): Promise<AltiumDiscoveredDesign[]> => {
  const absoluteRootDir = path.resolve(rootDir);
  const { projects, schdocs } = await walkForAltiumFiles(absoluteRootDir);

  const designs: AltiumDiscoveredDesign[] = [];

  for (const projectPath of projects) {
    const name = path.basename(projectPath, path.extname(projectPath));
    let schdocPaths = await readProjectSchDocs(projectPath);

    if (schdocPaths.length === 0) {
      const projectDir = path.dirname(projectPath);
      schdocPaths = fallbackProjectSchDocs(projectDir, schdocs);
    }

    const design: AltiumDiscoveredDesign = {
      name,
      format: "altium",
      sourcePath: projectPath,
      schdocPaths,
    };

    if (schdocPaths.length === 0) {
      design.error = `No schematic documents found for project '${name}'.`;
    }

    designs.push(design);
  }

  return designs;
};

/**
 * Find SchDoc files for a specific Altium project file.
 */
export const findAltiumSchDocs = async (
  projectPath: string,
): Promise<string[]> => {
  const schdocPaths = await readProjectSchDocs(projectPath);

  if (schdocPaths.length === 0) {
    // Fallback: scan project directory
    const projectDir = path.dirname(projectPath);
    const { schdocs } = await walkForAltiumFiles(projectDir);
    return fallbackProjectSchDocs(projectDir, schdocs);
  }

  return schdocPaths;
};

/**
 * Check if a file path is an Altium project file.
 */
export const isAltiumFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return ALTIUM_EXTENSIONS.includes(ext as (typeof ALTIUM_EXTENSIONS)[number]);
};

/** Altium file extensions */
export { ALTIUM_EXTENSIONS };
