/**
 * Netlist MCP Server
 *
 * Model Context Protocol server for querying EDA netlists.
 * Supports Cadence OrCAD/CIS, Altium Designer, KiCad, and Universal Netlist formats.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "./version.js";
import { withTelemetry, instrumentMcpToolCalls, initOtel } from "./telemetry/index.js";
import { SERVER_INSTRUCTIONS } from "./descriptions.js";
import { TOOLS } from "./tools/index.js";
import { serviceContextFromEnvironment, type ServiceContext } from "./service/context.js";

// =============================================================================
// Helper Functions
// =============================================================================

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/**
 * Format a result as MCP tool response content. A result carrying an `image`
 * (render_page) sends it as image content, followed by the rest as JSON text.
 */
export const formatResult = (result: unknown): { content: Content[] } => {
  if (result && typeof result === "object" && "image" in result) {
    const { image, ...rest } = result as { image: { data: string; mimeType: string } };
    return {
      content: [
        { type: "image", data: image.data, mimeType: image.mimeType },
        { type: "text", text: JSON.stringify(rest, null, 2) },
      ],
    };
  }
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
};

// =============================================================================
// Server Setup
// =============================================================================

/**
 * Create and configure the MCP server.
 *
 * Every tool comes from the registry in `tools/index.ts`, which the command
 * line reads too, so both offer the same names, arguments and defaults. The
 * tools read designs through `context`: by default the local disk, with the
 * environment's `kicad-cli` and password settings.
 */
export const createServer = (
  context: ServiceContext = serviceContextFromEnvironment()
): McpServer => {
  const server = new McpServer(
    {
      name: "netlist-mcp-server",
      version: VERSION,
    },
    {
      // No `capabilities.tools` here: from SDK 1.32.2 a declared capability makes
      // McpServer register its tools/call handler in this constructor, before
      // instrumentMcpToolCalls can wrap it, and calls the SDK rejects would go
      // unrecorded. registerTool declares the capability with the first tool.
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // Wrap the complete SDK tools/call path so schema rejections are measured
  // before the SDK has a chance to return without invoking a tool handler.
  const assertToolCallsInstrumented = instrumentMcpToolCalls(server);

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
        formatResult(await tool.run(args, context))
      )
    );
  }
  assertToolCallsInstrumented();

  return server;
};

/**
 * Run the MCP server with stdio transport.
 */
export const runServer = async (): Promise<void> => {
  // Opt-in OpenTelemetry (no-op unless OTEL_* env is configured).
  await initOtel({ serviceName: "universal-netlist", serviceVersion: VERSION });
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
