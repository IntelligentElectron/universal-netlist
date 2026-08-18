import { exec } from "child_process";
import * as fs from "fs";
import type { Dirent } from "fs";
import path from "path";
import { promisify } from "util";
import { createMutex } from "./async-mutex.js";
import {
  resolvePath,
  netlistDirName,
  isNetlistDirFor,
  getDesignName,
  REQUIRED_DAT_FILES,
} from "../../paths.js";
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
): Promise<{ outputDir: string; dirName: string; created: boolean }> => {
  const dsnDir = path.dirname(dsnPath);
  const designName = getDesignName(dsnPath);

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
    (e) => !e.isDirectory() && !e.name.startsWith("._") && /\.(dsn|cpm)$/i.test(e.name)
  ).length;

  // An existing export directory is checked before the legacy one because that
  // is the order discovery reads them in: `scoreDatSetMatch` ranks
  // `<design>_netlist/` above a bare `allegro/` by the whole export bonus.
  // Writing to `allegro/` while every reader reads `<design>_netlist/` reported
  // success on each re-export and left every query answering from a netlist
  // that had stopped updating.
  const existingExportDir = entries.find(
    (e) => !e.name.startsWith("._") && isNetlistDirFor(e.name, designName)
  )?.name;

  const dirName = cmdSafeDirName(
    existingExportDir ??
      (designCount <= 1
        ? ((await legacyExportDir(dsnDir, entries)) ?? netlistDirName(designName))
        : netlistDirName(designName))
  );

  const outputDir = path.join(dsnDir, dirName);
  // Whether this run brought the directory into being decides whether a failed
  // export may remove it again: nothing of the caller's can be inside a
  // directory that did not exist a moment ago.
  let created = false;
  try {
    created = (await fs.promises.mkdir(outputDir, { recursive: true })) !== undefined;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
  }
  return { outputDir, dirName, created };
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
  const named = entries
    .filter((e) => e.name.toLowerCase() === "allegro")
    .map((e) => e.name)
    .sort();

  // stat, not Dirent.isDirectory(): a symlink or a Windows directory junction
  // reports false there, and pointing `allegro` at a shared netlist drop is a
  // normal way to set up exactly the layout this branch exists to preserve.
  const candidates: string[] = [];
  for (const name of named) {
    try {
      if ((await fs.promises.stat(path.join(dsnDir, name))).isDirectory()) candidates.push(name);
    } catch {
      // Broken link or vanished entry; not a usable output directory.
    }
  }
  if (candidates.length <= 1) return candidates[0];

  // Several spellings can only coexist on a case-sensitive filesystem. The one
  // already holding a netlist is the live one; an empty stray would silently
  // become the export target while consumers kept reading the real directory.
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

/** Modification time of each required .dat file present in a directory. */
const datFileTimestamps = async (dir: string): Promise<Map<string, number>> => {
  const stamps = new Map<string, number>();
  await Promise.all(
    REQUIRED_DAT_FILES.map(async (name) => {
      try {
        const st = await fs.promises.stat(path.join(dir, name));
        stamps.set(name, st.mtimeMs);
      } catch {
        // Absent, which is what an unwritten file looks like.
      }
    })
  );
  return stamps;
};

/** pstswp at -v 3 -l 255 can emit megabytes; an error message carries the tail. */
const truncateLog = (log: string): string => (log.length <= 2000 ? log : `...${log.slice(-2000)}`);

/**
 * A directory name cmd.exe will pass through to pstswp unchanged.
 *
 * The command runs through cmd.exe, which expands `%NAME%` inside double quotes.
 * `%` is a legal character in a Windows filename, so a design called
 * `BOARD%TEMP%.DSN` had its export directory created under one name and pstswp
 * told to write to another. (`"` needs no handling: Windows does not allow it in
 * a filename at all, which is what keeps the surrounding quotes intact.)
 */
const cmdSafeDirName = (dirName: string): string => dirName.replace(/%/g, "_");

/** The lock file OrCAD Capture holds beside an open design, if this is a .DSN. */
const lockFilePathFor = (dsnPath: string): string | undefined =>
  /\.DSN$/i.test(dsnPath) ? dsnPath.replace(/\.DSN$/i, ".DSNlck") : undefined;

/**
 * Temporarily relocate a .DSNlck lock file so pstswp can proceed.
 * Returns the temporary path if relocated, or undefined if no lock file exists.
 *
 * The path must be checked for the .DSN extension first. `replace` returns the
 * string unchanged when the pattern does not match, so for any other path the
 * lock path WAS the design path, and this function moved the design itself into
 * the temp directory. `list_designs` hands out `pstxnet.dat` for a dat-only
 * design and the `.cpm` for an HDL one, so that was reachable by following the
 * documented workflow.
 *
 * The lock moves to a sibling name rather than to `tmpdir()`. These designs live
 * on mapped and UNC shares, where a rename into the local temp directory crosses
 * volumes and raises EXDEV, so no design on a share could be exported at all.
 * A sibling rename stays on one filesystem, and if the process dies before the
 * restore, what is left beside the design is an inert `.DSNlck.<ts>.bak` rather
 * than a lock stranded in a directory the operating system may clear.
 */
export const relocateLockFile = async (dsnPath: string): Promise<string | undefined> => {
  const lockPath = lockFilePathFor(dsnPath);
  if (!lockPath) return undefined;
  try {
    await fs.promises.access(lockPath);
  } catch {
    return undefined;
  }
  const tempPath = `${lockPath}.${Date.now()}.bak`;
  await fs.promises.rename(lockPath, tempPath);
  return tempPath;
};

