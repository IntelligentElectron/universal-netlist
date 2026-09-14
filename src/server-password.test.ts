import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import * as parsers from "./parsers/index.js";
import { resolvePath } from "./paths.js";

const design = "synthetic-protected.DSN";
const password = "synthetic-secret";
const requests: Record<string, Record<string, unknown>> = {
  list_components: { type: "R" },
  list_nets: {},
  search_nets: { pattern: "^VCC$" },
  search_components_by_refdes: { pattern: "R1" },
  search_components_by_mpn: { pattern: ".*" },
  search_components_by_description: { pattern: ".*" },
  query_component: { refdes: "R1" },
  query_xnet_by_net_name: { net_name: "VCC" },
  query_xnet_by_pin_name: { pin_name: "R1.1" },
  run_erc: {},
};
let client: Client;
let server: ReturnType<typeof createServer>;
beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "password-test", version: "0" });
  server = createServer();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await client.close();
  await server.close();
});
function mockParsing() {
  vi.spyOn(
    parsers.cadenceHandler as Required<typeof parsers.cadenceHandler>,
    "listVariants"
  ).mockResolvedValue([{ name: "Production" }]);
  return vi.spyOn(parsers, "parseDesign").mockImplementation(async (_path, options) => {
    if (options?.password !== password) throw new Error("Incorrect or missing DSN password");
    return {
      nets: { VCC: { R1: ["1"] }, GND: { R1: ["2"] } },
      components: { R1: { pins: { "1": "VCC", "2": "GND" } }, R2: { pins: {} } },
    };
  });
}
describe("MCP DSN passwords", () => {
  it("advertises an optional password on every design query", async () => {
    const { tools } = await client.listTools();
    const queries = tools.filter((tool) =>
      Object.hasOwn(tool.inputSchema.properties ?? {}, "design")
    );
    expect(queries.map((tool) => tool.name).sort()).toEqual(Object.keys(requests).sort());
    for (const tool of queries) {
      expect(tool.inputSchema.properties?.password).toMatchObject({ type: "string" });
      expect(tool.inputSchema.required ?? []).not.toContain("password");
    }
  });
  it.each(Object.entries(requests))(
    "forwards the password and variant through %s",
    async (name, extra) => {
      const parse = mockParsing();
      const response = await client.callTool({
        name,
        arguments: { design, password, design_variant: "production", ...extra },
      });
      expect(response.isError).not.toBe(true);
      expect(JSON.stringify(response)).not.toContain(password);
      expect(parse).toHaveBeenCalledExactlyOnceWith(resolvePath(design), {
        variant: "Production",
        password,
      });
      const body = JSON.parse((response.content as Array<{ text: string }>)[0].text);
      expect(body.design_variant).toBe("Production");
    }
  );
  it("does not retain a password between calls and rejects wrong passwords", async () => {
    mockParsing();
    for (const credential of [password, undefined, "wrong-secret"]) {
      const response = await client.callTool({
        name: "list_nets",
        arguments: {
          design,
          design_variant: "default",
          ...(credential === undefined ? {} : { password: credential }),
        },
      });
      const body = JSON.parse((response.content as Array<{ text: string }>)[0].text);
      if (credential === password) expect(body.nets).toEqual(["GND", "VCC"]);
      else expect(body.error).toBe("Incorrect or missing DSN password");
      expect(JSON.stringify(response)).not.toContain(password);
    }
  });
  it("rejects passwords for another vendor before parsing", async () => {
    const parse = mockParsing();
    const response = await client.callTool({
      name: "list_nets",
      arguments: { design: "board.kicad_pro", password },
    });
    expect(JSON.stringify(response)).toContain("Passwords are only supported for OrCAD .DSN files");
    expect(parse).not.toHaveBeenCalled();
  });
});

it("redacts malformed password arguments rejected at the MCP boundary", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { initTelemetry } = await import("./telemetry/local.js");
  const directory = mkdtempSync(join(tmpdir(), "mcp-password-log-"));
  const logPath = join(directory, "telemetry.jsonl");
  vi.stubEnv("UNIVERSAL_NETLIST_TELEMETRY_PATH", logPath);
  try {
    initTelemetry("invalid-password-test");
    const response = await client.callTool({
      name: "list_nets",
      arguments: { design, password: { secret: "synthetic-invalid-secret" } },
    });
    expect(response.isError).toBe(true);
    const text = readFileSync(logPath, "utf8");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("synthetic-invalid-secret");
    expect(JSON.stringify(response)).not.toContain("synthetic-invalid-secret");
  } finally {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
