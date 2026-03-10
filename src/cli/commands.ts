/**
 * CLI command handlers for --version, --help, --update, --uninstall, --export-telemetry,
 * --export-json, and --coverage.
 */

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { VERSION, GITHUB_REPO, BINARY_NAME } from "../version.js";
import { exportTelemetry } from "../telemetry.js";
import { parseDesign } from "../parsers/index.js";
import {
  discoverCadenceDesigns,
  findCadenceDatFiles,
  parseDsnFile,
  parseCadence,
  buildCadencePinMap,
} from "../parsers/cadence/index.js";
import { exportCadenceNetlist } from "../service.js";
import { isErrorResult } from "../types.js";
import { analyzeCoverage, formatCoverageReport, type CoverageResult } from "../coverage.js";
import { checkForUpdate, performUpdate, isNpmInstall } from "./updater.js";
import { confirm } from "./prompts.js";
import { removeFromPath } from "./shell.js";

/**
 * Print version information.
 */
export const printVersion = (): void => {
  console.log(`${BINARY_NAME} v${VERSION}`);
};

/**
 * Print help message.
 */
export const printHelp = (): void => {
  console.log(
    `
${BINARY_NAME} v${VERSION}

MCP server for querying EDA netlists. Supports Cadence and Altium Designer formats.

USAGE:
  ${BINARY_NAME} [OPTIONS]

OPTIONS:
  --version, -v        Print version and exit
  --help, -h           Show this help message
  --update             Check for and install updates
  --uninstall          Remove binary and PATH entries
  --export-telemetry   Export telemetry data as a zip file
  --coverage [path]    Compare DSN parser output against DAT netlist exports
  --verbose            Show per-design field mismatch breakdowns (with --coverage)

INSTALLATION:
  curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | bash

MORE INFO:
  https://github.com/${GITHUB_REPO}
`.trim()
  );
};

/**
 * Handle --update command.
 * Checks for updates and installs if available.
 * For npm installs, directs users to use npm update instead.
 */
export const handleUpdateCommand = async (): Promise<void> => {
  // For npm installs, provide npm-specific update instructions
  if (isNpmInstall()) {
    console.log(`Checking for updates...`);

    const check = await checkForUpdate();

    if (check.error) {
      console.error(`Error checking for updates: ${check.error}`);
      process.exit(1);
    }

    if (!check.updateAvailable) {
      console.log(`Already at latest version (${VERSION})`);
      return;
    }

    console.log(`Update available: ${VERSION} -> ${check.latestVersion}`);
    console.log("");
    console.log("To update, run:");
    console.log("  npm update -g universal-netlist");
    return;
  }

  console.log(`Checking for updates...`);

  const check = await checkForUpdate();

  if (check.error) {
    console.error(`Error checking for updates: ${check.error}`);
    process.exit(1);
  }

  if (!check.updateAvailable) {
    console.log(`Already at latest version (${VERSION})`);
    return;
  }

  console.log(`Update available: ${VERSION} -> ${check.latestVersion}`);

  if (!check.downloadUrl) {
    console.error("No download URL available for your platform");
    process.exit(1);
  }

  console.log("Downloading update...");
  const result = await performUpdate(check.downloadUrl, check.latestVersion!);

  if (!result.success) {
    console.error(`Update failed: ${result.error}`);
    process.exit(1);
  }

  console.log(`Updated from ${result.previousVersion} to ${result.newVersion}`);
  console.log("Please restart to use the new version.");
};

/**
 * Get the path to the current executable.
 */
const getCurrentExecutablePath = (): string => {
  if (process.execPath.includes("node") || process.execPath.includes("bun")) {
    return process.argv[1];
  }
  return process.execPath;
};

/**
 * Handle --uninstall command.
 * Removes the binary and PATH entries from shell rc files.
 */
