/**
 * Whether OpenTelemetry runs and where each signal goes, decided in one place.
 *
 * Pure: everything comes from the environment and the build's defaults, so the
 * golden tables in `docs/decision-tables/otel-config/` replay against it. It reads
 * the variables the OpenTelemetry specification defines, under the specification's
 * rules for booleans, enums and empty values. The application adds two things:
 *
 *  - The SDK stays dormant until something asks for an export. An endpoint, an
 *    `otlp` exporter selection or `UNIVERSAL_NETLIST_OTEL_DIR` asks.
 *  - `UNIVERSAL_NETLIST_OTEL_DIR` writes OTLP JSON Lines files. The specification
 *    defines that format but no variable that names a file, and it reserves the
 *    `OTEL_` prefix, so the variable carries this program's name.
 */

import { join, posix, relative, resolve, sep, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";

export const SIGNALS = ["traces", "metrics", "logs"] as const;
export type Signal = (typeof SIGNALS)[number];

/** A packager's defaults, each used only when the environment provides no value. */
export interface OtelBuildDefaults {
  readonly endpoint?: string;
  readonly protocol?: string;
  readonly resourceAttributes?: Readonly<Record<string, string>>;
  /** The OTLP exporters' forward proxy, when no proxy variable is set. */
  readonly proxy?: string;
  /** `UNIVERSAL_NETLIST_DESIGN_ROOT` when that is empty. A leading `~` is the user's home. */
  readonly designRoot?: string;
}

export type OtlpProtocol = "http/protobuf" | "http/json";

export type SignalDestination =
  | { readonly kind: "none" }
  | { readonly kind: "file"; readonly path: string }
  | {
      readonly kind: "otlp";
      readonly protocol: OtlpProtocol;
      /** Set only from a build default: code configuration overrides the environment. */
      readonly url?: string;
    };

export interface OtelConfig {
  readonly enabled: boolean;
  readonly signals: Readonly<Record<Signal, SignalDestination>>;
  readonly resourceAttributes: Readonly<Record<string, string>>;
  /** What the specification says to warn about, for the caller to report. */
  readonly warnings: readonly string[];
}

export type Env = Readonly<Record<string, string | undefined>>;

/** An environment variable's value; the specification treats empty as unset. */
const read = (env: Env, name: string): string | undefined => env[name]?.trim() || undefined;

/**
 * The specification's boolean: only case-insensitive `true` is true. The SDK warns
 * about any other value but `false` when it starts.
 */
const readBoolean = (env: Env, name: string): boolean => read(env, name)?.toLowerCase() === "true";

const SELECTOR_NAMES: Readonly<Record<Signal, string>> = {
  traces: "OTEL_TRACES_EXPORTER",
  metrics: "OTEL_METRICS_EXPORTER",
  logs: "OTEL_LOGS_EXPORTER",
};

/**
 * One signal's `OTEL_*_EXPORTER`, a comma-separated enum. A value this program has
 * no exporter for gets a warning and is ignored, as the specification says.
 * `console` and `otlp/stdout` are among those: stdout carries MCP and command results.
 */
const readSelector = (
  env: Env,
  signal: Signal,
  warnings: string[]
): "otlp" | "none" | undefined => {
  const name = SELECTOR_NAMES[signal];
  const value = read(env, name);
  if (value === undefined) return undefined;
  const values = value.split(",").map((part) => part.trim().toLowerCase());
  for (const part of values) {
    if (part !== "otlp" && part !== "none" && part !== "") {
      warnings.push(`${name}: '${part}' is not supported here (otlp or none); ignored`);
    }
  }
  if (values.includes("otlp")) return "otlp";
  return values.includes("none") ? "none" : undefined;
};

const readProtocol = (
  env: Env,
  signal: Signal,
  defaults: OtelBuildDefaults,
  warn: (warning: string) => void
): OtlpProtocol => {
  const name = `OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_PROTOCOL`;
  const value = (
    read(env, name) ??
    read(env, "OTEL_EXPORTER_OTLP_PROTOCOL") ??
    defaults.protocol ??
    "http/protobuf"
  ).toLowerCase();
  if (value === "http/json" || value === "http/protobuf") return value;
  warn(
    value === "grpc"
      ? "OTLP protocol grpc is not supported here; using http/protobuf"
      : `OTLP protocol '${value}' is not known; using http/protobuf`
  );
  return "http/protobuf";
};

const signalEndpoint = (env: Env, signal: Signal): string | undefined =>
  read(env, `OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`);

/** The build default's URL for a signal, unless the environment names an endpoint for it. */
const defaultUrl = (env: Env, signal: Signal, defaults: OtelBuildDefaults): string | undefined => {
  if (!defaults.endpoint) return undefined;
  if (signalEndpoint(env, signal) || read(env, "OTEL_EXPORTER_OTLP_ENDPOINT")) return undefined;
  return `${defaults.endpoint.replace(/\/+$/, "")}/v1/${signal}`;
};

const OFF: Readonly<Record<Signal, SignalDestination>> = {
  traces: { kind: "none" },
  metrics: { kind: "none" },
  logs: { kind: "none" },
};

/** Decide whether telemetry runs, and where each signal goes. */
export const resolveOtelConfig = (env: Env, defaults: OtelBuildDefaults = {}): OtelConfig => {
  const warnings: string[] = [];
  const warnOnce = (warning: string): void => {
    if (!warnings.includes(warning)) warnings.push(warning);
  };
  const off = (): OtelConfig => ({
    enabled: false,
    signals: OFF,
    resourceAttributes: {},
    warnings,
  });

  if (readBoolean(env, "OTEL_SDK_DISABLED")) return off();

  const directory = read(env, "UNIVERSAL_NETLIST_OTEL_DIR");
  const selectors = {
    traces: readSelector(env, "traces", warnings),
    metrics: readSelector(env, "metrics", warnings),
    logs: readSelector(env, "logs", warnings),
  };
  const asked =
    Boolean(directory || defaults.endpoint || read(env, "OTEL_EXPORTER_OTLP_ENDPOINT")) ||
    SIGNALS.some((signal) => signalEndpoint(env, signal) || selectors[signal] === "otlp");
  if (!asked) return off();

  const destination = (signal: Signal): SignalDestination => {
    const selector = selectors[signal];
    if (selector === "none") return { kind: "none" };
    if (selector === undefined && directory) {
      return { kind: "file", path: join(directory, `${signal}.jsonl`) };
    }
    const url = defaultUrl(env, signal, defaults);
    return {
      kind: "otlp",
      protocol: readProtocol(env, signal, defaults, warnOnce),
      ...(url ? { url } : {}),
    };
  };
  const signals = {
    traces: destination("traces"),
    metrics: destination("metrics"),
    logs: destination("logs"),
  };
  if (SIGNALS.every((signal) => signals[signal].kind === "none")) return off();

  if (read(env, "OTEL_CAPTURE_TOOL_ARGS")) {
    warnings.push("OTEL_CAPTURE_TOOL_ARGS is deprecated; use UNIVERSAL_NETLIST_CAPTURE_ARGS");
  }
  const content = read(env, GENAI_CAPTURE_CONTENT);
  if (content !== undefined && !(content.toUpperCase() in CONTENT_CAPTURE)) {
    warnings.push(`${GENAI_CAPTURE_CONTENT}='${content}' is not a capture mode; capturing nothing`);
  }

  return {
    enabled: true,
    signals,
    resourceAttributes: read(env, "OTEL_RESOURCE_ATTRIBUTES")
      ? {}
      : (defaults.resourceAttributes ?? {}),
    warnings,
  };
};

const PROXY_VARIABLES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];

