#!/usr/bin/env node

/**
 * Universal Netlist MCP Server Entry Point
 *
 * Run with: npx tsx src/index.ts
 * Or after build: node dist/index.js
 *
 * CLI flags:
 *   --version, -v    Print version and exit
 *   --help, -h       Show help
 *   --update         Check for and install updates
 *   --uninstall      Remove binary and PATH entries
 *   --no-update      Disable auto-update check on startup
 */

import {
  printVersion,
  printHelp,
  handleUpdateCommand,
  handleUninstallCommand,
} from "./cli/commands.js";
import { autoUpdate, reexec } from "./cli/updater.js";
import { runServer } from "./server.js";

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);

  // Handle --version / -v
  if (args.includes("--version") || args.includes("-v")) {
    printVersion();
    return;
  }

  // Handle --help / -h
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  // Handle --update
  if (args.includes("--update")) {
    await handleUpdateCommand();
    return;
  }

  // Handle --uninstall
  if (args.includes("--uninstall")) {
    await handleUninstallCommand();
    return;
  }

  // Auto-update on startup (unless --no-update flag is present)
  if (!args.includes("--no-update")) {
    const updated = await autoUpdate();
    if (updated) {
      // Re-execute with the new binary
      reexec();
    }
  }

  await runServer();
};

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
