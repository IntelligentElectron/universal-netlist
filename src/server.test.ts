import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";

/**
 * Tool metadata as the Connectors Directory requires it.
 *
 * Every tool must carry a title and say whether it can write, because those
 * annotations decide what a client can run without asking the user first. A
 * submission with a tool missing either one is rejected, and the failure is
 * invisible from the source alone, so these assertions go through a real
 * client and read the tool list off the wire.
 */

/** The one tool that writes: it runs Cadence's exporter and lands files on disk. */
const WRITING_TOOLS = ["export_cadence_netlist"];

type ListedTool = {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

let tools: ListedTool[];

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), createServer().connect(serverTransport)]);
  tools = (await client.listTools()).tools as ListedTool[];
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