/**
 * The variables an OTLP exporter's agent reads its forward proxy from, undefined when
 * it has no proxy. Any proxy variable leaves the choice to the environment. A built-in
 * proxy takes all four names and keeps the environment's `NO_PROXY`, in a copy, so
 * other HTTP traffic never sees it.
 */
export const exportProxyEnv = (env: Env, defaults: OtelBuildDefaults = {}): Env | undefined => {
  if (PROXY_VARIABLES.some((name) => read(env, name))) return env;
  const { proxy } = defaults;
  if (!proxy) return undefined;
  return { ...env, ...Object.fromEntries(PROXY_VARIABLES.map((name) => [name, proxy])) };
};

/**
 * Whether raw arguments are recorded. `OTEL_CAPTURE_TOOL_ARGS` is the deprecated
 * name, and keeps the `1` it was documented to take.
 */
export const captureArgsEnabled = (env: Env): boolean => {
  const value = read(env, "UNIVERSAL_NETLIST_CAPTURE_ARGS");
  if (value !== undefined) return value.toLowerCase() === "true";
  const legacy = read(env, "OTEL_CAPTURE_TOOL_ARGS")?.toLowerCase();
  return legacy === "true" || legacy === "1";
};

/** Which signals carry a tool call's arguments. */
export interface ToolArgsCapture {
  readonly span: boolean;
  readonly log: boolean;
}

