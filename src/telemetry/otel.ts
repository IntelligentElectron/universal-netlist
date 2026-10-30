/**
 * OpenTelemetry instrumentation (vendor-neutral, OTLP).
 *
 * Emits a span, metrics, and a structured log per tool call and per command.
 * `resolveOtelConfig` decides from the standard `OTEL_*` environment variables
 * whether it runs and where each signal goes, so it works against any
 * OTLP-compatible backend (Collector, Jaeger, Tempo, Honeycomb, Datadog, ...).
 *
 * Design constraints (see issue #66):
 *  - Disabled by default. If nothing asks for an export the SDK is never
 *    imported and `instrumentTool` is a pass-through with zero overhead.
 *  - Telemetry must never break a tool call or a command. Every span/metric/log
 *    operation is wrapped so an exporter or SDK fault degrades to "no telemetry",
 *    never an error returned to the caller.
 *  - Repo-specific values (service name, executable) are passed in by the caller;
 *    everything else comes from env and the build's defaults.
 *  - stdout carries MCP and command results, so diagnostics are written to stderr
 *    only and no console/stdout exporter is ever used.
 */

import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import {
  trace,
  metrics,
  logs,
  SeverityNumber,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Attributes,
} from "@opentelemetry/api";
import type { SpanExporter } from "@opentelemetry/sdk-trace";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";
import { OTEL_BUILD_DEFAULTS } from "../build-flags.js";
import { classifyToolError, getErrorClass, type ToolErrorType } from "./error-category.js";
import {
  captureArgsEnabled,
  commandErrorType,
  designPathAttribute,
  resolveOtelConfig,
  type Signal,
  type SignalDestination,
} from "./otel-config.js";

const INSTRUMENTATION_NAME = "@intelligentelectron/mcp";
const MAX_ERROR_MESSAGE_LENGTH = 2048;

/** How long a flush may hold up an exit. A short-lived command must not wait on a stuck export. */
const SHUTDOWN_TIMEOUT_MS = 5000;

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

/** Set for a command: see `quietExports`. */
let quiet = false;

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

let commandDuration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]> | undefined;

// =============================================================================
// Configuration helpers
// =============================================================================

/** The SDK hands over an error as JSON with its stack; a command's stderr gets the message. */
const diagMessage = (msg: string): string => {
  try {
    const parsed: unknown = JSON.parse(msg);
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      return String(parsed.message);
    }
  } catch {
    // not JSON: a plain message
  }
  return msg;
};

/** Write a diagnostic line to stderr only (never stdout, which carries results). */
const diagStderr = (msg: string): void => {
  try {
    process.stderr.write(`[otel] ${diagMessage(msg)}\n`);
  } catch {
    // ignore
  }
};

// =============================================================================
// Initialization
// =============================================================================