export const handleUninstallCommand = async (): Promise<void> => {
  const confirmed = await confirm(`This will remove ${BINARY_NAME} from your system. Continue?`);
  if (!confirmed) {
    console.log("Uninstall cancelled");
    return;
  }

  const binaryPath = getCurrentExecutablePath();
  const binDir = dirname(binaryPath);
  const installDir = dirname(binDir);

  // Remove PATH entries from shell rc files
  console.log("Removing PATH entries...");
  const modifiedFiles = removeFromPath();
  if (modifiedFiles.length > 0) {
    console.log(`Modified: ${modifiedFiles.join(", ")}`);
  }

  // Remove install directory
  console.log(`Removing install directory: ${installDir}`);
  if (existsSync(installDir)) {
    try {
      rmSync(installDir, { recursive: true });
    } catch (error) {
      console.error(
        `Failed to remove directory: ${error instanceof Error ? error.message : error}`
      );
      console.log("You may need to remove it manually.");
    }
  }

  console.log("");
  console.log(`${BINARY_NAME} has been uninstalled.`);
};

/**
 * Handle --export-telemetry command.
 * Exports telemetry data as a zip file in the current working directory.
 */
export const handleExportTelemetryCommand = async (): Promise<void> => {
  try {
    const zipPath = await exportTelemetry();
    console.log(zipPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

/**
 * Handle --export-json command.
 * Parses a design file and writes the universal netlist JSON to cwd.
 */
export const handleExportJsonCommand = async (designPath?: string): Promise<void> => {
  if (!designPath) {
    console.error("Usage: universal-netlist --export-json <path>");
    process.exit(1);
  }

  const absolutePath = resolve(designPath);
  const result = await parseDesign(absolutePath);
  const name = basename(absolutePath, extname(absolutePath));
  const outFile = resolve(`${name}.json`);
  writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
  console.log(outFile);
};

/**
 * Handle --coverage command.
 * Compares DSN parser output against DAT netlist exports for Cadence designs.
 * Writes a markdown report to the current working directory.
 */
export const handleCoverageCommand = async (
  searchPath?: string,
  verbose?: boolean
): Promise<void> => {
  const resolvedPath = resolve(searchPath ?? ".");
  const designs = await discoverCadenceDesigns(resolvedPath);
  const dsnDesigns = designs.filter((d) => d.format === "cadence-cis");

  if (dsnDesigns.length === 0) {
    console.error(`No Cadence .DSN files found in ${resolvedPath}`);
    process.exit(1);
  }

  console.error("");
  console.error(`Found ${dsnDesigns.length} DSN design(s) in ${resolvedPath}`);

  const results: CoverageResult[] = [];

  for (const design of dsnDesigns) {
    let { datFiles } = design;

    // On Windows, attempt export if .dat files are missing
    if (!datFiles.pstxnet && process.platform === "win32") {
      console.error(`Exporting netlist for ${design.name}...`);
      const exportResult = await exportCadenceNetlist(design.sourcePath);
      if (isErrorResult(exportResult)) {
        console.error(`  Export failed: ${exportResult.error}`);
      } else {
        datFiles = await findCadenceDatFiles(design.sourcePath);
      }
    }

    if (!datFiles.pstxnet || !datFiles.pstxprt) {
      console.error(`Skipping ${design.name}: no .dat files found`);
      continue;
    }

    try {
      console.error(`  Analyzing ${design.name}...`);
      const dsn = parseDsnFile(design.sourcePath);
      const raw = await parseCadence({
        pstxnetPath: datFiles.pstxnet,
        pstxprtPath: datFiles.pstxprt,
        pstchipPath: datFiles.pstchip ?? undefined,
      });
      const datComponents = buildCadencePinMap(raw.nets, raw.components, raw.chips, raw.partNames);
      const dat = { nets: raw.nets, components: datComponents };

      results.push(analyzeCoverage(design.name, dsn, dat));
    } catch (e: unknown) {
      console.error(`ERROR parsing ${design.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (results.length === 0) {
    console.error("No designs could be analyzed (all skipped or errored)");
    process.exit(1);
  }

  // Terminal output: plain text, truncated verbose sections
  const terminalReport = formatCoverageReport(results, { verbose });
  console.log(terminalReport);

  // File output: markdown with full verbose (no truncation) when verbose is enabled
  const fileReport = formatCoverageReport(results, { verbose, truncate: false, markdown: true });
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const outFile = resolve(`dsn-vs-dat-coverage-${ts}.md`);
  writeFileSync(outFile, fileReport + "\n");
  console.error(`\nExported to:\n${outFile}`);
};
