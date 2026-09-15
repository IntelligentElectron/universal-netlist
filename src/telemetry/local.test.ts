/**
 * Telemetry unit tests.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getInstallDir,
  getTelemetryPath,
  initTelemetry,
  logToolEvent,
  withTelemetry,
  exportTelemetry,
} from "./local.js";

const testDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
const testTelemetryPath = join(testDir, "telemetry.jsonl");

beforeEach(() => {
  process.env.UNIVERSAL_NETLIST_TELEMETRY_PATH = testTelemetryPath;
  if (existsSync(testTelemetryPath)) {
    rmSync(testTelemetryPath);
  }
});

afterEach(() => {
  delete process.env.UNIVERSAL_NETLIST_TELEMETRY_PATH;
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("getInstallDir", () => {
  it("returns a non-empty string", () => {
    const dir = getInstallDir();
    expect(dir).toBeTruthy();
    expect(typeof dir).toBe("string");
  });

  it("returns a path containing 'universal-netlist'", () => {
    const dir = getInstallDir();
    expect(dir).toContain("universal-netlist");
  });
});

describe("getTelemetryPath", () => {
  it("ends with telemetry.jsonl", () => {
    const path = getTelemetryPath();
    expect(path).toMatch(/telemetry\.jsonl$/);
  });

  it("respects UNIVERSAL_NETLIST_TELEMETRY_PATH env var", () => {
    process.env.UNIVERSAL_NETLIST_TELEMETRY_PATH = "/tmp/custom.jsonl";
    expect(getTelemetryPath()).toBe("/tmp/custom.jsonl");
  });

  it("falls back to install dir when env var is unset", () => {
    delete process.env.UNIVERSAL_NETLIST_TELEMETRY_PATH;
    const path = getTelemetryPath();
    expect(path).toContain("universal-netlist");
    expect(path).toMatch(/telemetry\.jsonl$/);
  });
});

describe("initTelemetry", () => {
  it("writes a session event to the telemetry file", () => {
    initTelemetry("test-session-id-1234");

    expect(existsSync(testTelemetryPath)).toBe(true);
    const content = readFileSync(testTelemetryPath, "utf-8").trim();
    const event = JSON.parse(content);

    expect(event.session_id).toBe("test-session-id-1234");
    expect(event.username).toBeTruthy();
    expect(event.machine).toBeDefined();
    expect(event.machine.platform).toBeTruthy();
    expect(event.machine.arch).toBeTruthy();
    expect(event.machine.hostname).toBeTruthy();
    expect(event.version).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
  });
});

describe("logToolEvent", () => {
  it("appends a tool event after the session event", () => {
    initTelemetry("test-session-tool-events");

    logToolEvent({
      tool: "list_designs",
      args: { path: "./test" },
      duration_ms: 42,
      success: true,
    });

    const lines = readFileSync(testTelemetryPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    const toolEvent = JSON.parse(lines[1]);
    expect(toolEvent.session_id).toBe("test-session-tool-events");
    expect(toolEvent.tool).toBe("list_designs");
    expect(toolEvent.args).toEqual({ path: "./test" });
    expect(toolEvent.duration_ms).toBe(42);
    expect(toolEvent.success).toBe(true);
  });
});

describe("withTelemetry", () => {
  beforeEach(() => {
    initTelemetry("test-session-with-telemetry");
  });

  it("passes through the handler result", async () => {
    const handler = withTelemetry("test_tool", async (args: { design: string }) => ({
      content: [{ type: "text" as const, text: args.design }],
    }));

    const result = await handler({ design: "./Board.PrjPcb" });
    expect(result.content[0].text).toBe("./Board.PrjPcb");
  });

  it("logs a successful tool event", async () => {
    const handler = withTelemetry("query_component", async (_args: { design: string }) => ({
      content: [{ type: "text" as const, text: '{"refdes":"U1"}' }],
    }));

    await handler({ design: "./Board.PrjPcb" });

    const lines = readFileSync(testTelemetryPath, "utf-8").trim().split("\n");
    const toolEvent = JSON.parse(lines[lines.length - 1]);
    expect(toolEvent.tool).toBe("query_component");
    expect(toolEvent.success).toBe(true);
    expect(toolEvent.duration_ms).toBeGreaterThanOrEqual(0);
    expect(toolEvent.args).toEqual({ design: "./Board.PrjPcb" });
  });

  it("logs success=false for error results", async () => {
    const handler = withTelemetry("search_nets", async (_args: { design: string }) => ({
      content: [{ type: "text" as const, text: '{"error":"Net not found"}' }],
    }));

    await handler({ design: "./Board.PrjPcb" });

    const lines = readFileSync(testTelemetryPath, "utf-8").trim().split("\n");
    const toolEvent = JSON.parse(lines[lines.length - 1]);
    expect(toolEvent.success).toBe(false);
  });

  it("logs success=false for MCP validation error results", async () => {
    const handler = withTelemetry("list_designs", async (_args: Record<string, unknown>) => ({
      isError: true,
      content: [{ type: "text" as const, text: 'Unrecognized key: "search_path"' }],
    }));

    await handler({ search_path: "/tmp" });

    const lines = readFileSync(testTelemetryPath, "utf-8").trim().split("\n");
    const toolEvent = JSON.parse(lines[lines.length - 1]);
    expect(toolEvent.tool).toBe("list_designs");
    expect(toolEvent.args).toEqual({ search_path: "/tmp" });
    expect(toolEvent.success).toBe(false);
  });

  it("logs success=false and re-throws on handler exceptions", async () => {
    const handler = withTelemetry("failing_tool", async (_args: Record<string, unknown>) => {
      throw new Error("boom");
    });

    await expect(handler({})).rejects.toThrow("boom");

    const lines = readFileSync(testTelemetryPath, "utf-8").trim().split("\n");
    const toolEvent = JSON.parse(lines[lines.length - 1]);
    expect(toolEvent.tool).toBe("failing_tool");
    expect(toolEvent.success).toBe(false);
  });
});

describe("exportTelemetry", () => {
  const exportDir = mkdtempSync(join(tmpdir(), "telemetry-export-"));
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  afterAll(() => {
    rmSync(exportDir, { recursive: true, force: true });
  });

  it("throws when no telemetry file exists", async () => {
    if (existsSync(testTelemetryPath)) {
      rmSync(testTelemetryPath);
    }
    await expect(exportTelemetry()).rejects.toThrow("No telemetry file found");
  });

  it("throws when telemetry file is empty", async () => {
    writeFileSync(testTelemetryPath, "");
    await expect(exportTelemetry()).rejects.toThrow("empty");
  });

  it("creates a zip file when telemetry data exists", async () => {
    writeFileSync(testTelemetryPath, '{"test":"data"}\n');
    process.chdir(exportDir);

    const zipPath = await exportTelemetry();
    expect(zipPath).toMatch(/\.zip$/);
    expect(existsSync(zipPath)).toBe(true);
  });
});
