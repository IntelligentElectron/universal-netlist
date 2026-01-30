/**
 * CLI command handlers for --version, --help, --update, and --uninstall.
 */

import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { VERSION, GITHUB_REPO, BINARY_NAME } from "../version.js";
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
  --version, -v    Print version and exit
  --help, -h       Show this help message
  --update         Check for and install updates
  --uninstall      Remove binary and PATH entries
  --no-update      Disable auto-update check on startup

INSTALLATION:
  curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | bash

ENVIRONMENT:
  UNIVERSAL_NETLIST_MCP_NO_UPDATE=1    Disable auto-updates

MORE INFO:
  https://github.com/${GITHUB_REPO}
`.trim(),
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

  const confirmed = await confirm("Install update?");
  if (!confirmed) {
    console.log("Update cancelled");
    return;
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
  const confirmed = await confirm(
    `This will remove ${BINARY_NAME} from your system. Continue?`,
  );
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
        `Failed to remove directory: ${error instanceof Error ? error.message : error}`,
      );
      console.log("You may need to remove it manually.");
    }
  }

  console.log("");
  console.log(`${BINARY_NAME} has been uninstalled.`);
};
