/** Per-request state shared by MCP dispatch and tool-handler telemetry. */

import { AsyncLocalStorage } from "node:async_hooks";

/** What telemetry records about the `tools/call` request a tool is answering. */
export interface ToolRequest {
  readonly id?: string;
  readonly sessionId?: string;
  /** The request's `params._meta`, which may carry the caller's trace context. */
  readonly meta?: Record<string, unknown>;
  readonly protocolVersion?: string;
  readonly networkTransport?: string;
}

interface ToolRequestState {
  handlerInstrumented: boolean;
  request: ToolRequest;
}

const toolRequestState = new AsyncLocalStorage<ToolRequestState>();

/** Run SDK dispatch with isolated state, including when requests overlap. */
export const runWithToolRequestState = async <T>(
  request: ToolRequest,
  run: () => Promise<T>
): Promise<{ result: T; handlerInstrumented: boolean }> => {
  const state: ToolRequestState = { handlerInstrumented: false, request };
  const result = await toolRequestState.run(state, run);
  return { result, handlerInstrumented: state.handlerInstrumented };
};

/**
 * Mark that the normal handler-level wrapper owns telemetry for this request, and
 * hand it the request it is answering.
 */
export const markToolHandlerInstrumented = (): ToolRequest | undefined => {
  const state = toolRequestState.getStore();
  if (!state) return undefined;
  state.handlerInstrumented = true;
  return state.request;
};