/**
 * Restore a previously relocated .DSNlck lock file.
 * Logs a warning if restoration fails (e.g. temp file was cleaned up).
 */
export const restoreLockFile = async (dsnPath: string, tempPath: string): Promise<void> => {
  const lockPath = lockFilePathFor(dsnPath);
  if (!lockPath) return;
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
  // Argument validation first: it does not depend on the platform, and every
  // path below assumes a .DSN. pstswp needs the schematic, and the lock-file
  // handling derives its path by substituting the .DSN extension.
  if (!/\.DSN$/i.test(dsnPath)) {
    return {
      error: `export_cadence_netlist needs the .DSN schematic, not ${path.basename(dsnPath)}. For an HDL (.cpm) design, export from Cadence: Tools → Create Netlist → PCB Editor format.`,
    };
  }

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
  let createdOutputDir = false;
  try {
    ({
      outputDir,
      dirName: outputDirName,
      created: createdOutputDir,
    } = await resolveExportDir(resolvedDsnPath));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Could not create the netlist output directory beside ${dsnFile}: ${message}. Manual export: Open Cadence, then: Tools → Create Netlist → PCB Editor format.`,
    };
  }

  const result = await serializePstswp(async () => {
    // Everything below the mutex reports failure as an ErrorResult. Relocating
    // the lock file is a rename that can fail on its own: the lock exists
    // because Capture holds the design open, and a rename to the temp directory
    // crosses volumes whenever the project lives on a mapped or UNC share.
    let lockTempPath: string | undefined;
    try {
      lockTempPath = await relocateLockFile(resolvedDsnPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        error: `Could not move the .DSNlck lock file aside for ${dsnFile}: ${message}. Close the design in Cadence and try again.`,
      };
    }

    // What was already in the output directory before this run. mkdir(recursive)
    // reuses an existing directory and nothing clears it, so a previous run's
    // netlist would otherwise make a run that wrote nothing look successful.
    const before = await datFileTimestamps(outputDir);

    const command = `cd /d "${dsnDir}" && "${cadence.pstswp}" -pst -d "${dsnFile}" -n "${outputDirName}" -c "${cadence.config}" -v 3 -l 255 -j "PCB Footprint"`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        shell: "cmd.exe",
        timeout: 120000,
        // -v 3 -l 255 is the most verbose setting pstswp has, and on a large
        // board it emits megabytes. Node's default cap is 1 MiB, and it does not
        // detach the child at the cap, it kills it: the export died partway
        // through writing the netlist and the failure was reported as Cadence's
        // ("stdout maxBuffer length exceeded"), deterministically, on exactly the
        // largest designs, whose exports are the ones worth having.
        maxBuffer: 64 * 1024 * 1024,
      });

      // pstswp can exit cleanly having written nothing where we expect it, and
      // reporting success then sends the caller to read files that are missing,
      // or worse, a previous run's. Every consumer needs the whole trio:
      // discovery only forms a dat set when all three exist. So the evidence is
      // all three present AND written by this run.
      let generatedFiles: string[] | undefined;
      let listError: string | undefined;
      try {
        generatedFiles = (await fs.promises.readdir(outputDir)).sort();
      } catch (err: unknown) {
        listError = err instanceof Error ? err.message : String(err);
      }

      const log = (stdout + stderr).trim() || undefined;
      if (listError !== undefined) {
        return { error: `Could not read the export directory ${outputDir}: ${listError}` };
      }

      // Strictly newer, not merely different: a file carrying an older stamp
      // than before the run (a timestamp-preserving copy dropped in, a clock
      // stepping back) is not something this run wrote.
      const after = await datFileTimestamps(outputDir);
      const stale = REQUIRED_DAT_FILES.filter((f) => {
        const now = after.get(f);
        if (now === undefined) return true; // never written
        const then = before.get(f);
        return then !== undefined && now <= then;
      });
      if (stale.length > 0) {
        const missing = REQUIRED_DAT_FILES.filter((f) => after.get(f) === undefined);
        return {
          error:
            (missing.length > 0
              ? `Cadence pstswp reported success but did not write ${missing.join(", ")} to ${outputDir}.`
              : `Cadence pstswp reported success but left ${stale.join(", ")} in ${outputDir} unchanged, so the netlist there is from an earlier run.`) +
            ` Check the log for the directory it actually used.${log ? ` Log: ${truncateLog(log)}` : ""}`,
        };
      }

      return {
        success: true,
        outputDir,
        // Truncated on the way out, not only on the error path. server.ts
        // JSON-stringifies this straight into the MCP text content, so an
        // untruncated log put the whole of pstswp's most verbose output into the
        // caller's context on every successful export, for a payload whose
        // useful content is the output directory and three filenames.
        log: log === undefined ? undefined : truncateLog(log),
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

  // A directory this run brought into being holds nothing but this run's output,
  // so a failed export takes it away again. Left behind, a half-written trio
  // outranks the intact netlist beside it by the whole export bonus, and every
  // later query reads the truncated files with nothing reporting a problem.
  if ("error" in result && createdOutputDir) {
    try {
      await fs.promises.rm(outputDir, { recursive: true, force: true });
    } catch {
      // Best effort: an empty or partial directory is not worth failing over,
      // and the error already being returned is the more useful one.
    }
  }

  return result;
};
