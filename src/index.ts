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
 *   <tool> [design] --flag value ...         Run a tool, printing its JSON result: any
 *                                            MCP tool, or export_design (command line only)
 */

import {
  printVersion,
  printHelp,
  handleUpdateCommand,
  handleUninstallCommand,
  handleExportTelemetryCommand,
  handleQueryCommand,
  handleUnknownCommand,
  handleRenamedCommand,
} from "./cli/commands.js";
import { toolNamed } from "./cli/query.js";
import { autoUpdate, reexec } from "./cli/updater.js";
import { normalizeCliArgs } from "./cli/args.js";
import { SELF_UPDATE_ENABLED } from "./build-flags.js";
import { runServer } from "./server.js";

const main = async (): Promise<void> => {
  // A tool's name first is a query, whose tokens are its own: a pattern or a
  // net may be called `help`. It never updates or serves.
  const raw = process.argv.slice(2);
  const tool = toolNamed(raw[0]);
  if (tool) {
    await handleQueryCommand(tool, raw.slice(1));
    return;
  }

  // export-json became the export_design tool. Say so instead of treating it
  // as a mistyped word, or as a flag that starts the server.
  if (raw[0] === "export-json" || raw[0] === "--export-json") {
    handleRenamedCommand(raw[0], "export_design");
    return;
  }

  // `update` and `--update` are the same command; the word form is rewritten
  // to the flag form here so the checks below read one spelling.
  const args = normalizeCliArgs(raw);

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

  // Any other word is a mistyped command or tool. Starting the server on it
  // would wait on stdin for a client that is not there.
  if (args[0] !== undefined && !args[0].startsWith("-")) {
    handleUnknownCommand(args[0]);
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
