/** Per-request state shared by MCP dispatch and tool-handler telemetry. */

import { AsyncLocalStorage } from "node:async_hooks";

interface ToolRequestState {
  handlerInstrumented: boolean;
}

const toolRequestState = new AsyncLocalStorage<ToolRequestState>();

/** Run SDK dispatch with isolated state, including when requests overlap. */
export const runWithToolRequestState = async <T>(
  run: () => Promise<T>
): Promise<{ result: T; handlerInstrumented: boolean }> => {
  const state: ToolRequestState = { handlerInstrumented: false };
  const result = await toolRequestState.run(state, run);
  return { result, handlerInstrumented: state.handlerInstrumented };
};

/** Mark that the normal handler-level wrapper owns telemetry for this request. */
export const markToolHandlerInstrumented = (): void => {
  const state = toolRequestState.getStore();
  if (state) state.handlerInstrumented = true;
};
