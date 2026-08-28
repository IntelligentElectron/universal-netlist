/**
 * Local JSONL telemetry for usage analytics.
 *
 * Writes session and tool-call events to a local telemetry.jsonl file.
 * All writes are fire-and-forget; errors are silently caught.
 */

import { appendFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { userInfo, hostname, platform, arch, release } from "node:os";
import { execSync } from "node:child_process";
import { VERSION } from "../version.js";
import { instrumentTool } from "./otel.js";
import { markToolHandlerInstrumented } from "./request-context.js";

// =============================================================================
// Types
// =============================================================================

export interface SessionEvent {
  timestamp: string;
  session_id: string;
  version: string;
  username: string;
  machine: {
    platform: string;
    arch: string;
    os_release: string;
    hostname: string;
  };
}

export interface ToolEvent {
  timestamp: string;
  session_id: string;
  tool: string;
  args: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
}

// =============================================================================
// Install directory resolution
// =============================================================================

const isCompiledBinary = (): boolean =>
  !process.execPath.includes("node") && !process.execPath.includes("bun");

/**
 * Get the install directory for telemetry storage.
 *
 * For compiled binaries: parent of the bin/ directory containing the executable.
 * For npm/dev: platform-specific fallback matching install.sh conventions.
 */
export const getInstallDir = (): string => {
  if (isCompiledBinary()) {
    // execPath = <install_dir>/bin/universal-netlist
    return dirname(dirname(process.execPath));
  }

  // npm/dev fallback: platform-specific data directory
  switch (process.platform) {
    case "darwin":
      return join(
        process.env.HOME ?? userInfo().homedir,
        "Library/Application Support/universal-netlist"
      );
    case "win32":
      return join(
        process.env.LOCALAPPDATA ?? join(userInfo().homedir, "AppData/Local"),
        "universal-netlist"
      );
    default:
      return join(process.env.HOME ?? userInfo().homedir, ".local/share/universal-netlist");
  }
};

export const getTelemetryPath = (): string => {
  if (process.env.UNIVERSAL_NETLIST_TELEMETRY_PATH) {
    return process.env.UNIVERSAL_NETLIST_TELEMETRY_PATH;
  }
  return join(getInstallDir(), "telemetry.jsonl");
};

// =============================================================================
// Module-level state
// =============================================================================

let sessionId: string | undefined;

const machineInfo = {
  platform: platform(),
  arch: arch(),
  os_release: release(),
  hostname: hostname(),
};

// =============================================================================
// Core functions
// =============================================================================

/**
 * Initialize telemetry for this session.
 * Writes the one-time session event with user/machine info.
 */
export const initTelemetry = (id: string): void => {
  sessionId = id;

  const event: SessionEvent = {
    timestamp: new Date().toISOString(),
    session_id: id,
    version: VERSION,
    username: getUserName(),
    machine: machineInfo,
  };

  appendLine(JSON.stringify(event));
};

/**
 * Log a tool invocation event.
 */
export const logToolEvent = (partial: {
  tool: string;
  args: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
}): void => {
  if (!sessionId) return;

  const event: ToolEvent = {
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    ...partial,
  };

  appendLine(JSON.stringify(event));
};

// =============================================================================
// Higher-order function for wrapping tool handlers
// =============================================================================

type ToolHandler<T, R> = (args: T) => Promise<R>;

/**
 * Wrap a tool handler to automatically log telemetry.
 * Measures duration, detects errors in results, logs fire-and-forget.
 */
export const withTelemetry = <T extends Record<string, unknown>, R>(
  toolName: string,
  handler: ToolHandler<T, R>
): ToolHandler<T, R> => {
  return async (args: T): Promise<R> => {
    markToolHandlerInstrumented();
    const start = Date.now();
    let success = true;
    try {
      // OpenTelemetry span/metrics/logs wrap the handler (no-op unless configured
      // via OTEL_* env). The handler runs exactly once, inside the span.
      const result = await instrumentTool(
        toolName,
        args as Record<string, unknown>,
        () => handler(args),
        { isErrorResult: isErrorContent, getErrorMessage: getErrorContentMessage }
      );
      // Detect both application error content and MCP `isError` results created
      // by the SDK for validation/dispatch failures.
      if (isErrorContent(result)) {
        success = false;
      }
      return result;
    } catch (err) {
      success = false;
      throw err;
    } finally {
      logToolEvent({
        tool: toolName,
        args: args as Record<string, unknown>,
        duration_ms: Date.now() - start,
        success,
      });
    }
  };
};

// =============================================================================
// Export
// =============================================================================

/**
 * Export telemetry file as a zip archive in the current working directory.
 * Returns the path to the created zip file.
 */
export const exportTelemetry = async (): Promise<string> => {
  const telemetryPath = getTelemetryPath();

  if (!existsSync(telemetryPath)) {
    throw new Error(`No telemetry file found at ${telemetryPath}`);
  }

  const stats = statSync(telemetryPath);
  if (stats.size === 0) {
    throw new Error("Telemetry file is empty");
  }

  const zipName = `telemetry-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  const zipPath = join(process.cwd(), zipName);

  if (process.platform === "win32") {
    execSync(`tar -a -cf "${zipPath}" -C "${dirname(telemetryPath)}" telemetry.jsonl`, {
      stdio: "pipe",
    });
  } else {
    execSync(`zip -j "${zipPath}" "${telemetryPath}"`, { stdio: "pipe" });
  }

  return zipPath;
};

// =============================================================================
// Internal helpers
// =============================================================================

let dirEnsured = false;

const appendLine = (line: string): void => {
  try {
    const filePath = getTelemetryPath();
    if (!dirEnsured) {
      mkdirSync(dirname(filePath), { recursive: true });
      dirEnsured = true;
    }
    appendFileSync(filePath, line + "\n");
  } catch {
    // silently ignore all errors
  }
};

const getUserName = (): string => {
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
};

/**
 * Check if a tool result contains an error by inspecting the MCP content structure.
 */
const isErrorContent = (result: unknown): boolean => {
  return getErrorContentMessage(result) !== undefined;
};

/** Read the human-facing message from a formatted MCP error result. */
const getErrorContentMessage = (result: unknown): string | undefined => {
  if (typeof result !== "object" || result === null) return undefined;
  const r = result as { content?: Array<{ text?: string }>; isError?: boolean };
  if (!Array.isArray(r.content) || r.content.length === 0) return undefined;
  if (r.isError === true) return r.content[0].text || "Tool call failed";
  try {
    const parsed: unknown = JSON.parse(r.content[0].text ?? "");
    if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) return undefined;
    return typeof parsed.error === "string" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
};
