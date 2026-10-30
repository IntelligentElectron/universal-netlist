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
 *   - log-record attributes mirror the user and, opt-in, tool.args (issue #82)
 *   - error logs carry the failure message from a fixture-backed MCP result (issue #184)
 *   - SDK input-schema rejections are counted and classified (issue #191)
 *   - failure path: outcome=error, tool result still returned
 *   - exporter unreachable: tool calls still succeed
 *   - flush on shutdown
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { OtlpReceiver, canListenOnLoopback, waitFor } from "./otlp-receiver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(HERE, "server-entry.ts");
const REPO_ROOT = join(HERE, "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");
const IMPORT_TRACER = join(HERE, "report-sdk-imports.mjs");
const BROKEN_DESIGN = join(
  REPO_ROOT,
  "test",
  "universal",
  "broken",
  "pin-on-other-net.netlist.json"
);
const BROKEN_DESIGN_ERROR =
  "pin-on-other-net.netlist.json: net 'VCC' lists C1.1, but C1.1 is on 'GND'";
const TEST_TIMEOUT = 30_000;

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

/**
 * These tests stand a collector up on loopback, which a sandboxed shell may
 * refuse. Skipping with a reason keeps `npm test` usable there, and CI, which
 * can listen, still runs them.
 */
const loopbackAvailable = await canListenOnLoopback();

/** Run the real command line under Node.js and return what it did. */
const runCli = (
  args: string[],
  env: Record<string, string>,
  nodeArgs: string[] = []
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...nodeArgs, CLI_ENTRY, ...args], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

describe("command line telemetry on disk", () => {
  test(
    "UNIVERSAL_NETLIST_OTEL_DIR writes one OTLP JSON Lines file per signal, stdout untouched",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "un-otel-dir-"));
      try {
        const args = ["list_designs", "--path", tmpdir(), "--max_depth", "0"];
        const plain = await runCli(args, {});
        const run = await runCli(args, { UNIVERSAL_NETLIST_OTEL_DIR: directory });
        expect(run.code).toBe(plain.code);
        expect(run.stdout).toBe(plain.stdout);

        const read = (name: string) =>
          readFileSync(join(directory, `${name}.jsonl`), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        expect(read("traces")[0].resourceSpans[0].scopeSpans[0].spans[0].name).toBe(
          "universal-netlist list_designs"
        );
        expect(read("logs")[0]).toHaveProperty("resourceLogs");
        expect(read("metrics")[0]).toHaveProperty("resourceMetrics");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT
  );

  test(
    "unconfigured: the SDK is never imported and no file appears",
    async () => {
      const run = await runCli(["--version"], {}, ["--import", IMPORT_TRACER]);
      expect(run.code).toBe(0);
      expect(run.stderr).toContain("sdk imports: 0");
    },
    TEST_TIMEOUT
  );

  test(
    "OTEL_SDK_DISABLED=true beats the directory",
    async () => {
      const directory = join(mkdtempSync(join(tmpdir(), "un-otel-off-")), "telemetry");
      const run = await runCli(["--version"], {
        UNIVERSAL_NETLIST_OTEL_DIR: directory,
        OTEL_SDK_DISABLED: "true",
      });
      expect(run.code).toBe(0);
      expect(existsSync(directory)).toBe(false);
    },
    TEST_TIMEOUT
  );
});

describe.skipIf(!loopbackAvailable)("OpenTelemetry end-to-end", () => {
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

      // The host OS account, set at the resource level and mirrored onto the
      // log record itself for log-only backends.
      expect(receiver.resourceAttributes()["user.name"]).toBe(userInfo().username);
      expect(receiver.resourceAttributes()["enduser.id"]).toBe(userInfo().username);
      expect(log.attributes["user.name"]).toBe(userInfo().username);
      expect(log.attributes["enduser.id"]).toBe(userInfo().username);
      // Args are opt-in and were not requested here.
      expect(log.attributes["tool.args"]).toBeUndefined();
      expect(span.attributes["tool.args"]).toBeUndefined();
      expect(log.attributes["error.message"]).toBeUndefined();
    },
    TEST_TIMEOUT
  );

  test(
    "args capture: UNIVERSAL_NETLIST_CAPTURE_ARGS puts tool.args on the span and the log record",
    async () => {
      const args = { path: tmpdir(), max_depth: 0 };
      await withServer(otelEnv(receiver, { UNIVERSAL_NETLIST_CAPTURE_ARGS: "true" }), async (client) => {
        const res: any = await client.callTool({ name: "list_designs", arguments: args });
        expect(res.isError).toBeFalsy();
      });

      // Filter on tool.args presence: earlier tests emitted argless records.
      const got = await waitFor(
        () =>
          receiver
            .spans()
            .some((s) => s.name === "tool/list_designs" && "tool.args" in s.attributes) &&
          receiver
            .logs()
            .some((l) => l.body === "tool/list_designs success" && "tool.args" in l.attributes)
      );
      expect(got).toBe(true);

      // The handler sees args with schema defaults applied, so match on the
      // caller-supplied subset; span and log must carry the identical JSON.
      const span = receiver
        .spans()
        .find((s) => s.name === "tool/list_designs" && "tool.args" in s.attributes)!;
      expect(JSON.parse(String(span.attributes["tool.args"]))).toMatchObject(args);

      const log = receiver
        .logs()
        .find((l) => l.body === "tool/list_designs success" && "tool.args" in l.attributes)!;
      expect(log.attributes["tool.args"]).toBe(span.attributes["tool.args"]);
      expect(log.attributes["enduser.id"]).toBe(userInfo().username);
    },
    TEST_TIMEOUT
  );

  test(
    "failure path: outcome=error span + error metric, tool result still returned",
    async () => {
      let toolReturned = false;
      await withServer(otelEnv(receiver), async (client) => {
        const res: any = await client.callTool({
          name: "run_erc",
          arguments: { design: BROKEN_DESIGN },
        });
        // The call resolves (telemetry did not break it); it reports a failure.
        toolReturned = true;
        expect(JSON.parse(res.content?.[0]?.text ?? "{}").error).toBe(BROKEN_DESIGN_ERROR);
      });
      expect(toolReturned).toBe(true);

      const got = await waitFor(
        () =>
          receiver
            .spans()
            .some((s) => s.name === "tool/run_erc" && s.attributes["tool.outcome"] === "error") &&
          receiver
            .logs()
            .some(
              (l) =>
                l.body === "tool/run_erc error" &&
                l.attributes["error.message"] === BROKEN_DESIGN_ERROR
            )
      );
      expect(got).toBe(true);

      const span = receiver
        .spans()
        .find((s) => s.name === "tool/run_erc" && s.attributes["tool.outcome"] === "error")!;
      expect(span.attributes["error.type"]).toBe("invalid_argument");

      const log = receiver
        .logs()
        .find(
          (l) =>
            l.body === "tool/run_erc error" && l.attributes["error.message"] === BROKEN_DESIGN_ERROR
        )!;
      expect(log.attributes["error.type"]).toBe("invalid_argument");
      expect(log.attributes["error.message"]).toBe(BROKEN_DESIGN_ERROR);

      await waitFor(() => receiver.metrics().some((m) => m.name === "tool.errors"));
      const errors = receiver.metrics().find((m) => m.name === "tool.errors")!;
      expect(
        errors.points.some(
          (p) => p.attributes.tool === "run_erc" && p.attributes.error_type === "invalid_argument"
        )
      ).toBe(true);
    },
    TEST_TIMEOUT
  );

  test(
    "input-schema rejection: SDK failure emits the complete error telemetry shape",
    async () => {
      await withServer(otelEnv(receiver), async (client) => {
        const res: any = await client.callTool({
          name: "list_designs",
          arguments: { search_path: "/tmp" },
        });
        expect(res.isError).toBe(true);
        expect(res.content?.[0]?.text ?? "").toContain('Unrecognized key: "search_path"');
      });

      const got = await waitFor(
        () =>
          receiver.spans().some(
            (s) =>
              s.name === "tool/list_designs" &&
              s.attributes["tool.outcome"] === "error" &&
              s.attributes["error.type"] === "invalid_argument"
          ) &&
          receiver.logs().some(
            (l) =>
              l.body === "tool/list_designs error" &&
              String(l.attributes["error.message"]).includes("search_path")
          )
      );
      expect(got).toBe(true);

      const rejectionSpans = receiver
        .spans()
        .filter(
          (s) =>
            s.name === "tool/list_designs" && s.attributes["tool.outcome"] === "error"
        );
      expect(rejectionSpans).toHaveLength(1);
      const span = rejectionSpans[0];
      expect(span.attributes["error.type"]).toBe("invalid_argument");
      expect(typeof span.attributes["tool.duration_ms"]).toBe("number");

      const rejectionLogs = receiver
        .logs()
        .filter((l) => l.body === "tool/list_designs error");
      expect(rejectionLogs).toHaveLength(1);
      const log = rejectionLogs[0];
      expect(log.attributes["error.type"]).toBe("invalid_argument");
      expect(log.attributes["error.message"]).toContain("search_path");

      const hasMetricPoint = (
        name: string,
        matches: (attributes: Record<string, string | number | boolean>) => boolean
      ): boolean =>
        receiver
          .metrics()
          .filter((metric) => metric.name === name)
          .some((metric) => metric.points.some((point) => matches(point.attributes)));

      expect(
        await waitFor(
          () =>
            hasMetricPoint(
              "tool.calls",
              (attrs) => attrs.tool === "list_designs" && attrs.outcome === "error"
            ) &&
            hasMetricPoint(
              "tool.errors",
              (attrs) =>
                attrs.tool === "list_designs" && attrs.error_type === "invalid_argument"
            )
        )
      ).toBe(true);
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

  describe("command line", () => {
    test(
      "a success emits a CLI-convention span, a duration metric and a correlated log",
      async () => {
        const run = await runCli(
          ["list_designs", "--path", tmpdir(), "--max_depth", "0"],
          otelEnv(receiver, { OTEL_SERVICE_NAME: "cli-success" })
        );
        expect(run.code).toBe(0);

        const name = "universal-netlist list_designs";
        const got = await waitFor(
          () =>
            receiver.spans().some((s) => s.name === name) &&
            receiver.metrics().some((m) => m.name === "universal_netlist.command.duration") &&
            receiver.logs().some((l) => l.eventName === "universal_netlist.command.completed")
        );
        expect(got).toBe(true);

        const span = receiver.spans().find((s) => s.name === name)!;
        expect(span.attributes).toMatchObject({
          "process.executable.name": "universal-netlist",
          "process.exit.code": 0,
          "universal_netlist.command": "list_designs",
        });
        expect(typeof span.attributes["process.pid"]).toBe("number");
        expect(span.attributes["error.type"]).toBeUndefined();
        expect(span.attributes["process.command_args"]).toBeUndefined();
        expect(receiver.resourceAttributes()["process.command_args"]).toBeUndefined();

        const log = receiver.logs().find((l) => l.body?.startsWith(name))!;
        expect(log.traceId).toBe(span.traceId);
        expect(log.spanId).toBe(span.spanId);
      },
      TEST_TIMEOUT
    );

    test(
      "a failure keeps its exit code and output, and is classified",
      async () => {
        const args = ["run_erc", BROKEN_DESIGN];
        const plain = await runCli(args, {});
        const run = await runCli(args, otelEnv(receiver));
        expect(run.code).toBe(1);
        expect(run.code).toBe(plain.code);
        expect(run.stdout).toBe(plain.stdout);

        expect(
          await waitFor(() =>
            receiver
              .spans()
              .some(
                (s) =>
                  s.name === "universal-netlist run_erc" &&
                  s.attributes["error.type"] === "invalid_argument" &&
                  s.status?.code === 2
              )
          )
        ).toBe(true);
      },
      TEST_TIMEOUT
    );

    test(
      "an unknown word is labelled unknown, and never recorded by name",
      async () => {
        const run = await runCli(["some-secret-word"], otelEnv(receiver));
        expect(run.code).toBe(2);
        expect(await waitFor(() => receiver.spans().some((s) => s.name.endsWith(" unknown")))).toBe(
          true
        );
        expect(receiver.spans().some((s) => s.name.includes("some-secret-word"))).toBe(false);
      },
      TEST_TIMEOUT
    );

    test(
      "an unreachable exporter changes neither the output nor the exit code",
      async () => {
        const args = ["list_designs", "--path", tmpdir(), "--max_depth", "0"];
        const plain = await runCli(args, {});
        const run = await runCli(args, {
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
          OTEL_EXPORTER_OTLP_TIMEOUT: "200",
        });
        expect(run.code).toBe(plain.code);
        expect(run.stdout).toBe(plain.stdout);
        expect(run.stderr).toBe(plain.stderr);
      },
      TEST_TIMEOUT
    );

    // `proxyEnv` arrived in Node.js 22.21; older versions ignore it, as the docs say.
    const [major, minor] = process.versions.node.split(".").map(Number);
    test.skipIf(major < 22 || (major === 22 && minor < 21))(
      "exports through HTTP_PROXY, and NO_PROXY goes around it",
      async () => {
        const proxied: string[] = [];
        const proxy = createHttpServer((req, res) => {
          proxied.push(req.url ?? "");
          const url = new URL(req.url ?? "");
          const upstream = httpRequest(
            {
              host: url.hostname,
              port: url.port,
              path: url.pathname,
              method: req.method,
              headers: req.headers,
            },
            (response) => {
              res.writeHead(response.statusCode ?? 502, response.headers);
              response.pipe(res);
            }
          );
          req.pipe(upstream);
        });
        await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
        const port = (proxy.address() as { port: number }).port;
        const args = ["list_designs", "--path", tmpdir(), "--max_depth", "0"];
        try {
          const proxiedRun = await runCli(
            args,
            otelEnv(receiver, { HTTP_PROXY: `http://127.0.0.1:${port}` })
          );
          expect(proxiedRun.code).toBe(0);
          expect(proxied.some((url) => url.endsWith("/v1/traces"))).toBe(true);

          proxied.length = 0;
          await runCli(
            args,
            otelEnv(receiver, { HTTP_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: "127.0.0.1" })
          );
          expect(proxied).toEqual([]);
        } finally {
          proxy.closeAllConnections();
          await new Promise((resolve) => proxy.close(resolve));
        }
      },
      TEST_TIMEOUT
    );
  });
});
