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

export const SIGNALS = ["traces", "metrics", "logs"] as const;
export type Signal = (typeof SIGNALS)[number];

/** A packager's defaults, each used only when its `OTEL_*` variable is empty. */
export interface OtelBuildDefaults {
  readonly endpoint?: string;
  readonly protocol?: string;
  readonly resourceAttributes?: Readonly<Record<string, string>>;
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

  return {
    enabled: true,
    signals,
    resourceAttributes: read(env, "OTEL_RESOURCE_ATTRIBUTES")
      ? {}
      : (defaults.resourceAttributes ?? {}),
    warnings,
  };
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
 * A design's path relative to `UNIVERSAL_NETLIST_DESIGN_ROOT`, forward slashes on
 * every platform. Undefined without a root, for a file that is no design, and for
 * one outside the root: an absolute path is never recorded.
 */
export const designPathAttribute = (design: unknown, env: Env): string | undefined => {
  const root = read(env, "UNIVERSAL_NETLIST_DESIGN_ROOT");
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
