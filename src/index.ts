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
 *   <tool> [design] --flag value ...         Run a tool, printing its JSON result: any
 *                                            MCP tool, or export_design (command line only)
 */

import {
  printVersion,
  printHelp,
  handleUpdateCommand,
  handleUninstallCommand,
  handleRemovedExportTelemetry,
  handleQueryCommand,
  handleUnknownCommand,
  handleRenamedCommand,
} from "./cli/commands.js";
import { toolNamed } from "./cli/query.js";
import { autoUpdate, reexec } from "./cli/updater.js";
import { normalizeCliArgs } from "./cli/args.js";
import { SELF_UPDATE_ENABLED } from "./build-flags.js";
import { VERSION, BINARY_NAME } from "./version.js";
import {
  initOtel,
  instrumentCommand,
  shutdownOtel,
  type CommandReport,
} from "./telemetry/index.js";
import { runServer } from "./server.js";

/**
 * Run one command under telemetry, flushing before the process exits: a command
 * lasts seconds, too short for batch intervals. A flush that outlasts its limit
 * leaves exports holding the event loop, so exit once stdout has drained, with
 * the exit code the command set. Off, this is a plain call.
 */
const runCommand = async (
  command: string,
  run: () => Promise<CommandReport | void> | CommandReport | void
): Promise<void> => {
  await initOtel({ serviceName: BINARY_NAME, serviceVersion: VERSION, quietExports: true });
  let flushed = true;
  try {
    await instrumentCommand(
      { executable: BINARY_NAME, command, argv: process.argv.slice(2) },
      async () => run()
    );
  } finally {
    flushed = await shutdownOtel();
  }
  if (!flushed) {
    process.stdout.write("", () => process.exit(process.exitCode));
  }
};

const main = async (): Promise<void> => {
  // A tool's name first is a query, whose tokens are its own: a pattern or a
  // net may be called `help`. It never updates or serves.
  const raw = process.argv.slice(2);
  const tool = toolNamed(raw[0]);
  if (tool) {
    await runCommand(tool.name, () => handleQueryCommand(tool, raw.slice(1)));
    return;
  }

  // export-json became the export_design tool. Say so instead of treating it
  // as a mistyped word, or as a flag that starts the server.
  if (raw[0] === "export-json" || raw[0] === "--export-json") {
    await runCommand("export-json", () => handleRenamedCommand(raw[0], "export_design"));
    return;
  }

  if (raw[0] === "export-telemetry" || raw[0] === "--export-telemetry") {
    await runCommand("export-telemetry", () => handleRemovedExportTelemetry(raw[0]));
    return;
  }

  // `update` and `--update` are the same command; the word form is rewritten
  // to the flag form here so the checks below read one spelling.
  const args = normalizeCliArgs(raw);

  // Handle --version / -v
  if (args.includes("--version") || args.includes("-v")) {
    await runCommand("version", printVersion);
    return;
  }

  // Handle --help / -h
  if (args.includes("--help") || args.includes("-h")) {
    await runCommand("help", printHelp);
    return;
  }

  // Handle --update
  if (args.includes("--update")) {
    await runCommand("update", handleUpdateCommand);
    return;
  }

  // Handle --uninstall
  if (args.includes("--uninstall")) {
    await runCommand("uninstall", handleUninstallCommand);
    return;
  }

  // Any other word is a mistyped command or tool. Starting the server on it
  // would wait on stdin for a client that is not there.
  if (args[0] !== undefined && !args[0].startsWith("-")) {
    await runCommand("unknown", () => handleUnknownCommand(args[0]));
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
