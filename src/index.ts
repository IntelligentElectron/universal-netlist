#!/usr/bin/env node

/**
 * Universal Netlist MCP Server Entry Point
 *
 * Run with: npx tsx src/index.ts
 * Or after build: node dist/index.js
 *
 * Commands (each also accepted as a flag, `update` and `--update` alike):
 *   version, -v        Print version and exit
 *   help, -h           Show help
 *   update|upgrade     Check for and install updates
 *   uninstall          Remove binary and PATH entries
 *   export-telemetry   Export telemetry data as a zip file
 *   export-json <design> [out]  Write a design's netlist as Universal Netlist JSON
 *   coverage [path]    Compare DSN parser output against DAT netlist exports
 */

import {
  printVersion,
  printHelp,
  handleUpdateCommand,
  handleUninstallCommand,
  handleExportTelemetryCommand,
  handleExportJsonCommand,
  handleCoverageCommand,
} from "./cli/commands.js";
import { autoUpdate, reexec } from "./cli/updater.js";
import { normalizeCliArgs } from "./cli/args.js";
import { SELF_UPDATE_ENABLED } from "./build-flags.js";
import { runServer } from "./server.js";

const main = async (): Promise<void> => {
  // `update` and `--update` are the same command; the word form is rewritten
  // to the flag form here so the checks below read one spelling.
  const args = normalizeCliArgs(process.argv.slice(2));

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

  // Handle --export-telemetry
  if (args.includes("--export-telemetry")) {
    await handleExportTelemetryCommand();
    return;
  }

  // Handle export-json <design> [output.json]
  if (args.includes("--export-json")) {
    const idx = args.indexOf("--export-json");
    const outArg = args[idx + 2];
    await handleExportJsonCommand(args[idx + 1], outArg?.startsWith("--") ? undefined : outArg);
    return;
  }

  // Handle --coverage [path] [--verbose]
  if (args.includes("--coverage")) {
    const idx = args.indexOf("--coverage");
    const nextArg = args[idx + 1];
    const searchPath = nextArg && !nextArg.startsWith("--") ? nextArg : undefined;
    const verbose = args.includes("--verbose");
    await handleCoverageCommand(searchPath, verbose);
    return;
  }

  // If running in a TTY (interactive terminal), show help instead of starting server
  if (process.stdin.isTTY) {
    console.log("This is an MCP server that communicates via stdio.");
    console.log("It should be run by an MCP client, not directly.\n");
    console.log("For setup instructions, see:");
    console.log(
      "  https://github.com/IntelligentElectron/universal-netlist?tab=readme-ov-file#connect-the-mcp-with-your-favorite-ai-tool\n"
    );
    console.log("Run `universal-netlist help` for available commands.");
    return;
  }

  // Auto-update on startup. A packaged build never touches its own file.
  if (SELF_UPDATE_ENABLED) {
    const updated = await autoUpdate();
    if (updated) {
      reexec();
    }
  }

  await runServer();
};

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