/** The variable the GenAI conventions name for this, and the values they give it. */
const GENAI_CAPTURE_CONTENT = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT";
const CONTENT_CAPTURE: Readonly<Record<string, ToolArgsCapture>> = {
  NO_CONTENT: { span: false, log: false },
  SPAN_ONLY: { span: true, log: false },
  EVENT_ONLY: { span: false, log: true },
  SPAN_AND_EVENT: { span: true, log: true },
};

/**
 * Where a tool call's arguments go. The conventions' variable decides when it is set,
 * and an unknown value captures nothing, as they say. Otherwise this program's own
 * switch puts them on both signals.
 */
export const toolArgsCapture = (env: Env): ToolArgsCapture => {
  const content = read(env, GENAI_CAPTURE_CONTENT);
  if (content !== undefined)
    return CONTENT_CAPTURE[content.toUpperCase()] ?? CONTENT_CAPTURE.NO_CONTENT;
  const capture = captureArgsEnabled(env);
  return { span: capture, log: capture };
};

/**
 * How a tool call ended. `is_error` is a result the client sees as `isError: true`,
 * and a throw reaches the client the same way, since the SDK turns it into one.
 * `payload` is a successful response that carries an error in its content.
 */
export type ToolFailureKind = "none" | "payload" | "is_error" | "thrown";

/**
 * A tool failure's `error.type`: the conventions say `tool_error` for an `isError`
 * result and a low-cardinality name for an error in the payload. The category names
 * the cause on every failure, since `tool_error` does not.
 */
export const toolErrorAttributes = <T extends string>(
  kind: ToolFailureKind,
  failure: unknown,
  classify: (failure: unknown) => T
): { errorType?: T | "tool_error"; category?: T } => {
  if (kind === "none") return {};
  const category = classify(failure);
  return { errorType: kind === "payload" ? category : "tool_error", category };
};

/** The extensions of a design file, the only paths recorded. */
const DESIGN_EXTENSIONS = [
  ".dsn",
  ".prjpcb",
  ".schdoc",
  ".kicad_pro",
  ".kicad_sch",
  ".netlist.json",
];

const realPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/**
 * A built-in root with its leading `~` as the user's home, so one value works for every
 * user. Undefined when the system names no usable home, as under an empty `HOME`:
 * telemetry must not fail a tool call or record against some other directory.
 */
const expandHome = (root: string): string | undefined => {
  if (!/^~($|[/\\])/.test(root)) return root;
  try {
    const home = homedir();
    return home && isAbsolute(home) ? join(home, root.slice(1)) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A design's path relative to `UNIVERSAL_NETLIST_DESIGN_ROOT`, or to the build's
 * `designRoot` when that is empty, forward slashes on every platform. Undefined without
 * a root, for a file that is no design, and for one outside the root: an absolute path
 * is never recorded.
 */
export const designPathAttribute = (
  design: unknown,
  env: Env,
  defaults: OtelBuildDefaults = {}
): string | undefined => {
  const root =
    read(env, "UNIVERSAL_NETLIST_DESIGN_ROOT") ??
    (defaults.designRoot ? expandHome(defaults.designRoot) : undefined);
  if (!root || typeof design !== "string") return undefined;
  const lower = design.toLowerCase();
  if (!DESIGN_EXTENSIONS.some((extension) => lower.endsWith(extension))) return undefined;
  const path = relative(realPath(root), realPath(design));
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return undefined;
  return path.split(sep).join(posix.sep);
};

/**
 * `error.type` of a finished command: none on exit 0, `invalid_argument` on the
 * usage exit 2, and otherwise what the classifier makes of the failure.
 */
export const commandErrorType = <T extends string>(
  exitCode: number,
  failure: unknown,
  classify: (failure: unknown) => T
): T | "invalid_argument" | undefined => {
  if (exitCode === 0) return undefined;
  return exitCode === 2 ? "invalid_argument" : classify(failure);
};
