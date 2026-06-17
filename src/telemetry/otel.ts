/**
 * OpenTelemetry instrumentation (vendor-neutral, OTLP).
 *
 * Emits a span, metrics, and a structured log per tool call. Configured purely
 * through the standard `OTEL_*` environment variables, so it works against any
 * OTLP-compatible backend (Collector, Jaeger, Tempo, Honeycomb, Datadog, ...).
 *
 * Design constraints (see issue #66):
 *  - Disabled by default. If no OTLP endpoint is configured the SDK is never
 *    imported and `instrumentTool` is a pass-through with zero overhead.
 *  - Telemetry must never break a tool call. Every span/metric/log operation is
 *    wrapped so an exporter or SDK fault degrades to "no telemetry", never an
 *    error returned to the caller.
 *  - This module is shared verbatim across the MCP servers. Repo-specific values
 *    (service name) are passed into `initOtel`; everything else comes from env.
 *  - stdio transport owns stdout, so diagnostics are written to stderr only and
 *    no console/stdout exporter is ever used.
 */

import { userInfo } from "node:os";
import { trace, metrics, SpanStatusCode, type Span, type Attributes } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";

const INSTRUMENTATION_NAME = "@intelligentelectron/mcp";

// =============================================================================
// Module state
// =============================================================================

/**
 * True only after the SDK has successfully started. While false, `instrumentTool`
 * is a pure pass-through (true zero overhead), so an unconfigured or failed
 * setup costs nothing on the hot path.
 */
let enabled = false;

/** The started SDK instance, retained so we can flush + shut it down on exit. */
let sdk: { shutdown: () => Promise<void>; forceFlush?: () => Promise<void> } | undefined;

/** Bun-only fallback timer that forces periodic metric export (see startMetricFlushFallback). */
let metricFlushTimer: ReturnType<typeof setInterval> | undefined;

/** The push metric reader, retained so the bun fallback can force a flush. */
let metricReader: { forceFlush: () => Promise<void> } | undefined;

interface Instruments {
  calls: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
  duration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>;
  errors: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
}
let instruments: Instruments | undefined;

// =============================================================================
// Configuration helpers
// =============================================================================

/** Whether the standard env says telemetry should be on. */
const isConfigured = (): boolean => {
  if (isTruthy(process.env.OTEL_SDK_DISABLED)) return false;
  // Opt in purely by pointing at an endpoint (general or any per-signal one).
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
  );
};

const isTruthy = (v: string | undefined): boolean => v === "1" || v?.toLowerCase() === "true";

/** Write a diagnostic line to stderr only (never stdout, which carries MCP JSON-RPC). */
const diagStderr = (msg: string): void => {
  try {
    process.stderr.write(`[otel] ${msg}\n`);
  } catch {
    // ignore
  }
};

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize OpenTelemetry if (and only if) the standard env vars request it.
 * No-op and zero overhead otherwise. Safe to call exactly once at startup;
 * never throws; a setup failure degrades to disabled telemetry.
 */
export const initOtel = async (opts: {
  serviceName: string;
  serviceVersion: string;
}): Promise<void> => {
  if (enabled || !isConfigured()) return;

  try {
    // Heavy SDK is imported lazily so the disabled path never loads it.
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
    const { BatchLogRecordProcessor } = await import("@opentelemetry/sdk-logs");
    const { resourceFromAttributes } = await import("@opentelemetry/resources");
    const { diag, DiagLogLevel } = await import("@opentelemetry/api");

    // Route OTel's own diagnostics to stderr; never the default console logger,
    // which would corrupt the stdio MCP stream on stdout.
    diag.setLogger(
      {
        verbose: () => {},
        debug: () => {},
        info: () => {},
        warn: (m: string) => diagStderr(m),
        error: (m: string) => diagStderr(m),
      },
      DiagLogLevel.WARN
    );

    const { traceExporter, metricExporter, logExporter } = await createExporters();

    // service.name from env wins; our value is only a fallback default.
    // enduser.id is the host OS account, attributing this per-session process to
    // whoever is running it. Set at the resource level so it tags traces,
    // metrics, and logs alike.
    const resource = resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME || opts.serviceName,
      "service.version": opts.serviceVersion,
      ...hostEnduser(),
    });

    const reader = new PeriodicExportingMetricReader({ exporter: metricExporter });
    metricReader = reader;

    const nodeSdk = new NodeSDK({
      resource,
      traceExporter,
      metricReaders: [reader],
      logRecordProcessors: [new BatchLogRecordProcessor(logExporter)],
    });

    nodeSdk.start();
    sdk = nodeSdk;
    instruments = undefined; // rebind lazily to the now-registered MeterProvider
    enabled = true;

    startMetricFlushFallback();
    installShutdownHooks();
  } catch (err) {
    // Telemetry setup must never take the server down.
    diagStderr(`init failed, telemetry disabled: ${describeError(err)}`);
    enabled = false;
    sdk = undefined;
  }
};

