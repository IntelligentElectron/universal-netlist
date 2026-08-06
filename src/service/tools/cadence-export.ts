import { exec } from "child_process";
import * as fs from "fs";
import type { Dirent } from "fs";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import { createMutex } from "./async-mutex.js";
import { resolvePath, netlistDirName } from "../../paths.js";
import type { CadenceInstall, ExportNetlistResult, ErrorResult } from "../../types.js";

// Serialize pstswp invocations to prevent concurrent Cadence license conflicts
const serializePstswp = createMutex();

const execAsync = promisify(exec);

/**
 * Detect installed Cadence SPB versions from the standard installation directory.
 *
 * @param cadenceBase - Base Cadence installation directory (default: C:/Cadence)
 * @returns Array of detected Cadence installations, sorted by version descending
 */
export const detectCadenceVersions = async (
  cadenceBase = "C:/Cadence"
): Promise<CadenceInstall[]> => {
  const installs: CadenceInstall[] = [];

  try {
    const entries = await fs.promises.readdir(cadenceBase);

    for (const entry of entries) {
      const match = entry.match(/^SPB_(\d+\.\d+)$/);
      if (!match) continue;

      const version = match[1];
      const root = path.join(cadenceBase, entry);
      const pstswp = path.join(root, "tools", "bin", "pstswp.exe");
      const config = path.join(root, "tools", "capture", "allegro.cfg");

      // Verify the executables exist
      if (fs.existsSync(pstswp) && fs.existsSync(config)) {
        installs.push({ version, root, pstswp, config });
      }
    }

    // Sort by version descending (latest first)
    installs.sort((a, b) => parseFloat(b.version) - parseFloat(a.version));
  } catch {
    // Cadence directory doesn't exist or isn't accessible
  }

  return installs;
};

/**
 * Get the latest installed Cadence version.
 *
 * @returns The latest Cadence installation, or null if none found
 */
export const getLatestCadence = async (): Promise<CadenceInstall | null> => {
  const versions = await detectCadenceVersions();
  return versions[0] ?? null;
};

/**
 * Resolve the output directory for a design's netlist export.
 *
 * pstswp names its output files the same way for every design (`pstxnet.dat`,
 * `pstxprt.dat`, `pstchip.dat`), so two designs exporting to one directory
 * leave only the second design's netlist behind. Each design therefore gets
 * `<design>_netlist/` of its own, which discovery recognises as belonging to
 * that design.
 *
 * The exception is a folder holding a single design that already has an
 * `allegro` directory. That is an established project layout, often pointed at
 * by a PCB editor or a build script, and it cannot collide with anything, so
 * exports keep going there.
 */
