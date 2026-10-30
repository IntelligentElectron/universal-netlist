/**
 * Replays the golden decision tables in docs/decision-tables/otel-config against the
 * functions that decide whether telemetry runs and where it goes, one test per cell.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cellName, readTable } from "../../test/helpers/decision-table.js";
import {
  commandErrorType,
  designPathAttribute,
  resolveOtelConfig,
  toolArgsCapture,
  toolErrorAttributes,
  type ToolFailureKind,
} from "./otel-config.js";

const TABLES = path.resolve(__dirname, "../../docs/decision-tables/otel-config");

describe("golden table: destination", () => {
  const dims = ["sdk_disabled", "endpoint", "selector", "directory"];
  const disabled: Record<string, string | undefined> = {
    unset: undefined,
    true: "TRUE",
    other: "1",
  };
  const selector: Record<string, string | undefined> = {
    unset: undefined,
    otlp: "otlp",
    none: "none",
    unsupported: "console",
  };

  for (const row of readTable(TABLES, "destination")) {
    it(cellName(row, dims), () => {
      const config = resolveOtelConfig(
        {
          OTEL_SDK_DISABLED: disabled[row.sdk_disabled],
          OTEL_TRACES_EXPORTER: selector[row.selector],
          OTEL_METRICS_EXPORTER: selector[row.selector],
          OTEL_LOGS_EXPORTER: selector[row.selector],
          OTEL_EXPORTER_OTLP_ENDPOINT: row.endpoint === "env" ? "http://collector" : undefined,
          UNIVERSAL_NETLIST_OTEL_DIR: row.directory === "set" ? "/telemetry" : undefined,
        },
        row.endpoint === "build_default" ? { endpoint: "http://packaged" } : {}
      );
      expect(config.enabled).toBe(row.outcome !== "off");
      if (row.outcome !== "off") {
        for (const destination of Object.values(config.signals)) {
          expect(destination.kind).toBe(row.outcome);
        }
      }
    });
  }
});

describe("golden table: endpoint", () => {
  const dims = ["signal_env", "general_env", "build_default"];

  for (const row of readTable(TABLES, "endpoint")) {
    it(cellName(row, dims), () => {
      const config = resolveOtelConfig(
        {
          OTEL_TRACES_EXPORTER: "otlp",
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
            row.signal_env === "set" ? "http://signal/custom" : undefined,
          OTEL_EXPORTER_OTLP_ENDPOINT: row.general_env === "set" ? "http://general" : undefined,
        },
        row.build_default === "set" ? { endpoint: "http://packaged/" } : {}
      );
      // Only a build default sets a URL in code; the exporter reads the others itself.
      expect(config.signals.traces).toMatchObject({ kind: "otlp" });
      const url = (config.signals.traces as { url?: string }).url;
      expect(url).toBe(row.outcome === "build default" ? "http://packaged/v1/traces" : undefined);
    });
  }
});

describe("golden table: design-path", () => {
  const dims = ["root", "extension", "location"];
  const scratch = mkdtempSync(path.join(tmpdir(), "un-design-path-"));
  const root = path.join(scratch, "root");
  mkdirSync(path.join(root, "boards"), { recursive: true });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  for (const row of readTable(TABLES, "design-path")) {
    it(cellName(row, dims), () => {
      const name = row.extension === "design" ? "board.KiCad_Pro" : "notes.txt";
      const directory = row.location === "inside_root" ? path.join(root, "boards") : scratch;
      const design = path.join(directory, name);
      writeFileSync(design, "");
      const got = designPathAttribute(design, {
        UNIVERSAL_NETLIST_DESIGN_ROOT: row.root === "set" ? root : undefined,
      });
      expect(got).toBe(row.outcome === "relative path" ? `boards/${name}` : undefined);
    });
  }
});

describe("golden table: command-error", () => {
  const dims = ["exit_code", "failure"];
  const failures: Record<string, string | undefined> = {
    none: undefined,
    classifiable: "known",
    unclassifiable: "unknown",
  };
  const classify = (failure: unknown): string => (failure === "known" ? "classified" : "internal");

  for (const row of readTable(TABLES, "command-error")) {
    it(cellName(row, dims), () => {
      const got = commandErrorType(Number(row.exit_code), failures[row.failure], classify);
      expect(got ?? "none").toBe(row.outcome);
    });
  }
});

describe("golden table: tool-error", () => {
  const dims = ["failure", "cause"];
  const classify = (cause: unknown): string =>
    cause === "classifiable" ? "classified" : "internal";

  for (const row of readTable(TABLES, "tool-error")) {
    it(cellName(row, dims), () => {
      const got = toolErrorAttributes(row.failure as ToolFailureKind, row.cause, classify);
      expect(got.errorType ? `${got.errorType}, ${got.category}` : "none").toBe(row.outcome);
    });
  }
});

describe("golden table: tool-args-capture", () => {
  const dims = ["content", "own_switch"];
  const describeCapture = ({ span, log }: { span: boolean; log: boolean }): string =>
    span && log ? "span and log" : span ? "span" : log ? "log" : "none";

  for (const row of readTable(TABLES, "tool-args-capture")) {
    it(cellName(row, dims), () => {
      const env = {
        ...(row.content === "unset"
          ? {}
          : { OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT: row.content.toLowerCase() }),
        ...(row.own_switch === "on" ? { UNIVERSAL_NETLIST_CAPTURE_ARGS: "true" } : {}),
      };
      expect(describeCapture(toolArgsCapture(env))).toBe(row.outcome);
    });
  }
});
