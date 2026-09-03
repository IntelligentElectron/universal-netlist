import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import {
  cadenceHandler,
  findHandler,
  getSupportedExtensions,
  parseDesign,
} from "./parsers/index.js";

/**
 * Tool metadata as the Connectors Directory requires it.
 *
 * Every tool must carry a title and say whether it can write, because those
 * annotations decide what a client can run without asking the user first. A
 * submission with a tool missing either one is rejected, and the failure is
 * invisible from the source alone, so these assertions go through a real
 * client and read the tool list off the wire.
 */

/** The Cadence exporter is dormant; every registered tool is read-only. */
const WRITING_TOOLS: string[] = [];

/** As much of a tool result as these assertions read. */
type ToolResult = { isError?: boolean; content?: Array<{ text?: string }> };

type ListedTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: { additionalProperties?: boolean; properties?: Record<string, unknown> };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

let tools: ListedTool[];
let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), createServer().connect(serverTransport)]);
  tools = (await client.listTools()).tools as ListedTool[];
});

describe("dormant Cadence MCP features", () => {
  it("omits DAT and exporter guidance from instructions, tool metadata, and the bundle manifest", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../manifest.json", import.meta.url), "utf8")
    );
    expect(manifest.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
      tools.map((tool) => tool.name).sort()
    );
    const advertised = JSON.stringify({ instructions: client.getInstructions(), tools, manifest });
    expect(advertised).not.toMatch(
      /\bDAT\b|\bHDL\b|\.cpm\b|pstxnet|pstxprt|pstchip|export_cadence_netlist/i
    );
  });

  it("does not register or execute the exporter even if a client knows its name", async () => {
    expect(tools.map((tool) => tool.name)).not.toContain("export_cadence_netlist");
    const result = (await client.callTool({
      name: "export_cadence_netlist",
      arguments: { design: "/not-opened.DSN" },
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("not found");
  });

  it.each(["pstxnet.dat", "PSTXNET.DAT", "design.cpm", "DESIGN.CPM"])(
    "rejects %s through MCP queries and direct handler dispatch",
    async (file) => {
      expect(findHandler(file)).toBeUndefined();
      await expect(parseDesign(file)).rejects.toThrow("Unsupported design format");
      await expect(cadenceHandler.parse(file)).rejects.toThrow("Query the .DSN schematic");
      const result = (await client.callTool({
        name: "list_nets",
        arguments: { design: file },
      })) as ToolResult;
      const body = JSON.parse(result.content![0].text!);
      expect(body.error).toContain("Unsupported design file format");
      expect(body.nets).toBeUndefined();
    }
  );

  it("lists only the schematic when HDL and standalone DAT designs are nearby", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-cadence-"));
    try {
      for (const file of ["board.DSN", "hdl.cpm", "pstxnet.dat", "pstxprt.dat", "pstchip.dat"]) {
        await writeFile(join(dir, file), "test");
      }
      const result = (await client.callTool({
        name: "list_designs",
        arguments: { path: dir },
      })) as ToolResult;
      expect(result.isError).not.toBe(true);
      const listed = JSON.parse(result.content![0].text!);
      expect(listed.designs).toEqual([{ name: "board", path: join(dir, "board.DSN") }]);
      expect(cadenceHandler.extensions).toEqual([".dsn"]);
      expect(getSupportedExtensions()).not.toContain(".cpm");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("tool annotations", () => {
  it("registers every tool with a title", () => {
    const untitled = tools.filter((t) => !t.title?.trim()).map((t) => t.name);
    expect(untitled).toEqual([]);
  });

  it("registers every tool with a read-only hint", () => {
    const unannotated = tools
      .filter((t) => typeof t.annotations?.readOnlyHint !== "boolean")
      .map((t) => t.name);
    expect(unannotated).toEqual([]);
  });

  it("marks exactly the writing tools as not read-only", () => {
    const writers = tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name);
    expect(writers.sort()).toEqual([...WRITING_TOOLS].sort());
  });

  it("marks every writing tool destructive, and no read-only tool", () => {
    for (const tool of tools) {
      const readOnly = tool.annotations?.readOnlyHint;
      expect(tool.annotations?.destructiveHint, tool.name).toBe(!readOnly);
    }
  });

  it("reports every tool as closed-world, since all of them read local files", () => {
    for (const tool of tools) {
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
  });

  it("keeps tool names within the 64-character directory limit", () => {
    const overlong = tools.filter((t) => t.name.length > 64).map((t) => t.name);
    expect(overlong).toEqual([]);
  });

  it("gives every tool a description", () => {
    const undescribed = tools.filter((t) => !t.description?.trim()).map((t) => t.name);
    expect(undescribed).toEqual([]);
  });
});

/**
 * Arguments the schema does not define are refused rather than dropped.
 *
 * A tool declared with a plain shape is parsed by an object that strips what it
 * does not recognise, so a misspelled argument arrives as no argument at all.
 * Where the argument was optional that is silent: the default runs and the tool
 * answers a question nobody asked, in a well-formed result with nothing in it to
 * check. `list_designs` searched the server's working directory that way, and
 * `run_erc` ran every rule that way. Declaring each tool with `z.strictObject`
 * turns both into an error naming the argument.
 */
describe("unrecognised arguments", () => {
  it("declares every tool closed to arguments it does not define", () => {
    const open = tools
      .filter((t) => t.inputSchema?.additionalProperties !== false)
      .map((t) => t.name);
    expect(open).toEqual([]);
  });

  /** The refusal arrives as an error result, and it names the argument. */
  const refusalFor = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const result = (await client.callTool({ name, arguments: args })) as ToolResult;
    expect(result.isError, `${name} accepted ${JSON.stringify(args)}`).toBe(true);
    return result.content?.[0]?.text ?? "";
  };

  it("refuses a misspelled optional argument instead of running the default", async () => {
    // The real mistake: `path` is what the tool takes, `searchPath` is what the
    // function behind it takes, and the near-miss used to search the server's
    // working directory without saying so.
    expect(await refusalFor("list_designs", { search_path: "/tmp" })).toContain(
      'Unrecognized key: "search_path"'
    );
  });

  it("refuses a misspelled optional argument on a tool that selects its own work", async () => {
    // `include_rules` is the argument; `rules` used to be dropped, which ran
    // every rule and reported that as the selection.
    expect(
      await refusalFor("run_erc", {
        design: "/does/not/matter.kicad_pro",
        rules: ["net.single_pin"],
      })
    ).toContain('Unrecognized key: "rules"');
  });

  it("still accepts the arguments a tool does define", async () => {
    const result = (await client.callTool({
      name: "list_designs",
      arguments: { path: "/nonexistent-on-purpose", max_results: 1 },
    })) as ToolResult;
    // Reaching the tool at all is the point; the directory is missing, so it
    // reports that rather than a validation failure.
    expect(result.content?.[0]?.text ?? "").toContain("Failed to search");
  });
});
