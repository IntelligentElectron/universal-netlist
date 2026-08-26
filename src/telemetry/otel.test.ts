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
import { logs, type LogRecord, type LoggerProvider } from "@opentelemetry/api-logs";
import { initOtel, instrumentTool, shutdownOtel } from "./otel.js";

const captured: LogRecord[] = [];
const captureProvider: LoggerProvider = {
  getLogger: () => ({
    emit: (record: LogRecord) => {
      captured.push(record);
    },
    enabled: () => true,
  }),
};

beforeAll(async () => {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:1";
  // Keep the batch exporters from firing (and failing) mid-test; shutdown
  // still flushes once at the end.
  process.env.OTEL_BSP_SCHEDULE_DELAY = "600000";
  process.env.OTEL_BLRP_SCHEDULE_DELAY = "600000";
  process.env.OTEL_METRIC_EXPORT_INTERVAL = "600000";
  await initOtel({ serviceName: "otel-test", serviceVersion: "0.0.0" });
  // Swap the SDK's registered global logger provider for the capture.
  logs.disable();
  logs.setGlobalLoggerProvider(captureProvider);
});

afterAll(async () => {
  logs.disable();
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_BSP_SCHEDULE_DELAY;
  delete process.env.OTEL_BLRP_SCHEDULE_DELAY;
  delete process.env.OTEL_METRIC_EXPORT_INTERVAL;
  delete process.env.OTEL_CAPTURE_TOOL_ARGS;
  await shutdownOtel();
});

beforeEach(() => {
  captured.length = 0;
  delete process.env.OTEL_CAPTURE_TOOL_ARGS;
});

const lastRecord = (): LogRecord => {
  expect(captured).toHaveLength(1);
  return captured[0];
};

describe("instrumentTool log records", () => {
  it("emits one record per call with the standard attributes", async () => {
    const result = await instrumentTool("demo_tool", { a: 1 }, async () => "ok");

    expect(result).toBe("ok");
    const record = lastRecord();
    expect(record.body).toBe("tool/demo_tool success");
    expect(record.severityText).toBe("INFO");
    expect(record.attributes).toMatchObject({
      "tool.name": "demo_tool",
      "tool.outcome": "success",
    });
    expect(record.attributes?.["tool.duration_ms"]).toBeTypeOf("number");
    expect(record.attributes?.trace_id).toBeTypeOf("string");
    expect(record.attributes?.span_id).toBeTypeOf("string");
  });

  it("mirrors enduser.id onto the record", async () => {
    await instrumentTool("demo_tool", {}, async () => "ok");

    expect(lastRecord().attributes?.["enduser.id"]).toBe(userInfo().username);
  });

  it("captures tool.args on the record when OTEL_CAPTURE_TOOL_ARGS is set", async () => {
    process.env.OTEL_CAPTURE_TOOL_ARGS = "1";
    const args = { design: "board.kicad_pro", pattern: "^VCC" };

    await instrumentTool("demo_tool", args, async () => "ok");

    expect(lastRecord().attributes?.["tool.args"]).toBe(JSON.stringify(args));
  });

  it("omits tool.args when OTEL_CAPTURE_TOOL_ARGS is unset", async () => {
    await instrumentTool("demo_tool", { design: "board.kicad_pro" }, async () => "ok");

    expect(lastRecord().attributes ?? {}).not.toHaveProperty("tool.args");
  });

  it("keeps enduser.id and args on error records", async () => {
    process.env.OTEL_CAPTURE_TOOL_ARGS = "true";

    await expect(
      instrumentTool("demo_tool", { a: 1 }, async () => {
        throw new TypeError("boom");
      })
    ).rejects.toThrow("boom");

    const record = lastRecord();
    expect(record.severityText).toBe("ERROR");
    expect(record.attributes).toMatchObject({
      "tool.outcome": "error",
      "error.type": "internal",
      "error.class": "TypeError",
      "error.message": "boom",
      "enduser.id": userInfo().username,
      "tool.args": JSON.stringify({ a: 1 }),
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
      "tool.outcome": "error",
      "error.type": "not_found",
      "error.message": "Design file not found",
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
      "error.type": "not_found",
      "error.class": "Error",
    });
    expect(captured[1].attributes).toMatchObject({ "error.type": "not_found" });
    expect(captured[1].attributes ?? {}).not.toHaveProperty("error.class");
  });

  it("omits error attributes from successful calls", async () => {
    await instrumentTool("demo_tool", {}, async () => "ok");

    expect(lastRecord().attributes ?? {}).not.toHaveProperty("error.type");
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
      "tool.outcome": "error",
      "error.type": "internal",
      "error.message": "Unknown error",
    });
    expect(lastRecord().attributes ?? {}).not.toHaveProperty("error.class");
  });
});