/**
 * Select OTLP exporters per `OTEL_EXPORTER_OTLP_PROTOCOL`. Each exporter reads
 * its own endpoint/headers/timeout from the standard env. Default is
 * `http/protobuf` (the OTel default and the most portable for compiled
 * binaries). `grpc` is not bundled in the standalone binaries, so it falls
 * back to `http/protobuf` with a warning.
 */
const createExporters = async (): Promise<{
  traceExporter: SpanExporter;
  metricExporter: PushMetricExporter;
  logExporter: LogRecordExporter;
}> => {
  const protocol = (process.env.OTEL_EXPORTER_OTLP_PROTOCOL || "http/protobuf").toLowerCase();

  if (protocol === "grpc") {
    diagStderr("OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported here; using http/protobuf");
  }

  if (protocol === "http/json") {
    const t = await import("@opentelemetry/exporter-trace-otlp-http");
    const m = await import("@opentelemetry/exporter-metrics-otlp-http");
    const l = await import("@opentelemetry/exporter-logs-otlp-http");
    return {
      traceExporter: new t.OTLPTraceExporter(),
      metricExporter: new m.OTLPMetricExporter(),
      logExporter: new l.OTLPLogExporter(),
    };
  }

  // http/protobuf (default) and grpc-fallback
  const t = await import("@opentelemetry/exporter-trace-otlp-proto");
  const m = await import("@opentelemetry/exporter-metrics-otlp-proto");
  const l = await import("@opentelemetry/exporter-logs-otlp-proto");
  return {
    traceExporter: new t.OTLPTraceExporter(),
    metricExporter: new m.OTLPMetricExporter(),
    logExporter: new l.OTLPLogExporter(),
  };
};

/**
 * Bun's compiled standalone runtime does not fire the metric reader's internal
 * `unref()`'d interval, so periodic metric export never happens there and a
 * long-running server would only emit metrics on shutdown. Under bun, drive an
 * explicit flush on our own (ref'd) timer at the configured export interval.
 * No-op on Node, where the reader's own interval works. Cleared on shutdown.
 */
const startMetricFlushFallback = (): void => {
  if (!(process.versions as { bun?: string }).bun) return;
  const intervalMs = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL) || 60000;
  metricFlushTimer = setInterval(() => {
    void metricReader?.forceFlush?.();
  }, intervalMs);
};

