/**
 * Every registered tool reports each call to OpenTelemetry exactly once, under
 * the name the client called, whether the tool runs or its input schema refuses the call,
 * and a tool's failures carry the category of their cause.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logs, type LogRecord, type LoggerProvider } from "@opentelemetry/api";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import { initOtel, shutdownOtel } from "./telemetry/otel.js";
import { DSN_PASSWORD, DSN_PASSWORD_FILE } from "./parsers/cadence/dsn/dsn-reader.js";
import { fixturePath, hasFixtures } from "../test/utils.js";
import { protectStream } from "../test/helpers/orcad-protect.js";
import { useClosedOtelExporter } from "../test/helpers/otel-environment.js";

const { protection } = vi.hoisted(() => ({
  protection: {} as { password?: string },
}));

/** Streams read as OrCAD writes them under `protection.password`. */
vi.mock("./parsers/ole-reader/ole-reader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parsers/ole-reader/ole-reader.js")>();
  class OleReader extends actual.OleReader {
    override readStreamByPath(path: string): Buffer {
      const data = super.readStreamByPath(path);
      return protection.password ? protectStream(path, data, protection.password) : data;
    }
  }
  return { ...actual, OleReader };
});

const UNIVERSAL = join(import.meta.dirname, "..", "test", "universal");

/** An argument value each tool accepts, by argument name. */
const SAMPLES: Record<string, unknown> = {
  path: UNIVERSAL,
  design: join(UNIVERSAL, "demo-board.netlist.json"),
  pattern: "U",
  type: "U",
  net_name: "PP5V",
  pin_name: "U1.1",
  refdes: "U1",
};

type ListedTool = {
  name: string;
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
};
type ToolResult = { isError?: boolean; content?: Array<{ text?: string }> };

const records: LogRecord[] = [];
const capture: LoggerProvider = {
  getLogger: () => ({
    emit: (record: LogRecord) => void records.push(record),
    enabled: () => true,
  }),
};
const directory = mkdtempSync(join(tmpdir(), "server-telemetry-"));
const notADesign = join(directory, "notes.jsonl");
let client: Client;
let tools: ListedTool[];

let restoreEnvironment: () => void;

beforeAll(async () => {
  restoreEnvironment = useClosedOtelExporter();
  writeFileSync(notADesign, "");
  await initOtel({ serviceName: "server-telemetry-test", serviceVersion: "0.0.0" });
  logs.disable();
  logs.setGlobalLoggerProvider(capture);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), createServer().connect(serverTransport)]);
  tools = (await client.listTools()).tools as ListedTool[];
});

afterAll(async () => {
  logs.disable();
  await shutdownOtel();
  restoreEnvironment();
  rmSync(directory, { recursive: true, force: true });
});

afterEach(() => {
  protection.password = undefined;
  vi.unstubAllEnvs();
});

/** Call a tool and return what OpenTelemetry recorded for the call alone. */
const call = async (name: string, args: Record<string, unknown>) => {
  records.length = 0;
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content?.[0]?.text ?? "";
  const failed = result.isError === true || "error" in (JSON.parse(text) as object);
  return { failed, otel: records.map((record) => record.attributes ?? {}) };
};

