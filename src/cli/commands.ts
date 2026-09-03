/**
 * CLI command handlers for --version, --help, --update, --uninstall, --export-telemetry,
 * --export-json, and --coverage.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { VERSION, GITHUB_REPO, BINARY_NAME } from "../version.js";
import { SELF_UPDATE_ENABLED } from "../build-flags.js";
import { exportTelemetry } from "../telemetry/index.js";
import { findHandler, parseDesign } from "../parsers/index.js";
import { parseDsnFile, parseCadence, buildCadencePinMap } from "../parsers/cadence/index.js";
import { discoverCadenceDesignsWithDat } from "../parsers/cadence/discovery.js";
import { exportCadenceNetlist } from "../service/index.js";
import { isErrorResult } from "../types.js";
import {
  analyzeCoverage,
  formatCoverageReport,
  type CoverageResult,
} from "../dsn-vs-dat-coverage.js";
import { checkForUpdate, performUpdate, isNpmInstall } from "./updater.js";
import {
  isUniversalFile,
  parseUniversalNetlistDocument,
  serializeUniversalNetlist,
  type UniversalNetlistOrigin,
  universalDesignName,
} from "../parsers/universal/index.js";
import { confirm } from "./prompts.js";
import { removeFromPath } from "./shell.js";
import { getCurrentExecutablePath } from "./executable.js";

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
  // A packaged build was installed by a package manager, so the install line
  // that applies to it is that manager's, not this repo's install.sh.
  const installation = SELF_UPDATE_ENABLED
    ? `  curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | bash`
    : `  Installed and updated by your package manager.`;

  console.log(
    `
${BINARY_NAME} v${VERSION}

Usage: ${BINARY_NAME} [options] [command]

MCP server for querying EDA netlists: Cadence, Altium Designer, KiCad, and Universal Netlist JSON.
An MCP client runs the binary with no command and speaks to it over stdio; the commands
below are what you run by hand.

Options:
  -v, --version        Output the version number
  -h, --help           Display help for command
  --verbose            Show per-design field mismatch breakdowns (with coverage)

Commands:
  update|upgrade       Check for updates and install if available
  uninstall            Remove the binary and its PATH entries
  export-telemetry     Export telemetry data as a zip file
  export-json <design> [out.netlist.json]
                       Write a design's netlist as Universal Netlist JSON
  coverage [path]      Compare DSN parser output against DAT netlist exports

Installation:
${installation}

More info:
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
  // A packaged build's file belongs to the package manager that installed it,
  // so the update belongs there too.
  if (!SELF_UPDATE_ENABLED) {
    console.log(`${BINARY_NAME} v${VERSION} was installed by a package manager.`);
    console.log("Update it the way you installed it.");
    return;
  }

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
 * Handle --uninstall command.
 * Removes the binary and PATH entries from shell rc files.
 */
export const handleUninstallCommand = async (): Promise<void> => {
  // Deleting a packaged install directory would leave the package manager
  // believing it is still installed, so leave the files where they are.
  if (!SELF_UPDATE_ENABLED) {
    console.log(`${BINARY_NAME} v${VERSION} was installed by a package manager.`);
    console.log("Remove it the way you installed it.");
    return;
  }

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
 * Handle the export-json command.
 *
 * Parses a design file and writes its netlist as Universal Netlist JSON
 * (docs/schemas/universal-netlist.md), to `<design>.netlist.json` in the working
 * directory or to the given output path. The written file is itself a design
 * every tool reads.
 */
export const handleExportJsonCommand = async (
  designPath?: string,
  outPath?: string
): Promise<void> => {
  if (!designPath) {
    console.error("Usage: universal-netlist export-json <design> [output.netlist.json]");
    process.exit(1);
  }

  const absolutePath = resolve(designPath);
  let result;
  let origin: UniversalNetlistOrigin;
  try {
    if (isUniversalFile(absolutePath)) {
      const document = parseUniversalNetlistDocument(
        readFileSync(absolutePath, "utf-8"),
        basename(absolutePath)
      );
      result = { nets: document.nets, components: document.components };
      origin = document.metadata.origin;
    } else {
      const handler = findHandler(absolutePath);
      if (!handler || handler.name === "universal") {
        throw new Error(`Unsupported design format: ${absolutePath}`);
      }
      result = await parseDesign(absolutePath);
      const vendor =
        handler.name === "cadence"
          ? "Cadence"
          : handler.name === "altium"
            ? "Altium"
            : handler.name === "kicad"
              ? "KiCad"
              : handler.name;
      origin = {
        type: "vendor",
        source: { vendor, fileType: extname(absolutePath).toLowerCase() },
      };
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  if (outPath && !isUniversalFile(outPath)) {
    console.error("Universal Netlist output paths must end in .netlist.json");
    process.exit(1);
  }
  const name = isUniversalFile(absolutePath)
    ? universalDesignName(absolutePath)
    : basename(absolutePath, extname(absolutePath));
  const outFile = resolve(outPath ?? `${name}.netlist.json`);
  writeFileSync(outFile, serializeUniversalNetlist(result, { origin }));
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
  const designs = await discoverCadenceDesignsWithDat(resolvedPath);
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
        // The export already reports the directory it wrote, and it has verified
        // all three files came from this run. Re-deriving the location instead
        // could land on a different directory than the one just written.
        datFiles = {
          pstxnet: join(exportResult.outputDir, "pstxnet.dat"),
          pstxprt: join(exportResult.outputDir, "pstxprt.dat"),
          pstchip: join(exportResult.outputDir, "pstchip.dat"),
        };
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
