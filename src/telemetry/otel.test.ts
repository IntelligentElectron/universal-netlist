/**
 * OpenTelemetry per-call log record tests.
 *
 * The SDK is initialized against a closed local port, so telemetry is enabled
 * but background exports fail fast and nothing leaves the machine. The global
 * logger provider is then swapped for an in-memory capture, letting the tests
 * assert on the exact log records `instrumentTool` emits.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { userInfo } from "node:os";
import { logs, type LogRecord, type LoggerProvider } from "@opentelemetry/api";
import { initOtel, instrumentCommand, instrumentTool, shutdownOtel } from "./otel.js";
import { useClosedOtelExporter } from "../../test/helpers/otel-environment.js";

const captured: LogRecord[] = [];
const captureProvider: LoggerProvider = {
  getLogger: () => ({
    emit: (record: LogRecord) => {
      captured.push(record);
    },
    enabled: () => true,
  }),
};

let restoreEnvironment: () => void;

beforeAll(async () => {
  restoreEnvironment = useClosedOtelExporter();
  await initOtel({ serviceName: "otel-test", serviceVersion: "0.0.0" });
  // Swap the SDK's registered global logger provider for the capture.
  logs.disable();
  logs.setGlobalLoggerProvider(captureProvider);
});

afterAll(async () => {
  logs.disable();
  await shutdownOtel();
  restoreEnvironment();
});

beforeEach(() => {
  captured.length = 0;
  delete process.env.OTEL_CAPTURE_TOOL_ARGS;
  delete process.env.UNIVERSAL_NETLIST_CAPTURE_ARGS;
  delete process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT;
  delete process.env.UNIVERSAL_NETLIST_DESIGN_ROOT;
  process.exitCode = undefined;
});

const lastRecord = (): LogRecord => {
  expect(captured).toHaveLength(1);
  return captured[0];
};

const ARGUMENTS = "gen_ai.tool.call.arguments";

describe("instrumentTool log records", () => {
  it("emits one record per call with the standard attributes", async () => {
    const result = await instrumentTool("demo_tool", { a: 1 }, async () => "ok");

    expect(result).toBe("ok");
    const record = lastRecord();
    expect(record.eventName).toBe("universal_netlist.tool_call.completed");
    expect(record.body).toBe("tools/call demo_tool succeeded");
    expect(record.severityText).toBe("INFO");
    expect(record.attributes).toMatchObject({
      "mcp.method.name": "tools/call",
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "demo_tool",
    });
    for (const removed of [
      "tool.name",
      "tool.outcome",
      "tool.duration_ms",
      "trace_id",
      "span_id",
    ]) {
      expect(record.attributes ?? {}).not.toHaveProperty(removed);
    }
  });

  it("mirrors the user attributes onto the record", async () => {
    await instrumentTool("demo_tool", {}, async () => "ok");

    expect(lastRecord().attributes).toMatchObject({
      "user.name": userInfo().username,
      "enduser.id": userInfo().username,
    });
  });

  it("records a design's path relative to the root, only when a root is set", async () => {
    const root = process.cwd();
    const design = `${root}/boards/a/board.kicad_pro`;

    await instrumentTool("demo_tool", { design }, async () => "ok");
    expect(lastRecord().attributes ?? {}).not.toHaveProperty("universal_netlist.design.path");

    captured.length = 0;
    process.env.UNIVERSAL_NETLIST_DESIGN_ROOT = root;
    await instrumentTool("demo_tool", { design }, async () => "ok");
    expect(lastRecord().attributes?.["universal_netlist.design.path"]).toBe(
      "boards/a/board.kicad_pro"
    );
  });

  it("captures arguments under the deprecated name's documented 1", async () => {
    process.env.OTEL_CAPTURE_TOOL_ARGS = "1";
    await instrumentTool("demo_tool", { a: 1 }, async () => "ok");
    expect(lastRecord().attributes?.[ARGUMENTS]).toEqual({ a: 1 });
  });

  it("captures structured arguments on the record when UNIVERSAL_NETLIST_CAPTURE_ARGS is true", async () => {
    process.env.UNIVERSAL_NETLIST_CAPTURE_ARGS = "TRUE";
    const args = { design: "board.kicad_pro", pattern: "^VCC" };

    await instrumentTool("demo_tool", args, async () => "ok");

    expect(lastRecord().attributes?.[ARGUMENTS]).toEqual(args);
  });

  it("keeps arguments off the record when the conventions' variable says spans only", async () => {
    process.env.UNIVERSAL_NETLIST_CAPTURE_ARGS = "true";
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT = "span_only";

    await instrumentTool("demo_tool", { a: 1 }, async () => "ok");

    expect(lastRecord().attributes ?? {}).not.toHaveProperty(ARGUMENTS);
  });

  it("omits arguments when capture is not asked for", async () => {
    await instrumentTool("demo_tool", { design: "board.kicad_pro" }, async () => "ok");

    expect(lastRecord().attributes ?? {}).not.toHaveProperty(ARGUMENTS);
  });

  it("keeps the user and args on error records", async () => {
    process.env.UNIVERSAL_NETLIST_CAPTURE_ARGS = "true";

    await expect(
      instrumentTool("demo_tool", { a: 1 }, async () => {
        throw new TypeError("boom");
      })
    ).rejects.toThrow("boom");

    const record = lastRecord();
    expect(record.severityText).toBe("ERROR");
    expect(record.body).toBe("tools/call demo_tool failed");
    expect(record.attributes).toMatchObject({
      "error.type": "tool_error",
      "universal_netlist.error.category": "internal",
      "error.class": "TypeError",
      "error.message": "boom",
      "enduser.id": userInfo().username,
      [ARGUMENTS]: { a: 1 },
    });
  });

  it("captures the message from an MCP error result", async () => {
    const errorResult = {
      content: [{ type: "text", text: JSON.stringify({ error: "Design file not found" }) }],
    };

    const result = await instrumentTool("demo_tool", {}, async () => errorResult, {
      isErrorResult: () => true,
      getErrorMessage: (value) => JSON.parse(value.content[0].text).error,
    });

    expect(result).toBe(errorResult);
    expect(lastRecord().attributes).toMatchObject({
      "error.type": "not_found",
      "universal_netlist.error.category": "not_found",
      "error.message": "Design file not found",
    });
  });

  it("names an isError result tool_error and keeps its cause as the category", async () => {
    const result = { isError: true };

    await instrumentTool("demo_tool", {}, async () => result, {
      isErrorResult: () => true,
      isToolErrorResult: () => true,
      getErrorMessage: () => "MCP error -32602: Tool demo_tool not found",
    });

    expect(lastRecord().attributes).toMatchObject({
      "error.type": "tool_error",
      "universal_netlist.error.category": "not_found",
    });
  });

  it("records the request's id and session, and its connection, when given one", async () => {
    await instrumentTool("demo_tool", {}, async () => "ok", {
      request: {
        id: "7",
        sessionId: "s1",
        protocolVersion: "2025-06-18",
        networkTransport: "pipe",
      },
    });

    expect(lastRecord().attributes).toMatchObject({
      "jsonrpc.request.id": "7",
      "mcp.session.id": "s1",
      "mcp.protocol.version": "2025-06-18",
      "network.transport": "pipe",
    });
  });

  it("gives thrown and returned not-found failures the same category", async () => {
    await expect(
      instrumentTool("thrown_tool", {}, async () => {
        throw new Error("Design file not found");
      })
    ).rejects.toThrow("Design file not found");

    const errorResult = {
      content: [{ type: "text", text: JSON.stringify({ error: "Design file not found" }) }],
    };
    await instrumentTool("returned_tool", {}, async () => errorResult, {
      isErrorResult: () => true,
      getErrorMessage: (value) => JSON.parse(value.content[0].text).error,
    });

    expect(captured).toHaveLength(2);
    expect(captured[0].attributes).toMatchObject({
      "error.type": "tool_error",
      "universal_netlist.error.category": "not_found",
      "error.class": "Error",
    });
    expect(captured[1].attributes).toMatchObject({
      "error.type": "not_found",
      "universal_netlist.error.category": "not_found",
    });
    expect(captured[1].attributes ?? {}).not.toHaveProperty("error.class");
  });

  it("omits error attributes from successful calls", async () => {
    await instrumentTool("demo_tool", {}, async () => "ok");

    expect(lastRecord().attributes ?? {}).not.toHaveProperty("error.type");
    expect(lastRecord().attributes ?? {}).not.toHaveProperty("universal_netlist.error.category");
    expect(lastRecord().attributes ?? {}).not.toHaveProperty("error.class");
    expect(lastRecord().attributes ?? {}).not.toHaveProperty("error.message");
  });

  it("truncates long error messages", async () => {
    const message = "x".repeat(3000);

    await expect(
      instrumentTool("demo_tool", {}, async () => {
        throw new Error(message);
      })
    ).rejects.toThrow(message);

    const capturedMessage = lastRecord().attributes?.["error.message"];
    expect(capturedMessage).toBeTypeOf("string");
    expect(capturedMessage).toHaveLength(2048);
    expect(capturedMessage).toMatch(/\u2026$/);
  });

  it("preserves a thrown value that cannot be converted to a string", async () => {
    const thrown = Object.create(null);

    await expect(
      instrumentTool("demo_tool", {}, async () => {
        throw thrown;
      })
    ).rejects.toBe(thrown);

    expect(lastRecord().attributes).toMatchObject({
      "error.type": "tool_error",
      "universal_netlist.error.category": "internal",
      "error.message": "Unknown error",
    });
    expect(lastRecord().attributes ?? {}).not.toHaveProperty("error.class");
  });
});

describe("instrumentCommand log records", () => {
  const invocation = { executable: "universal-netlist", command: "search_nets", argv: ["a", "b"] };

  it("records a success with the CLI conventions' attributes", async () => {
    await instrumentCommand(invocation, async () => {});

    const record = lastRecord();
    expect(record.eventName).toBe("universal_netlist.command.completed");
    expect(record.severityText).toBe("INFO");
    expect(record.attributes).toMatchObject({
      "process.executable.name": "universal-netlist",
      "process.exit.code": 0,
      "process.pid": process.pid,
      "universal_netlist.command": "search_nets",
    });
    expect(record.attributes ?? {}).not.toHaveProperty("error.type");
    expect(record.attributes ?? {}).not.toHaveProperty("process.command_args");
  });

  it("classifies a failure from the message the command reports", async () => {
    await instrumentCommand(invocation, async () => {
      process.exitCode = 1;
      return { errorMessage: "Design file not found" };
    });

    expect(lastRecord().severityText).toBe("ERROR");
    expect(lastRecord().attributes).toMatchObject({
      "process.exit.code": 1,
      "error.type": "not_found",
      "error.message": "Design file not found",
    });
  });

  it("keeps the exit code a command set and records its arguments only on request", async () => {
    process.env.UNIVERSAL_NETLIST_CAPTURE_ARGS = "true";
    await instrumentCommand(invocation, async () => {
      process.exitCode = 2;
      return { errorMessage: "--pattern: required" };
    });

    expect(process.exitCode).toBe(2);
    expect(lastRecord().attributes).toMatchObject({
      "error.type": "invalid_argument",
      "process.command_args": ["universal-netlist", "a", "b"],
    });
  });

  it("records a throw as exit 1 and passes it on", async () => {
    await expect(
      instrumentCommand(invocation, async () => {
        throw new TypeError("boom");
      })
    ).rejects.toThrow("boom");

    expect(lastRecord().attributes).toMatchObject({
      "process.exit.code": 1,
      "error.type": "internal",
      "error.class": "TypeError",
      "error.message": "boom",
    });
  });
});
