/** What the golden tables leave out: warnings, per-signal choices, and the build's defaults. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  captureArgsEnabled,
  designPathAttribute,
  exportProxyEnv,
  resolveOtelConfig,
} from "./otel-config.js";

const { homeAnswer } = vi.hoisted(() => ({
  homeAnswer: { call: undefined as (() => string) | undefined },
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => (homeAnswer.call ?? actual.homedir)(),
  };
});

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

  it("does not turn on for a built-in proxy or design root alone", () => {
    const config = resolveOtelConfig({}, { proxy: "http://proxy:3128", designRoot: "~/designs" });
    expect(config.enabled).toBe(false);
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

describe("exportProxyEnv", () => {
  const defaults = { proxy: "http://built-in:3128" };

  it("reads a blank proxy variable as unset", () => {
    expect(exportProxyEnv({ HTTPS_PROXY: " " })).toBeUndefined();
    expect(exportProxyEnv({ HTTPS_PROXY: " " }, defaults)?.HTTPS_PROXY).toBe(defaults.proxy);
  });

  it("gives the built-in proxy every name, ahead of a blank lowercase one", () => {
    expect(exportProxyEnv({ https_proxy: "" }, defaults)?.https_proxy).toBe(defaults.proxy);
  });

  it("keeps the lowercase no_proxy", () => {
    expect(exportProxyEnv({ no_proxy: "collector" }, defaults)?.no_proxy).toBe("collector");
  });
});

describe("designPathAttribute", () => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "un-design-home-")));
  const design = path.join(home, "designs", "board.kicad_pro");
  mkdirSync(path.dirname(design));
  writeFileSync(design, "");
  beforeAll(() => {
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
  });
  afterEach(() => {
    homeAnswer.call = undefined;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("ignores an argument that is not a path", () => {
    expect(designPathAttribute(42, { UNIVERSAL_NETLIST_DESIGN_ROOT: "/" })).toBeUndefined();
  });

  it.each([
    ["a bare ~", "~", "designs/board.kicad_pro"],
    ["~/", "~/designs", "board.kicad_pro"],
  ])("expands %s in a built-in root to the home directory", (_label, designRoot, expected) => {
    expect(designPathAttribute(design, {}, { designRoot })).toBe(expected);
  });

  it.runIf(process.platform === "win32")("expands ~ and a backslash on Windows", () => {
    expect(designPathAttribute(design, {}, { designRoot: "~\\designs" })).toBe("board.kicad_pro");
  });

  it("leaves ~user alone, which names another user's home", () => {
    expect(designPathAttribute(design, {}, { designRoot: "~other/designs" })).toBeUndefined();
  });

  it("reads the variable as written, with no expansion", () => {
    const env = { UNIVERSAL_NETLIST_DESIGN_ROOT: "~/designs" };
    expect(designPathAttribute(design, env)).toBeUndefined();
  });

  it("reads a blank variable as unset, so the built-in root applies", () => {
    const env = { UNIVERSAL_NETLIST_DESIGN_ROOT: " " };
    expect(designPathAttribute(design, env, { designRoot: "~/designs" })).toBe("board.kicad_pro");
  });

  it.each([
    [
      "names no home",
      () => {
        throw new Error("no home directory");
      },
    ],
    ["answers with an empty home", () => ""],
    ["answers with a relative home", () => "relative/home"],
  ])("records nothing when the system %s", (_label, call) => {
    homeAnswer.call = call;
    expect(designPathAttribute(design, {}, { designRoot: "~" })).toBeUndefined();
  });
});
