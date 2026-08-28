/** Instrument MCP tool requests around the SDK's validation and dispatch. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { withTelemetry } from "./local.js";
import { runWithToolRequestState } from "./request-context.js";

type CallToolHandler = (
  request: CallToolRequest,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) => CallToolResult | Promise<CallToolResult>;

/**
 * Install telemetry at the `tools/call` request boundary.
 *
 * McpServer validates a registered tool's Zod schema before it invokes the
 * tool callback. Wrapping callbacks therefore misses schema rejections. The
 * underlying Server deliberately exposes `setRequestHandler` for advanced
 * request handling, so intercept its one tools/call registration and wrap the
 * complete SDK path: validation, callback dispatch, and error-result creation.
 */
export const instrumentMcpToolCalls = (mcp: McpServer): void => {
  const lowLevelServer = mcp.server;
  const setRequestHandler = lowLevelServer.setRequestHandler.bind(lowLevelServer);

  lowLevelServer.setRequestHandler = ((schema: unknown, handler: unknown): void => {
    if (schema !== CallToolRequestSchema) {
      setRequestHandler(schema as never, handler as never);
      return;
    }

    const callTool = handler as CallToolHandler;
    setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const args = request.params.arguments ?? {};
      const { result, handlerInstrumented } = await runWithToolRequestState(() =>
        Promise.resolve(callTool(request, extra))
      );

      // Existing handlers keep their wrapper so thrown exception classes and
      // application error results retain today's semantics. When validation
      // rejects before a handler starts, instrument the SDK-created result now.
      if (handlerInstrumented) return result;
      return withTelemetry(request.params.name, async () => result)(args);
    });
  }) as typeof lowLevelServer.setRequestHandler;
};