const envNumber = (name: string): number | undefined => {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

/** `OTEL_LOG_LEVEL` for our stderr logger; a value it does not know gets a warning, as an enum does. */
const stderrDiagLevel = (levels: Record<string, unknown>, fallback: number): number => {
  const value = process.env.OTEL_LOG_LEVEL?.trim();
  if (!value) return fallback;
  const level = levels[value.toUpperCase()];
  if (typeof level === "number") return level;
  diagStderr(`OTEL_LOG_LEVEL='${value}' is not a log level; ignored`);
  return fallback;
};

/**
 * Initialize OpenTelemetry if (and only if) `resolveOtelConfig` says it should run.
 * No-op and zero overhead otherwise. Safe to call exactly once at startup;
 * never throws; a setup failure degrades to disabled telemetry.
 */
export const initOtel = async (opts: {
  serviceName: string;
  serviceVersion: string;
  /**
   * Keep export failures off stderr unless OTEL_LOG_LEVEL asks for them. A command's
   * stderr is part of its output, and a dead collector must not change that.
   */
  quietExports?: boolean;
}): Promise<void> => {
  if (enabled) return;
  const config = resolveOtelConfig(process.env, OTEL_BUILD_DEFAULTS);
  for (const warning of config.warnings) diagStderr(warning);
  if (!config.enabled) return;

  try {
    // Heavy SDK is imported lazily so the disabled path never loads it.
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
    const { BatchLogRecordProcessor } = await import("@opentelemetry/sdk-logs");
    const { envDetector, resourceFromAttributes } = await import("@opentelemetry/resources");
    const { diag, DiagLogLevel } = await import("@opentelemetry/api");

    // Route OTel's own diagnostics to stderr; never the console logger, which
    // would corrupt stdout. NodeSDK's constructor installs that logger when
    // OTEL_LOG_LEVEL is set and logs through it at once, so the variable is held
    // back for the length of that one synchronous call.
    const logger = {
      verbose: (m: string) => diagStderr(m),
      debug: (m: string) => diagStderr(m),
      info: (m: string) => diagStderr(m),
      warn: (m: string) => diagStderr(m),
      error: (m: string) => diagStderr(m),
    };
    const logLevel = stderrDiagLevel(
      DiagLogLevel as unknown as Record<string, unknown>,
      DiagLogLevel.WARN
    );
    diag.setLogger(logger, logLevel);

    const traceExporter = await createTraceExporter(config.signals.traces);
    const metricExporter = await createMetricExporter(config.signals.metrics);
    const logExporter = await createLogExporter(config.signals.logs);

    // service.name from env wins; our value is only a fallback default. user.name
    // is the host OS account, attributing this process to whoever runs it. Set at
    // the resource level so it tags traces, metrics, and logs alike; also mirrored
    // onto each log record's own attributes for log backends that drop resource
    // attributes. A packager's resource attributes apply when
    // OTEL_RESOURCE_ATTRIBUTES is empty, which the config has decided.
    const resource = resourceFromAttributes({
      "service.name": opts.serviceName,
      ...config.resourceAttributes,
      ...(process.env.OTEL_SERVICE_NAME ? { "service.name": process.env.OTEL_SERVICE_NAME } : {}),
      "service.version": opts.serviceVersion,
      ...hostUser(),
    });

    // A periodic reader and a batch log processor built by hand do not read their
    // OTEL_* settings, so hand them over. NodeSDK reads the span processor's itself.
    const exportIntervalMillis = envNumber("OTEL_METRIC_EXPORT_INTERVAL") ?? 60000;
    const reader = metricExporter
      ? new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis,
          exportTimeoutMillis: Math.min(
            envNumber("OTEL_METRIC_EXPORT_TIMEOUT") ?? 30000,
            exportIntervalMillis
          ),
        })
      : undefined;
    metricReader = reader;

    // Each signal is given explicitly, even when empty: left out, NodeSDK picks
    // its exporter from the environment, which could name the console.
    const construct = () =>
      new NodeSDK({
        resource,
        // The default detectors put the whole command line on every export, which the
        // CLI conventions say not to collect by default, along with the machine's id.
        // OTEL_NODE_RESOURCE_DETECTORS asks for them, and is read when this is left out.
        ...(process.env.OTEL_NODE_RESOURCE_DETECTORS ? {} : { resourceDetectors: [envDetector] }),
        ...(traceExporter ? { traceExporter } : { spanProcessors: [] }),
        metricReaders: reader ? [reader] : [],
        logRecordProcessors: logExporter
          ? [
              new BatchLogRecordProcessor({
                exporter: logExporter,
                scheduledDelayMillis: envNumber("OTEL_BLRP_SCHEDULE_DELAY"),
                maxQueueSize: envNumber("OTEL_BLRP_MAX_QUEUE_SIZE"),
                maxExportBatchSize: envNumber("OTEL_BLRP_MAX_EXPORT_BATCH_SIZE"),
                exportTimeoutMillis: envNumber("OTEL_BLRP_EXPORT_TIMEOUT"),
              }),
            ]
          : [],
      });
    const shellLogLevel = process.env.OTEL_LOG_LEVEL;
    delete process.env.OTEL_LOG_LEVEL;
    let nodeSdk: ReturnType<typeof construct>;
    try {
      nodeSdk = construct();
    } finally {
      if (shellLogLevel !== undefined) process.env.OTEL_LOG_LEVEL = shellLogLevel;
    }
    if (opts.quietExports && !process.env.OTEL_LOG_LEVEL?.trim()) {
      diag.disable();
      quiet = true;
    }

    nodeSdk.start();
    sdk = nodeSdk;
    instruments = undefined; // rebind lazily to the now-registered MeterProvider
    commandDuration = undefined;
    enabled = true;

    startMetricFlushFallback();
    installShutdownHooks();
  } catch (err) {
    // Telemetry setup must never take the server or a command down.
    diagStderr(`init failed, telemetry disabled: ${describeError(err)}`);
    enabled = false;
    sdk = undefined;
  }
};

const PROXY_VARIABLES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];

