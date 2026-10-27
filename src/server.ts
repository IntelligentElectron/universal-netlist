/**
 * Netlist MCP Server
 *
 * Model Context Protocol server for querying EDA netlists.
 * Supports Cadence OrCAD/CIS, Altium Designer, KiCad, and Universal Netlist formats.
 */

import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "./version.js";
import {
  initTelemetry,
  withTelemetry,
  instrumentMcpToolCalls,
  initOtel,
} from "./telemetry/index.js";
import { SERVER_INSTRUCTIONS } from "./descriptions.js";
import { TOOLS } from "./tools/index.js";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a result as MCP tool response content.
 */
const formatResult = (result: unknown): { content: { type: "text"; text: string }[] } => ({
  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
});

// =============================================================================
// Server Setup
// =============================================================================

/**
 * Create and configure the MCP server.
 *
 * Every tool comes from the registry in `tools/index.ts`, which the command
 * line reads too, so both offer the same names, arguments and defaults.
 */
export const createServer = (): McpServer => {
  const server = new McpServer(
    {
      name: "netlist-mcp-server",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // Wrap the complete SDK tools/call path so schema rejections are measured
  // before the SDK has a chance to return without invoking a tool handler.
  instrumentMcpToolCalls(server);

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        annotations: tool.annotations,
        inputSchema: tool.inputSchema,
      },
      withTelemetry(tool.name, async (args: Record<string, unknown>) =>
        formatResult(await tool.run(args))
      )
    );
  }

  return server;
};

/**
 * Run the MCP server with stdio transport.
 */
export const runServer = async (): Promise<void> => {
  initTelemetry(crypto.randomUUID());
  // Opt-in OpenTelemetry (no-op unless OTEL_* env is configured).
  await initOtel({ serviceName: "universal-netlist", serviceVersion: VERSION });
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
