/**
 * What a tool runs against: the parser context it reads designs through, and
 * the directory relative paths resolve against.
 */

import { parserContextFromEnvironment, type ParserContext } from "../parsers/context.js";

export interface ServiceContext {
  readonly parser: ParserContext;
  /**
   * The directory a relative design or search path resolves against. Omitted,
   * the process's working directory at the time of the call.
   */
  readonly root?: string;
}

/** The local disk and the environment's settings, as the MCP server and the CLI run. */
export const serviceContextFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env
): ServiceContext => ({ parser: parserContextFromEnvironment(env) });
