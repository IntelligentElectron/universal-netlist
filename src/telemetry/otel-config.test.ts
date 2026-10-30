/** What the golden tables leave out: warnings, per-signal choices, and the build's defaults. */
import { describe, expect, it } from "vitest";
import { captureArgsEnabled, designPathAttribute, resolveOtelConfig } from "./otel-config.js";

const ENDPOINT = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector" };

describe("resolveOtelConfig", () => {
  it("is off with an empty environment and no build defaults", () => {
    expect(resolveOtelConfig({}).enabled).toBe(false);
  });

  it("reads an empty variable as unset", () => {
    expect(
      resolveOtelConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "", UNIVERSAL_NETLIST_OTEL_DIR: " " })
        .enabled
    ).toBe(false);
  });

  it("runs under OTEL_SDK_DISABLED=1, as the specification requires", () => {
    expect(resolveOtelConfig({ ...ENDPOINT, OTEL_SDK_DISABLED: "1" }).enabled).toBe(true);
  });

  it("chooses each signal's destination on its own", () => {
    const { signals } = resolveOtelConfig({
      ...ENDPOINT,
      UNIVERSAL_NETLIST_OTEL_DIR: "/telemetry",
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_METRICS_EXPORTER: "NONE",
    });
    expect(signals.traces.kind).toBe("otlp");
    expect(signals.metrics.kind).toBe("none");
    expect(signals.logs).toEqual({ kind: "file", path: "/telemetry/logs.jsonl" });
  });

  it("gives each signal its own file, as the file format requires", () => {
    const { signals } = resolveOtelConfig({ UNIVERSAL_NETLIST_OTEL_DIR: "/telemetry" });
    expect(signals.traces).toEqual({ kind: "file", path: "/telemetry/traces.jsonl" });
    expect(signals.metrics).toEqual({ kind: "file", path: "/telemetry/metrics.jsonl" });
    expect(signals.logs).toEqual({ kind: "file", path: "/telemetry/logs.jsonl" });
  });

  it("warns about an exporter that would write to stdout, and does not use it", () => {
    const config = resolveOtelConfig({ ...ENDPOINT, OTEL_TRACES_EXPORTER: "console,otlp" });
    expect(config.signals.traces.kind).toBe("otlp");
    expect(config.warnings.join()).toContain("'console' is not supported");
  });

  it("does not turn on for an exporter it cannot use, and says so", () => {
    const config = resolveOtelConfig({ OTEL_TRACES_EXPORTER: "console" });
    expect(config.enabled).toBe(false);
    expect(config.warnings.join()).toContain("'console' is not supported");
  });

  it("warns once about a protocol all three signals share", () => {
    const { warnings } = resolveOtelConfig({ ...ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" });
    expect(warnings).toHaveLength(1);
  });

  it("reads the per-signal protocol before the general one", () => {
    const { signals } = resolveOtelConfig({
      ...ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/protobuf",
    });
    expect(signals.traces).toMatchObject({ protocol: "http/json" });
    expect(signals.logs).toMatchObject({ protocol: "http/protobuf" });
  });

  it("falls back to http/protobuf with a warning for a protocol it lacks", () => {
    const config = resolveOtelConfig({ ...ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" });
    expect(config.signals.traces).toMatchObject({ protocol: "http/protobuf" });
    expect(config.warnings.join()).toContain("grpc");
  });

  it("gives a signal the build default only when no endpoint variable covers it", () => {
    const defaults = { endpoint: "https://packaged", protocol: "http/json" };
    const { signals } = resolveOtelConfig(
      { OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://own" },
      defaults
    );
    expect(signals.traces).toEqual({
      kind: "otlp",
      protocol: "http/json",
      url: "https://packaged/v1/traces",
    });
    expect(signals.metrics).toEqual({ kind: "otlp", protocol: "http/json" });
  });

  it("lets OTEL_SDK_DISABLED turn a build default off", () => {
    const config = resolveOtelConfig(
      { OTEL_SDK_DISABLED: "true" },
      { endpoint: "https://packaged" }
    );
    expect(config.enabled).toBe(false);
  });

  it("uses a packager's resource attributes only when the variable is empty", () => {
    const defaults = { endpoint: "https://packaged", resourceAttributes: { team: "eda" } };
    expect(resolveOtelConfig({}, defaults).resourceAttributes).toEqual({ team: "eda" });
    expect(
      resolveOtelConfig({ OTEL_RESOURCE_ATTRIBUTES: "team=other" }, defaults).resourceAttributes
    ).toEqual({});
  });

  it("warns that OTEL_CAPTURE_TOOL_ARGS is deprecated", () => {
    const config = resolveOtelConfig({ ...ENDPOINT, OTEL_CAPTURE_TOOL_ARGS: "1" });
    expect(config.warnings.join()).toContain("UNIVERSAL_NETLIST_CAPTURE_ARGS");
  });
});

describe("captureArgsEnabled", () => {
  it.each([
    [{}, false],
    [{ UNIVERSAL_NETLIST_CAPTURE_ARGS: "true" }, true],
    [{ UNIVERSAL_NETLIST_CAPTURE_ARGS: "1" }, false],
    [{ OTEL_CAPTURE_TOOL_ARGS: "1" }, true],
    [{ OTEL_CAPTURE_TOOL_ARGS: "true" }, true],
    [{ OTEL_CAPTURE_TOOL_ARGS: "0" }, false],
    [{ UNIVERSAL_NETLIST_CAPTURE_ARGS: "false", OTEL_CAPTURE_TOOL_ARGS: "1" }, false],
  ])("%j is %s", (env, expected) => {
    expect(captureArgsEnabled(env)).toBe(expected);
  });
});

describe("designPathAttribute", () => {
  it("ignores an argument that is not a path", () => {
    expect(designPathAttribute(42, { UNIVERSAL_NETLIST_DESIGN_ROOT: "/" })).toBeUndefined();
  });
});