export const resolveExportDir = async (
  dsnPath: string
): Promise<{ outputDir: string; dirName: string }> => {
  const dsnDir = path.dirname(dsnPath);
  const designName = path.basename(dsnPath, path.extname(dsnPath));

  let entries: Dirent[] = [];
  try {
    entries = await fs.promises.readdir(dsnDir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist or can't be read; fall through to the per-design name.
  }

  // Both Cadence design kinds count, because Design Entry HDL's netlister writes
  // the same three filenames into the same directory that pstswp does. Counting
  // only .dsn left a CIS design sharing `allegro/` with an HDL sibling, which is
  // the collision this whole function exists to prevent. AppleDouble sidecars
  // (`._NAME.DSN`, written by macOS onto SMB and NFS shares) are not designs.
  const designCount = entries.filter(
    (e) => e.isFile() && !e.name.startsWith("._") && /\.(dsn|cpm)$/i.test(e.name)
  ).length;

  const dirName =
    designCount <= 1 ? ((await legacyExportDir(dsnDir, entries)) ?? netlistDirName(designName))
      : netlistDirName(designName);

  const outputDir = path.join(dsnDir, dirName);
  await fs.promises.mkdir(outputDir, { recursive: true });
  return { outputDir, dirName };
};

/**
 * An existing `allegro` directory beside the design, whatever its case.
 *
 * Real projects ship `Allegro/`, `allegro/` and `ALLEGRO/` alike. It must be a
 * directory: a plain file of that name would otherwise be chosen and the mkdir
 * would fail. When a case-sensitive filesystem holds more than one spelling,
 * the one already holding a netlist is the live one; the rest are strays, and a
 * stray empty directory would silently become the export target while consumers
 * kept reading the real one.
 */
const legacyExportDir = async (dsnDir: string, entries: Dirent[]): Promise<string | undefined> => {
  const candidates = entries
    .filter((e) => e.isDirectory() && e.name.toLowerCase() === "allegro")
    .map((e) => e.name)
    .sort();
  if (candidates.length <= 1) return candidates[0];

  for (const name of candidates) {
    try {
      await fs.promises.access(path.join(dsnDir, name, "pstxnet.dat"));
      return name;
    } catch {
      // Not this one.
    }
  }
  return candidates[0];
};

/**
 * Temporarily relocate a .DSNlck lock file so pstswp can proceed.
 * Returns the temporary path if relocated, or undefined if no lock file exists.
 */
export const relocateLockFile = async (dsnPath: string): Promise<string | undefined> => {
  const lockPath = dsnPath.replace(/\.DSN$/i, ".DSNlck");
  try {
    await fs.promises.access(lockPath);
  } catch {
    return undefined;
  }
  const tempPath = path.join(tmpdir(), `${path.basename(lockPath)}.${Date.now()}`);
  await fs.promises.rename(lockPath, tempPath);
  return tempPath;
};

/**
 * Restore a previously relocated .DSNlck lock file.
 * Logs a warning if restoration fails (e.g. temp file was cleaned up).
 */
export const restoreLockFile = async (dsnPath: string, tempPath: string): Promise<void> => {
  const lockPath = dsnPath.replace(/\.DSN$/i, ".DSNlck");
  try {
    await fs.promises.rename(tempPath, lockPath);
  } catch {
    console.warn(`Failed to restore lock file. Temporary location: ${tempPath}`);
  }
};

/**
 * Export Cadence schematic netlist to Allegro PCB format.
 * Uses the pstswp utility from Cadence SPB installation.
 *
 * @param dsnPath - Path to .DSN schematic file
 * @returns Export result with output directory and generated files, or error
 */
export const exportCadenceNetlist = async (
  dsnPath: string
): Promise<ExportNetlistResult | ErrorResult> => {
  // Platform check
  if (process.platform !== "win32") {
    return {
      error:
        "Cadence export tools are only available on Windows. The pstswp utility requires a Windows environment with Cadence SPB installed. Manual export: Open Cadence, then: Tools → Create Netlist → PCB Editor format.",
    };
  }

  // Find Cadence installation
  const cadence = await getLatestCadence();
  if (!cadence) {
    return {
      error:
        "No Cadence SPB installation found in C:/Cadence. Ensure Cadence Design Entry CIS or HDL is installed. Manual export: Open Cadence, then: Tools → Create Netlist → PCB Editor format.",
    };
  }

  const resolvedDsnPath = resolvePath(dsnPath);
  const dsnDir = path.dirname(resolvedDsnPath);
  const dsnFile = path.basename(dsnPath);

  // Creating the directory can fail on its own (a read-only share, an ACL, a
  // name already taken by something that is not a directory). This function
  // promises an ErrorResult rather than a rejection: a rejection escapes as a
  // raw MCP error and aborts the CLI's per-design loop entirely.
  let outputDir: string;
  let outputDirName: string;
  try {
    ({ outputDir, dirName: outputDirName } = await resolveExportDir(resolvedDsnPath));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Could not create the netlist output directory beside ${dsnFile}: ${message}. Manual export: Open Cadence, then: Tools → Create Netlist → PCB Editor format.`,
    };
  }

  return serializePstswp(async () => {
    // Temporarily relocate .DSNlck lock file if present (stale locks block pstswp)
    const lockTempPath = await relocateLockFile(resolvedDsnPath);

    const command = `cd /d "${dsnDir}" && "${cadence.pstswp}" -pst -d "${dsnFile}" -n "${outputDirName}" -c "${cadence.config}" -v 3 -l 255 -j "PCB Footprint"`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        shell: "cmd.exe",
        timeout: 120000,
      });

      // pstswp can exit cleanly having written nothing where we expect it, and
      // reporting success with an empty directory sends the caller to look for
      // files that are not there. The netlist itself is the evidence.
      let generatedFiles: string[] | undefined;
      try {
        generatedFiles = (await fs.promises.readdir(outputDir)).sort();
      } catch {
        // Output directory may not exist if export failed silently
      }

      const log = (stdout + stderr).trim() || undefined;
      if (!generatedFiles?.some((f) => f.toLowerCase() === "pstxnet.dat")) {
        return {
          error:
            `Cadence pstswp reported success but wrote no netlist to ${outputDir}. ` +
            `Check the log for the directory it actually used.${log ? ` Log: ${log}` : ""}`,
        };
      }

      return {
        success: true,
        outputDir,
        log,
        cadenceVersion: cadence.version,
        generatedFiles,
      };
    } catch (err: unknown) {
      const execError = err as {
        message?: string;
        stdout?: string;
        stderr?: string;
      };
      const lockNote = lockTempPath
        ? ` A .DSNlck lock file was found and temporarily relocated — this is often the cause of pstswp failures.`
        : "";
      return {
        error: `Cadence pstswp failed: ${execError.message ?? "Unknown error"}${lockNote}`,
      };
    } finally {
      if (lockTempPath) {
        await restoreLockFile(resolvedDsnPath, lockTempPath);
      }
    }
  });
};
