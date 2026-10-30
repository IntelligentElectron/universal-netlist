/** Instrument MCP tool requests around the SDK's validation and dispatch. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { instrumentTool } from "./otel.js";
import {
  markToolHandlerInstrumented,
  runWithToolRequestState,
  type ToolRequest,
} from "./request-context.js";

type CallToolHandler = (
  request: CallToolRequest,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) => CallToolResult | Promise<CallToolResult>;

/** Read the human-facing message from a formatted MCP error result. */
const getErrorContentMessage = (result: unknown): string | undefined => {
  if (typeof result !== "object" || result === null) return undefined;
  const r = result as { content?: Array<{ text?: string }>; isError?: boolean };
  if (!Array.isArray(r.content) || r.content.length === 0) return undefined;
  if (r.isError === true) return r.content[0].text || "Tool call failed";
  try {
    const parsed: unknown = JSON.parse(r.content[0].text ?? "");
    if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) return undefined;
    return typeof parsed.error === "string" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
};

/** Whether a result reaches the client as `isError: true`. */
const isToolErrorResult = (result: unknown): boolean =>
  typeof result === "object" && result !== null && "isError" in result && result.isError === true;

/**
 * Wrap a tool handler in OpenTelemetry's span, metrics and log (no-op unless
 * configured). The handler runs exactly once, inside the span. Both application
 * error content and MCP `isError` results created by the SDK for validation and
 * dispatch failures count as failures. `rejected` is the request of a call the SDK
 * refused, whose telemetry runs after its dispatch has finished.
 */
export const withTelemetry = <T extends Record<string, unknown>, R>(
  toolName: string,
  handler: (args: T) => Promise<R>,
  rejected?: ToolRequest
): ((args: T) => Promise<R>) => {
  return async (args: T): Promise<R> => {
    const request = rejected ?? markToolHandlerInstrumented();
    return instrumentTool(toolName, args as Record<string, unknown>, () => handler(args), {
      isErrorResult: (result) => getErrorContentMessage(result) !== undefined,
      isToolErrorResult,
      getErrorMessage: getErrorContentMessage,
      request,
    });
  };
};

/** The protocol version an `initialize` response negotiated, if this message is one. */
const negotiatedVersion = (message: unknown): string | undefined => {
  if (typeof message !== "object" || message === null || !("result" in message)) return undefined;
  const { result } = message;
  if (typeof result !== "object" || result === null || !("protocolVersion" in result)) {
    return undefined;
  }
  return typeof result.protocolVersion === "string" ? result.protocolVersion : undefined;
};

/**
 * Install telemetry at the `tools/call` request boundary.
 *
 * McpServer validates a registered tool's Zod schema before it invokes the
 * tool callback. Wrapping callbacks therefore misses schema rejections. The
 * underlying Server deliberately exposes `setRequestHandler` for advanced
 * request handling, so intercept its one tools/call registration and wrap the
 * complete SDK path: validation, callback dispatch, and error-result creation.
 */
export const instrumentMcpToolCalls = (mcp: McpServer): (() => void) => {
  const lowLevelServer = mcp.server;
  const setRequestHandler = lowLevelServer.setRequestHandler.bind(lowLevelServer);
  let wrapped = false;

  // The SDK keeps the negotiated version to itself, so read it from the initialize
  // response on its way out. The conventions record stdio as a pipe.
  let connection: Pick<ToolRequest, "protocolVersion" | "networkTransport"> = {};
  const connect = lowLevelServer.connect.bind(lowLevelServer);
  lowLevelServer.connect = async (transport: Transport): Promise<void> => {
    if (transport instanceof StdioServerTransport) {
      connection = { ...connection, networkTransport: "pipe" };
    }
    const send = transport.send.bind(transport);
    transport.send = (message, options) => {
      const protocolVersion = negotiatedVersion(message);
      if (protocolVersion) connection = { ...connection, protocolVersion };
      return send(message, options);
    };
    await connect(transport);
  };

  lowLevelServer.setRequestHandler = ((schema: unknown, handler: unknown): void => {
    if (schema !== CallToolRequestSchema) {
      setRequestHandler(schema as never, handler as never);
      return;
    }

    wrapped = true;
    const callTool = handler as CallToolHandler;
    setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const args = request.params.arguments ?? {};
      const toolRequest: ToolRequest = {
        ...connection,
        id: String(extra.requestId),
        sessionId: extra.sessionId,
        meta: request.params._meta,
      };
      const { result, handlerInstrumented } = await runWithToolRequestState(toolRequest, () =>
        Promise.resolve(callTool(request, extra))
      );

      // Existing handlers keep their wrapper so thrown exception classes and
      // application error results retain today's semantics. When validation
      // rejects before a handler starts, instrument the SDK-created result now.
      if (handlerInstrumented) return result;
      return withTelemetry(request.params.name, async () => result, toolRequest)(args);
    });
  }) as typeof lowLevelServer.setRequestHandler;

  // An SDK that registers tools/call before this runs (as 1.32.2 does when the
  // McpServer options declare the tools capability) bypasses the wrapper, and
  // rejected calls go unrecorded. Call this once the tools are registered.
  return (): void => {
    if (!wrapped) {
      throw new Error(
        "tools/call was registered before instrumentMcpToolCalls; rejected calls would not be recorded"
      );
    }
  };
};
