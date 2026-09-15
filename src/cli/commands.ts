/**
 * CLI command handlers for --version, --help, --update, --uninstall, --export-telemetry,
 * and --export-json.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { VERSION, GITHUB_REPO, BINARY_NAME, NPM_PACKAGE } from "../version.js";
import { SELF_UPDATE_ENABLED } from "../build-flags.js";
import { exportTelemetry } from "../telemetry/index.js";
import { findHandler, parseDesign } from "../parsers/index.js";
import { checkForUpdate, performUpdate } from "./updater.js";
import {
  isUniversalFile,
  parseUniversalNetlistDocument,
  serializeUniversalNetlist,
  type UniversalNetlistOrigin,
  universalDesignName,
} from "../parsers/universal/index.js";
import { confirm } from "./prompts.js";
import { removeFromPath } from "./shell.js";
import { getCurrentExecutablePath, isCompiledBinary } from "./executable.js";

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

Commands:
  update|upgrade       Check for updates and install if available
  uninstall            Remove the binary and its PATH entries
  export-telemetry     Export telemetry data as a zip file
  export-json <design> [out.netlist.json]
                       Write a design's netlist as Universal Netlist JSON

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

  // Under Node.js or Bun the files belong to npm or a checkout, so only the
  // standalone binary replaces itself.
  if (!isCompiledBinary()) {
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
    console.log(`  npm update -g ${NPM_PACKAGE}`);
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

  // Under Node.js or Bun the files belong to npm or a checkout, so only the
  // standalone binary removes itself.
  if (!isCompiledBinary()) {
    console.log(
      `${BINARY_NAME} v${VERSION} runs under ${basename(process.execPath)}, not as the standalone binary.`
    );
    console.log(`Remove an npm install with: npm uninstall -g ${NPM_PACKAGE}`);
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
  const modifiedFiles = removeFromPath(binDir);
  if (modifiedFiles.length > 0) {
    console.log(`Modified: ${modifiedFiles.join(", ")}`);
  }

  // The binary and its update backups go wherever they are. The files and directories
  // around them go only in the installer's `universal-netlist/bin/` layout, a directory
  // only once empty: anywhere else they may belong to something else.
  const installerLayout = basename(binDir) === "bin" && basename(installDir) === BINARY_NAME;
  const backups = listDirectory(binDir)
    .filter((file) => file.startsWith(`${basename(binaryPath)}.backup.`))
    .map((file) => join(binDir, file));
  const files = [
    binaryPath,
    ...backups,
    ...(installerLayout ? INSTALL_FILES.map((file) => join(installDir, file)) : []),
  ];
  const remaining: string[] = [];
  const remove = (path: string, run: () => void): void => {
    try {
      run();
      console.log(`Removed ${path}`);
    } catch (error) {
      remaining.push(`${path} (${error instanceof Error ? error.message : error})`);
    }
  };
  for (const file of files.filter((path) => existsSync(path))) {
    remove(file, () => unlinkSync(file));
  }
  for (const directory of installerLayout ? [binDir, installDir] : []) {
    if (existsSync(directory) && listDirectory(directory).length === 0) {
      remove(directory, () => rmdirSync(directory));
    }
  }

  const telemetryLog = join(installDir, "telemetry.jsonl");
  if (!installerLayout && existsSync(telemetryLog)) {
    console.log(`Left in place, outside the installer's layout: ${telemetryLog}`);
  }

  console.log("");
  if (remaining.length > 0) {
    console.log("Could not remove, so remove by hand:");
    for (const file of remaining) console.log(`  ${file}`);
    return;
  }
  console.log(`${BINARY_NAME} has been uninstalled.`);
};

/** What the installer's directory holds beside `bin/`: the local telemetry log and the `.mcpb` extension package. */
const INSTALL_FILES = ["telemetry.jsonl", `${BINARY_NAME}.mcpb`];

const listDirectory = (directory: string): string[] => {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
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
