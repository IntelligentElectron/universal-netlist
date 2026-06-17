/**
 * End-to-end OpenTelemetry validation.
 *
 * Spawns the real MCP server over stdio (via the MCP client SDK), points it at an
 * in-process OTLP receiver, calls tools, and asserts the emitted spans, metrics,
 * and logs. Covers the issue #66 acceptance criteria:
 *   - no-op + no emission when unconfigured
 *   - per-tool-call span (tool/<name>) with outcome attributes
 *   - tool.calls / tool.duration / tool.errors metrics
 *   - structured log correlated by trace/span id
 *   - failure path: outcome=error, tool result still returned
 *   - exporter unreachable: tool calls still succeed
 *   - flush on shutdown
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { OtlpReceiver, waitFor } from "./otlp-receiver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(HERE, "server-entry.ts");
const REPO_ROOT = join(HERE, "..", "..");
const TEST_TIMEOUT = 30_000;

/** A scratch telemetry path so the JSONL logger never touches the real install dir. */
const scratchTelemetry = () => join(mkdtempSync(join(tmpdir(), "un-otel-")), "telemetry.jsonl");

/** Spawn the server with the given env, run `fn`, then close the client. */
const withServer = async (
  env: Record<string, string>,
  fn: (client: Client) => Promise<void>
): Promise<void> => {
  const transport = new StdioClientTransport({
    command: process.execPath, // node
    args: ["--import", "tsx", SERVER_ENTRY],
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      UNIVERSAL_NETLIST_TELEMETRY_PATH: scratchTelemetry(),
      ...env,
    },
  });
  const client = new Client({ name: "otel-e2e", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
  }
};

const otelEnv = (receiver: OtlpReceiver, extra: Record<string, string> = {}) => ({
  OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
  OTEL_SERVICE_NAME: "test-universal-netlist",
  // Flush quickly so assertions don't wait on long default batch windows.
  OTEL_BSP_SCHEDULE_DELAY: "200",
  OTEL_BLRP_SCHEDULE_DELAY: "200",
  OTEL_METRIC_EXPORT_INTERVAL: "400",
  ...extra,
});

describe("OpenTelemetry end-to-end", () => {
  let receiver: OtlpReceiver;

  beforeAll(async () => {
    receiver = new OtlpReceiver();
    await receiver.start();
  });

  afterAll(async () => {
    await receiver.stop();
  });

  test(
    "no-op: nothing is emitted when OTEL_* is not configured",
    async () => {
      const before = receiver.traceEnvelopes.length;
      await withServer({}, async (client) => {
        const res: any = await client.callTool({
          name: "list_designs",
          arguments: { path: tmpdir(), max_depth: 0 },
        });
        expect(res.isError).toBeFalsy();
      });
      // Give any (erroneously created) exporter a moment; expect still nothing.
      await new Promise((r) => setTimeout(r, 500));
      expect(receiver.traceEnvelopes.length).toBe(before);
    },
    TEST_TIMEOUT
  );

  test(
    "happy path: span + metrics + correlated log for a successful tool call",
    async () => {
      await withServer(otelEnv(receiver), async (client) => {
        const res: any = await client.callTool({
          name: "list_designs",
          arguments: { path: tmpdir(), max_depth: 0 },
        });
        expect(res.isError).toBeFalsy();
      });

      const got = await waitFor(
        () =>
          receiver.spans().some((s) => s.name === "tool/list_designs") &&
          receiver.metrics().some((m) => m.name === "tool.calls") &&
          receiver.logs().some((l) => l.body === "tool/list_designs success")
      );
      expect(got).toBe(true);

      const span = receiver.spans().find((s) => s.name === "tool/list_designs")!;
      expect(span.attributes["tool.name"]).toBe("list_designs");
      expect(span.attributes["tool.outcome"]).toBe("success");
      expect(typeof span.attributes["tool.duration_ms"]).toBe("number");

      const calls = receiver.metrics().find((m) => m.name === "tool.calls")!;
      expect(
        calls.points.some(
          (p) => p.attributes.tool === "list_designs" && p.attributes.outcome === "success"
        )
      ).toBe(true);
      expect(receiver.metrics().some((m) => m.name === "tool.duration")).toBe(true);

      const log = receiver.logs().find((l) => l.body === "tool/list_designs success")!;
      expect(log.attributes.trace_id).toBe(span.traceId);
      expect(log.attributes.span_id).toBe(span.spanId);

      // enduser.id is the host OS account, set at the resource level.
      expect(receiver.resourceAttributes()["enduser.id"]).toBe(userInfo().username);
    },
    TEST_TIMEOUT
  );

  test(
    "failure path: outcome=error span + error metric, tool result still returned",
    async () => {
      let toolReturned = false;
      await withServer(otelEnv(receiver), async (client) => {
        const res: any = await client.callTool({
          name: "list_components",
          arguments: { design: "/nonexistent/does-not-exist.dsn", type: "U" },
        });
        // The call resolves (telemetry did not break it); it reports a failure.
        toolReturned = true;
        expect(res).toBeDefined();
      });
      expect(toolReturned).toBe(true);

      const got = await waitFor(() =>
        receiver
          .spans()
          .some(
            (s) => s.name === "tool/list_components" && s.attributes["tool.outcome"] === "error"
          )
      );
      expect(got).toBe(true);

      const span = receiver
        .spans()
        .find(
          (s) => s.name === "tool/list_components" && s.attributes["tool.outcome"] === "error"
        )!;
      expect(span.attributes["error.type"]).toBeDefined();

      await waitFor(() => receiver.metrics().some((m) => m.name === "tool.errors"));
      expect(receiver.metrics().some((m) => m.name === "tool.errors")).toBe(true);
    },
    TEST_TIMEOUT
  );

  test(
    "reliability: an unreachable exporter never breaks a tool call",
    async () => {
      // Port 1 is not listenable; exports will fail. The tool must still succeed.
      await withServer(
        {
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
          OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
          OTEL_BSP_SCHEDULE_DELAY: "200",
        },
        async (client) => {
          const res: any = await client.callTool({
            name: "list_designs",
            arguments: { path: tmpdir(), max_depth: 0 },
          });
          expect(res.isError).toBeFalsy();
          const text = res.content?.[0]?.text ?? "";
          expect(text.length).toBeGreaterThan(0);
        }
      );
    },
    TEST_TIMEOUT
  );

  test(
    "flush on shutdown: spans deferred by a long batch window still export on exit",
    async () => {
      const before = receiver.spans().length;
      await withServer(
        otelEnv(receiver, {
          // Long enough that nothing exports during the call; only shutdown flush can.
          OTEL_BSP_SCHEDULE_DELAY: "600000",
          OTEL_BLRP_SCHEDULE_DELAY: "600000",
          OTEL_METRIC_EXPORT_INTERVAL: "600000",
          OTEL_SERVICE_NAME: "test-flush",
        }),
        async (client) => {
          await client.callTool({
            name: "list_designs",
            arguments: { path: tmpdir(), max_depth: 0 },
          });
        }
      );
      // After close(), the server's shutdown hook must have flushed the span.
      const flushed = await waitFor(() => receiver.spans().length > before);
      expect(flushed).toBe(true);
    },
    TEST_TIMEOUT
  );
});
