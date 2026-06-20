/**
 * Locate and invoke `kicad-cli` to export a resolved netlist.
 *
 * This is the impure shell around KiCad. The preferred path is to parse a
 * committed `.net` export (see index.ts); this module is the runtime fallback
 * used when only raw `.kicad_sch` files are available and KiCad is installed.
 *
 * Resolution order for the binary:
 *   1. `KICAD_CLI_PATH` environment variable (explicit override)
 *   2. Known per-platform install locations
 *   3. `kicad-cli` on the system PATH
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

/** Default timeout (ms) for a kicad-cli export; override with KICAD_CLI_TIMEOUT. */
const DEFAULT_EXPORT_TIMEOUT_MS = 120_000;

/** Resolve the export timeout, falling back to the default for unset/invalid values. */
const exportTimeoutMs = (): number => {
  const parsed = Number(process.env.KICAD_CLI_TIMEOUT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXPORT_TIMEOUT_MS;
};

/** Per-platform default install locations for the kicad-cli binary. */
const PLATFORM_DEFAULTS: Record<string, string[]> = {
  darwin: ["/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"],
  win32: [
    "C:/Program Files/KiCad/10.0/bin/kicad-cli.exe",
    "C:/Program Files/KiCad/9.0/bin/kicad-cli.exe",
    "C:/Program Files/KiCad/8.0/bin/kicad-cli.exe",
  ],
  linux: ["/usr/bin/kicad-cli", "/usr/local/bin/kicad-cli"],
};

// Checks X_OK (executable) — a kicad-cli candidate must be runnable. Note
// discovery.ts has a same-named helper that checks R_OK (readable) instead.
const fileExists = async (p: string): Promise<boolean> => {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolve a usable `kicad-cli` command. Returns the first candidate that exists,
 * falling back to the bare name `kicad-cli` (resolved against PATH at exec time).
 * Returns null only when an explicit `KICAD_CLI_PATH` is set but missing.
 */
export const resolveKicadCli = async (): Promise<string | null> => {
  const override = process.env.KICAD_CLI_PATH;
  if (override) {
    return (await fileExists(override)) ? override : null;
  }

  for (const candidate of PLATFORM_DEFAULTS[process.platform] ?? []) {
    if (await fileExists(candidate)) return candidate;
  }

  // Fall back to PATH lookup; execFile will error if it is not installed.
  return "kicad-cli";
};

/** True when a kicad-cli binary appears to be available. */
export const isKicadCliAvailable = async (): Promise<boolean> => {
  const cli = await resolveKicadCli();
  if (cli === null) return false;
  if (cli === "kicad-cli") {
    try {
      await execFileAsync(cli, ["version"]);
      return true;
    } catch {
      return false;
    }
  }
  return true;
};

/**
 * Generate a kicadsexpr netlist for a root `.kicad_sch` and return its contents.
 * Writes to a temporary file (kicad-cli requires an output path), reads it back,
 * and cleans up. Throws if kicad-cli is unavailable or the export fails.
 */
export const exportNetlist = async (rootSchematicPath: string): Promise<string> => {
  const cli = await resolveKicadCli();
  if (cli === null) {
    throw new Error(
      `kicad-cli not found at KICAD_CLI_PATH="${process.env.KICAD_CLI_PATH}". ` +
        `Unset it or point it at a valid kicad-cli binary.`
    );
  }

  const timeout = exportTimeoutMs();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kicad-netlist-"));
  const outPath = path.join(tmpDir, "netlist.net");
  try {
    await execFileAsync(
      cli,
      ["sch", "export", "netlist", "--format", "kicadsexpr", "-o", outPath, rootSchematicPath],
      { timeout }
    );
    return await readFile(outPath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // execFile sets `killed` when it terminates the process on timeout.
    const timedOut = typeof error === "object" && error !== null && "killed" in error && Boolean((error as { killed?: boolean }).killed);
    const suffix = timedOut
      ? ` (timed out after ${timeout}ms; raise KICAD_CLI_TIMEOUT for very large designs)`
      : "";
    throw new Error(`kicad-cli netlist export failed for ${rootSchematicPath}: ${message}${suffix}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
};