describe("tool call telemetry", () => {
  it("lists tools to check", () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it("has a sample for every required argument", () => {
    const missing = tools.flatMap((tool) =>
      (tool.inputSchema.required ?? [])
        .filter((argument) => !(argument in SAMPLES))
        .map((argument) => `${tool.name}.${argument}`)
    );
    expect(missing).toEqual([]);
  });

  it("records a call that runs the tool once, under its name", async () => {
    for (const tool of tools) {
      const args = Object.fromEntries(
        Object.keys(tool.inputSchema.properties ?? {})
          .filter((argument) => argument in SAMPLES)
          .map((argument) => [argument, SAMPLES[argument]])
      );
      const { failed, otel } = await call(tool.name, args);
      expect(failed, `${tool.name} failed on ${JSON.stringify(args)}`).toBe(false);
      expect(otel, tool.name).toEqual([
        expect.objectContaining({ "tool.name": tool.name, "tool.outcome": "success" }),
      ]);
    }
  });

  it("records a call its input schema refuses once, as an invalid argument", async () => {
    for (const tool of tools) {
      const { failed, otel } = await call(tool.name, { unrecognised_argument: true });
      expect(failed, tool.name).toBe(true);
      expect(otel, tool.name).toEqual([
        expect.objectContaining({
          "tool.name": tool.name,
          "tool.outcome": "error",
          "error.type": "invalid_argument",
        }),
      ]);
    }
  });

  it("records a call to a tool the server does not register as not found", async () => {
    const { failed, otel } = await call("list_variants", {});
    expect(failed).toBe(true);
    expect(otel).toEqual([
      expect.objectContaining({ "tool.name": "list_variants", "error.type": "not_found" }),
    ]);
  });
});

describe("tool failure categories", () => {
  const DSN = fixturePath(
    "cadence",
    "LAUNCHXL-CC1310",
    "doc",
    "hardware",
    "cc1310",
    "launchpad",
    "design_files",
    "Cadence",
    "LAUNCHXL-CC1310.DSN"
  );
  const project = join(directory, "Board.PrjPcb");

  beforeAll(() => writeFileSync(project, "[ProjectVariant1]\nDescription=Assembly\n"));

  /** The one category both sinks saw the call fail with. */
  const categoryOf = async (name: string, args: Record<string, unknown>) => {
    const { failed, otel } = await call(name, args);
    expect(failed).toBe(true);
    expect(otel).toHaveLength(1);
    return otel[0]["error.type"];
  };

  it.skipIf(!hasFixtures)("refuses a protected design without its password", async () => {
    vi.stubEnv(DSN_PASSWORD, "");
    vi.stubEnv(DSN_PASSWORD_FILE, "");
    protection.password = "synthetic password";
    const args = { design: DSN, design_variant: "Standard" };
    expect(await categoryOf("list_nets", args)).toBe("permission_denied");
    vi.stubEnv(DSN_PASSWORD, "not the password");
    expect(await categoryOf("list_nets", args)).toBe("permission_denied");
  });

  it.skipIf(!hasFixtures)("keeps passwords out of telemetry", async () => {
    vi.stubEnv("UNIVERSAL_NETLIST_CAPTURE_ARGS", "true");
    vi.stubEnv(DSN_PASSWORD_FILE, "");
    protection.password = "synthetic password";
    const args = { design: DSN, design_variant: "Standard" };
    for (const password of ["not the password", "synthetic password"]) {
      vi.stubEnv(DSN_PASSWORD, password);
      const { failed, otel } = await call("list_nets", args);
      expect(failed).toBe(password !== protection.password);
      expect(otel[0]["tool.args"]).toBe(JSON.stringify(args));
      expect(JSON.stringify(otel)).not.toContain(password);
    }
  });

  it.skipIf(!hasFixtures)("refuses a truncated design", async () => {
    const truncated = join(directory, "Truncated.DSN");
    writeFileSync(truncated, readFileSync(DSN).subarray(0, 4096));
    expect(await categoryOf("list_nets", { design: truncated, design_variant: "default" })).toBe(
      "invalid_argument"
    );
  });

  it("asks for a design variant the design needs", async () => {
    expect(await categoryOf("list_nets", { design: project })).toBe("invalid_argument");
  });

  it("finds no design variant the design does not define", async () => {
    expect(await categoryOf("list_nets", { design: project, design_variant: "Nope" })).toBe(
      "not_found"
    );
  });

  it("asks for a component prefix", async () => {
    const args = { design: SAMPLES.design, type: "" };
    expect(await categoryOf("list_components", args)).toBe("invalid_argument");
  });

  it("finds no design at a missing path", async () => {
    const args = { design: join(directory, "missing.netlist.json") };
    expect(await categoryOf("list_nets", args)).toBe("not_found");
  });

  it("refuses a file that is not a design", async () => {
    expect(await categoryOf("list_nets", { design: notADesign })).toBe("invalid_argument");
  });
});
