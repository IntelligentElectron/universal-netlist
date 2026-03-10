import { exec } from "child_process";
import * as fs from "fs";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import { createMutex } from "./async-mutex.js";
import { resolvePath } from "../../paths.js";
import type { CadenceInstall, ExportNetlistResult, ErrorResult } from "../../types.js";

// Serialize pstswp invocations to prevent concurrent Cadence license conflicts
const serializePstswp = createMutex();

const execAsync = promisify(exec);

/**
 * Convert Windows path to bash-compatible path for GitBash/WSL compatibility.
 * Example: C:\foo\bar -> /c/foo/bar
 */
const toBashPath = (winPath: string): string =>
  winPath
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);

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
 * Resolve the Allegro output directory for netlist export.
 * Uses an existing Allegro/ or allegro/ directory if present, otherwise creates allegro/.
 */
export const resolveAllegroDir = async (
  dsnDir: string
): Promise<{ outputDir: string; dirName: string }> => {
  let dirName = "allegro";
  try {
    const entries = await fs.promises.readdir(dsnDir);
    for (const candidate of ["Allegro", "allegro"]) {
      if (entries.includes(candidate)) {
        dirName = candidate;
        break;
      }
    }
  } catch {
    // parent doesn't exist or can't be read
  }
  const outputDir = path.join(dsnDir, dirName);
  await fs.promises.mkdir(outputDir, { recursive: true });
  return { outputDir, dirName };
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
  const { outputDir, dirName: outputDirName } = await resolveAllegroDir(dsnDir);

  return serializePstswp(async () => {
    // Temporarily relocate .DSNlck lock file if present (stale locks block pstswp)
    const lockTempPath = await relocateLockFile(resolvedDsnPath);

    // Convert to bash paths for command execution (GitBash compatibility)
    const bashDsnDir = toBashPath(dsnDir);
    const pstswp = toBashPath(cadence.pstswp);
    const config = toBashPath(cadence.config);

    const command = `cd "${bashDsnDir}" && "${pstswp}" -pst -d "${dsnFile}" -n "${outputDirName}" -c "${config}" -v 3 -l 255 -j "PCB Footprint"`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        shell: "bash",
        timeout: 120000,
      });

      // List generated files
      let generatedFiles: string[] | undefined;
      try {
        const files = await fs.promises.readdir(outputDir);
        generatedFiles = files.sort();
      } catch {
        // Output directory may not exist if export failed silently
      }

      return {
        success: true,
        outputDir,
        log: (stdout + stderr).trim() || undefined,
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
