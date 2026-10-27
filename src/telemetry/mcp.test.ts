import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { instrumentMcpToolCalls } from "./mcp.js";

const registerOneTool = (server: McpServer): void => {
  server.registerTool("echo", { inputSchema: { text: z.string() } }, async ({ text }) => ({
    content: [{ type: "text", text }],
  }));
};

describe("instrumentMcpToolCalls", () => {
  it("wraps tools/call when the SDK registers it with the first tool", () => {
    const server = new McpServer({ name: "t", version: "1" });
    const assertInstrumented = instrumentMcpToolCalls(server);
    registerOneTool(server);
    expect(assertInstrumented).not.toThrow();
  });

  it("throws when the SDK registered tools/call before it could be wrapped", () => {
    // Declaring the capability makes the SDK register tools/call in the constructor.
    const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } });
    const assertInstrumented = instrumentMcpToolCalls(server);
    registerOneTool(server);
    expect(assertInstrumented).toThrow(/registered before instrumentMcpToolCalls/);
  });
});