let shutdownHooksInstalled = false;
const installShutdownHooks = (): void => {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const onSignal = (signal: NodeJS.Signals) => {
    void shutdownOtel().finally(() => {
      // Re-raise default behavior so the process actually exits.
      process.kill(process.pid, signal);
    });
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  process.once("beforeExit", () => {
    void shutdownOtel();
  });
};

/**
 * Flush and shut down the SDK. Important for short-lived / CLI invocations so
 * batched, async exports are not lost on exit. Idempotent and never throws.
 */
export const shutdownOtel = async (): Promise<void> => {
  if (metricFlushTimer) {
    clearInterval(metricFlushTimer);
    metricFlushTimer = undefined;
  }
  metricReader = undefined;
  const active = sdk;
  if (!active) return;
  sdk = undefined;
  enabled = false;
  try {
    await active.shutdown();
  } catch (err) {
    diagStderr(`shutdown error: ${describeError(err)}`);
  }
};

// =============================================================================
// Per-tool-call instrumentation
// =============================================================================

/**
 * Wrap a single tool invocation in a span named `tool/<name>`, record the
 * standard metrics, and emit a structured log correlated by trace/span id.
 *
 * `run` is executed exactly once. When telemetry is disabled this is a direct
 * pass-through. Telemetry never alters the result and never throws on its own.
 */
export const instrumentTool = async <R>(
  toolName: string,
  args: Record<string, unknown>,
  run: () => Promise<R>,
  opts?: { isErrorResult?: (result: R) => boolean }
): Promise<R> => {
  if (!enabled) return run();

  const tracer = trace.getTracer(INSTRUMENTATION_NAME);
  return tracer.startActiveSpan(`tool/${toolName}`, async (span) => {
    const start = Date.now();
    try {
      safely(() => {
        span.setAttribute("tool.name", toolName);
        if (isTruthy(process.env.OTEL_CAPTURE_TOOL_ARGS)) {
          // Full args, untruncated: tool-call arguments are inherently small.
          span.setAttribute("tool.args", safeJson(args));
        }
      });

      const result = await run();

      const isError = opts?.isErrorResult?.(result) ?? false;
      finishSpan(
        span,
        toolName,
        isError ? "error" : "success",
        isError ? "tool_error" : undefined,
        Date.now() - start
      );
      return result;
    } catch (err) {
      const errorType = err instanceof Error ? err.name : "Error";
      safely(() => span.recordException(err instanceof Error ? err : new Error(String(err))));
      finishSpan(span, toolName, "error", errorType, Date.now() - start);
      throw err;
    }
  });
};

const finishSpan = (
  span: Span,
  toolName: string,
  outcome: "success" | "error",
  errorType: string | undefined,
  durationMs: number
): void => {
  safely(() => {
    span.setAttribute("tool.outcome", outcome);
    span.setAttribute("tool.duration_ms", durationMs);
    if (errorType) span.setAttribute("error.type", errorType);
    span.setStatus({ code: outcome === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK });
  });

  safely(() => {
    const inst = getInstruments();
    const labels: Attributes = { tool: toolName, outcome };
    inst.calls.add(1, labels);
    inst.duration.record(durationMs, labels);
    if (outcome === "error") {
      inst.errors.add(1, { tool: toolName, error_type: errorType ?? "unknown" });
    }
  });

  safely(() => emitLog(span, toolName, outcome, errorType, durationMs));

  safely(() => span.end());
};

const emitLog = (
  span: Span,
  toolName: string,
  outcome: "success" | "error",
  errorType: string | undefined,
  durationMs: number
): void => {
  const sc = span.spanContext();
  const logger = logs.getLogger(INSTRUMENTATION_NAME);
  logger.emit({
    severityNumber: outcome === "error" ? SeverityNumber.ERROR : SeverityNumber.INFO,
    severityText: outcome === "error" ? "ERROR" : "INFO",
    body: `tool/${toolName} ${outcome}`,
    attributes: {
      "tool.name": toolName,
      "tool.outcome": outcome,
      "tool.duration_ms": durationMs,
      ...(errorType ? { "error.type": errorType } : {}),
      // Explicit ids for trace-to-log correlation in addition to the record's
      // own trace context.
      trace_id: sc.traceId,
      span_id: sc.spanId,
    },
  });
};

const getInstruments = (): Instruments => {
  if (!instruments) {
    const meter = metrics.getMeter(INSTRUMENTATION_NAME);
    instruments = {
      calls: meter.createCounter("tool.calls", {
        description: "Number of tool invocations",
      }),
      duration: meter.createHistogram("tool.duration", {
        unit: "ms",
        description: "Tool invocation duration in milliseconds",
      }),
      errors: meter.createCounter("tool.errors", {
        description: "Number of failed tool invocations",
      }),
    };
  }
  return instruments;
};

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * The host OS account name as an `enduser.id` resource attribute, attributing
 * this per-session process to whoever runs it. Best-effort: returns an empty
 * object if the username can't be read, so telemetry setup never fails on it.
 */
const hostEnduser = (): Record<string, string> => {
  try {
    const name = userInfo().username;
    return name ? { "enduser.id": name } : {};
  } catch {
    return {};
  }
};

/** Run a telemetry side effect, swallowing any error so it can't break a tool. */
const safely = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // telemetry must never throw into the caller
  }
};

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
};

const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));