/**
 * OTLP export through the environment's forward proxy, with `NO_PROXY` honoured.
 * Node.js (from 22.21) and Bun build this into `http.Agent` as `proxyEnv`. A
 * caller's agent options replace the exporter's own, which read its TLS files
 * from the environment, so those are read here. Without a proxy variable the
 * exporter keeps its own agent.
 */
const proxyOptions = (signal: Signal): { httpAgentOptions?: Record<string, unknown> } => {
  if (!PROXY_VARIABLES.some((name) => process.env[name])) return {};
  const tlsFile = (setting: string): Buffer | undefined => {
    const path =
      process.env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_${setting}`] ||
      process.env[`OTEL_EXPORTER_OTLP_${setting}`];
    return path ? readFileSync(path) : undefined;
  };
  return {
    httpAgentOptions: {
      keepAlive: true,
      proxyEnv: process.env,
      ca: tlsFile("CERTIFICATE"),
      cert: tlsFile("CLIENT_CERTIFICATE"),
      key: tlsFile("CLIENT_KEY"),
    },
  };
};

/** An OTLP exporter's options. It reads everything else from the standard env itself. */
const otlpOptions = (signal: Signal, destination: { url?: string }) => ({
  ...(destination.url ? { url: destination.url } : {}),
  ...proxyOptions(signal),
});

const createTraceExporter = async (
  destination: SignalDestination
): Promise<SpanExporter | undefined> => {
  if (destination.kind === "none") return undefined;
  if (destination.kind === "file") {
    return (await import("./otel-file-exporter.js")).traceFileExporter(destination.path);
  }
  const { OTLPTraceExporter } =
    destination.protocol === "http/json"
      ? await import("@opentelemetry/exporter-trace-otlp-http")
      : await import("@opentelemetry/exporter-trace-otlp-proto");
  return new OTLPTraceExporter(otlpOptions("traces", destination));
};

const createMetricExporter = async (
  destination: SignalDestination
): Promise<PushMetricExporter | undefined> => {
  if (destination.kind === "none") return undefined;
  if (destination.kind === "file") {
    return (await import("./otel-file-exporter.js")).metricFileExporter(destination.path);
  }
  const { OTLPMetricExporter } =
    destination.protocol === "http/json"
      ? await import("@opentelemetry/exporter-metrics-otlp-http")
      : await import("@opentelemetry/exporter-metrics-otlp-proto");
  return new OTLPMetricExporter(otlpOptions("metrics", destination));
};

const createLogExporter = async (
  destination: SignalDestination
): Promise<LogRecordExporter | undefined> => {
  if (destination.kind === "none") return undefined;
  if (destination.kind === "file") {
    return (await import("./otel-file-exporter.js")).logFileExporter(destination.path);
  }
  const { OTLPLogExporter } =
    destination.protocol === "http/json"
      ? await import("@opentelemetry/exporter-logs-otlp-http")
      : await import("@opentelemetry/exporter-logs-otlp-proto");
  return new OTLPLogExporter(otlpOptions("logs", destination));
};

/**
 * Bun's compiled standalone runtime does not fire the metric reader's internal
 * `unref()`'d interval, so periodic metric export never happens there and a
 * long-running server would only emit metrics on shutdown. Under bun, drive an
 * explicit flush on our own (ref'd) timer at the configured export interval.
 * No-op on Node, where the reader's own interval works. Cleared on shutdown.
 */
const startMetricFlushFallback = (): void => {
  if (!(process.versions as { bun?: string }).bun || !metricReader) return;
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
 * Flush and shut down the SDK. A short-lived command awaits this before it exits,
 * since batched, async exports would otherwise be lost. Idempotent and never
 * throws. Resolves false when the flush outlasted `SHUTDOWN_TIMEOUT_MS`; the
 * exports it abandoned can still hold the event loop open.
 */
export const shutdownOtel = async (): Promise<boolean> => {
  if (metricFlushTimer) {
    clearInterval(metricFlushTimer);
    metricFlushTimer = undefined;
  }
  metricReader = undefined;
  const active = sdk;
  if (!active) return true;
  sdk = undefined;
  enabled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      active.shutdown().then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    if (!quiet) diagStderr(`shutdown error: ${describeError(err)}`);
    return true;
  } finally {
    clearTimeout(timer);
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
  opts?: {
    isErrorResult?: (result: R) => boolean;
    getErrorMessage?: (result: R) => string | undefined;
  }
): Promise<R> => {
  if (!enabled) return run();

  const tracer = trace.getTracer(INSTRUMENTATION_NAME);
  return tracer.startActiveSpan(`tool/${toolName}`, async (span) => {
    const start = Date.now();
    // Full args, untruncated: tool-call arguments are inherently small.
    // Serialized once, then attached to the span here and mirrored onto the
    // per-call log record (span attributes never reach log-based backends).
    const capturedArgs = captureArgsEnabled(process.env) ? safeJson(args) : undefined;
    const designPath = designPathAttribute(args.design, process.env);
    try {
      safely(() => {
        span.setAttribute("tool.name", toolName);
        if (capturedArgs !== undefined) span.setAttribute("tool.args", capturedArgs);
        if (designPath !== undefined) span.setAttribute(DESIGN_PATH, designPath);
      });

      const result = await run();

      const isError = opts?.isErrorResult?.(result) ?? false;
      const resultErrorMessage = isError ? opts?.getErrorMessage?.(result) : undefined;
      finishSpan(
        span,
        toolName,
        isError ? "error" : "success",
        isError ? classifyToolError(resultErrorMessage) : undefined,
        undefined,
        normalizeErrorMessage(resultErrorMessage),
        Date.now() - start,
        capturedArgs,
        designPath
      );
      return result;
    } catch (err) {
      safely(() => span.recordException(err instanceof Error ? err : new Error(String(err))));
      finishSpan(
        span,
        toolName,
        "error",
        classifyToolError(err),
        getErrorClass(err),
        normalizeErrorMessage(describeError(err)),
        Date.now() - start,
        capturedArgs,
        designPath
      );
      throw err;
    }
  });
};

const finishSpan = (
  span: Span,
  toolName: string,
  outcome: "success" | "error",
  errorType: ToolErrorType | undefined,
  errorClass: string | undefined,
  errorMessage: string | undefined,
  durationMs: number,
  capturedArgs: string | undefined,
  designPath: string | undefined
): void => {
  safely(() => {
    span.setAttribute("tool.outcome", outcome);
    span.setAttribute("tool.duration_ms", durationMs);
    if (errorType) span.setAttribute("error.type", errorType);
    if (errorClass) span.setAttribute("error.class", errorClass);
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

  safely(() =>
    emitLog(
      span,
      toolName,
      outcome,
      errorType,
      errorClass,
      errorMessage,
      durationMs,
      capturedArgs,
      designPath
    )
  );

  safely(() => span.end());
};

/**
 * Emit the per-call log record. Log/label-based backends index only log-record
 * attributes (resource attributes are dropped and span attributes are never
 * carried), so the user attributes are mirrored here from the resource and the
 * captured args from the span are mirrored here. Failure messages are attached
 * here as well, keeping errors actionable from logs alone.
 */
const emitLog = (
  span: Span,
  toolName: string,
  outcome: "success" | "error",
  errorType: ToolErrorType | undefined,
  errorClass: string | undefined,
  errorMessage: string | undefined,
  durationMs: number,
  capturedArgs: string | undefined,
  designPath: string | undefined
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
      ...(errorClass ? { "error.class": errorClass } : {}),
      ...(errorMessage ? { "error.message": errorMessage } : {}),
      ...hostUser(),
      ...(capturedArgs !== undefined ? { "tool.args": capturedArgs } : {}),
      ...(designPath !== undefined ? { [DESIGN_PATH]: designPath } : {}),
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
// Per-command instrumentation
// =============================================================================

const COMMAND = "universal_netlist.command";
const DESIGN_PATH = "universal_netlist.design.path";

/** What a command knows about its own run, beyond the exit code it set. */
export interface CommandReport {
  /** Why it failed, when it did. */
  readonly errorMessage?: string;
  /** The design it was asked about. */
  readonly design?: unknown;
}

/**
 * Wrap one CLI command in a span under the semantic conventions for CLI programs:
 * https://opentelemetry.io/docs/specs/semconv/cli/cli-spans/
 *
 * `command` is a low-cardinality name, never free text from the command line. The
 * span is `<executable> <command>`, the form the convention allows for an
 * instrumentation that knows the command. The exit code is read from
 * `process.exitCode` once `run` has finished. A pass-through when telemetry is off.
 */
export const instrumentCommand = async (
  invocation: { executable: string; command: string; argv: readonly string[] },
  run: () => Promise<CommandReport | void>
): Promise<void> => {
  if (!enabled) {
    await run();
    return;
  }

  const { executable, command, argv } = invocation;
  const tracer = trace.getTracer(INSTRUMENTATION_NAME);
  await tracer.startActiveSpan(
    `${executable} ${command}`,
    { kind: SpanKind.INTERNAL },
    async (span) => {
      const start = performance.now();
      const finish = (exitCode: number, report: CommandReport, thrown?: unknown): void => {
        const failure = thrown ?? report.errorMessage;
        safely(() =>
          recordCommand(span, invocation, {
            exitCode,
            failure,
            errorClass: thrown === undefined ? undefined : getErrorClass(thrown),
            message:
              thrown === undefined
                ? normalizeErrorMessage(report.errorMessage)
                : normalizeErrorMessage(describeError(thrown)),
            seconds: (performance.now() - start) / 1000,
            design: designPathAttribute(report.design, process.env),
            args: captureArgsEnabled(process.env) ? [executable, ...argv] : undefined,
          })
        );
        safely(() => span.end());
      };
      try {
        const report = (await run()) ?? {};
        finish(Number(process.exitCode ?? 0), report);
      } catch (err) {
        safely(() => span.recordException(err instanceof Error ? err : new Error(String(err))));
        finish(1, {}, err);
        throw err;
      }
    }
  );
};

const recordCommand = (
  span: Span,
  invocation: { executable: string; command: string },
  run: {
    exitCode: number;
    failure: unknown;
    errorClass: string | undefined;
    message: string | undefined;
    seconds: number;
    design: string | undefined;
    args: string[] | undefined;
  }
): void => {
  const { executable, command } = invocation;
  const errorType = commandErrorType(run.exitCode, run.failure, classifyToolError);
  const identity: Attributes = {
    "process.executable.name": executable,
    "process.pid": process.pid,
    "process.exit.code": run.exitCode,
    [COMMAND]: command,
    ...(errorType ? { "error.type": errorType } : {}),
    ...(run.errorClass ? { "error.class": run.errorClass } : {}),
    ...(run.design !== undefined ? { [DESIGN_PATH]: run.design } : {}),
    ...(run.args ? { "process.command_args": run.args } : {}),
  };
  span.setAttributes(identity);
  // The conventions leave a success's status unset.
  if (run.exitCode !== 0) span.setStatus({ code: SpanStatusCode.ERROR, message: run.message });

  // One histogram: its count is the number of runs, and `error.type` splits out the
  // failures, which is how the conventions count errors. Seconds, as they say for durations.
  if (!commandDuration) {
    commandDuration = metrics
      .getMeter(INSTRUMENTATION_NAME)
      .createHistogram(`${COMMAND}.duration`, {
        unit: "s",
        description: "Duration of a command",
      });
  }
  commandDuration.record(run.seconds, {
    [COMMAND]: command,
    ...(errorType ? { "error.type": errorType } : {}),
  });

  // Emitted inside the active span, so the record carries its trace context.
  logs.getLogger(INSTRUMENTATION_NAME).emit({
    eventName: `${COMMAND}.completed`,
    severityNumber: run.exitCode === 0 ? SeverityNumber.INFO : SeverityNumber.ERROR,
    severityText: run.exitCode === 0 ? "INFO" : "ERROR",
    body: `${executable} ${command} exited ${run.exitCode}`,
    attributes: {
      ...identity,
      ...(run.message ? { "error.message": run.message } : {}),
      ...hostUser(),
    },
  });
};

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * The host OS account name as `user.name`, the convention's attribute for a login
 * name, attributing this process to whoever runs it. `enduser.id` carries the same
 * value for the backends already indexing it. Used on the resource and mirrored
 * onto each log record, so it is cached after the first read. Best-effort: yields
 * an empty object if the username can't be read, so telemetry never fails on it.
 */
let userAttrs: Record<string, string> | undefined;
const hostUser = (): Record<string, string> => {
  if (!userAttrs) {
    try {
      // Bun answers `unknown` where Node.js throws.
      const name = userInfo().username;
      userAttrs = name && name !== "unknown" ? { "user.name": name, "enduser.id": name } : {};
    } catch {
      userAttrs = {};
    }
  }
  return userAttrs;
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

const describeError = (err: unknown): string => {
  try {
    return err instanceof Error ? err.message : String(err);
  } catch {
    return "Unknown error";
  }
};

/** Keep error log attributes useful without allowing an unbounded record. */
const normalizeErrorMessage = (message: string | undefined): string | undefined => {
  if (!message) return undefined;
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}\u2026`
    : message;
};
