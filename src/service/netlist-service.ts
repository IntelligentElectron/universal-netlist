/**
 * The library entry point: every tool as a method, run against the files,
 * root and settings the host chooses.
 *
 * Methods take one object whose fields are named as the tool's arguments
 * (`design`, `include_dns`, `design_variant`), are parsed by the tool's schema
 * so its defaults apply, and resolve to the tool's result. A failure is an
 * `{ error }` result, never a rejection.
 */

import {
  TOOLS,
  callTool,
  type AnyToolDefinition,
  type ToolArgs,
  type ToolResult,
  type listComponentsTool,
  type listDesignsTool,
  type listNetsTool,
  type queryComponentTool,
  type queryXnetByNetNameTool,
  type queryXnetByPinNameTool,
  type runErcTool,
  type searchComponentsByDescriptionTool,
  type searchComponentsByMpnTool,
  type searchComponentsByRefdesTool,
  type searchNetsTool,
} from "../tools/index.js";
import {
  nodeFileReader,
  passwordList,
  type FileReader,
  type KicadCliOptions,
} from "../parsers/context.js";
import type { ErrorResult } from "../types.js";
import type { ServiceContext } from "./context.js";

/** Secrets a design may need to open. */
export interface NetlistServiceSecrets {
  /** Passwords to try, in order, on a password-protected OrCAD `.DSN`. */
  readonly dsnPasswords?: readonly string[];
}

/** How a service reads designs. Every field is optional. */
export interface NetlistServiceOptions {
  /** Where design files are read from. Default: the local disk. */
  readonly files?: FileReader;
  /** The directory relative paths resolve against. Default: the working directory. */
  readonly root?: string;
  readonly secrets?: NetlistServiceSecrets;
  /**
   * How to run `kicad-cli` for a KiCad design with no saved `.net`, or `false`
   * to never run it. Default: on with the local disk, found at the platform's
   * install locations or on PATH; off with a custom `files` reader, since
   * `kicad-cli` reads the local disk itself.
   */
  readonly kicadCli?: KicadCliOptions | false;
}

type Method<T> = (args: ToolArgs<T>) => Promise<ToolResult<T> | ErrorResult>;

/** Every tool as a method, plus dispatch by tool name. */
export interface NetlistService {
  listDesigns(args?: ToolArgs<typeof listDesignsTool>): Promise<ToolResult<typeof listDesignsTool>>;
  listComponents: Method<typeof listComponentsTool>;
  listNets: Method<typeof listNetsTool>;
  searchNets: Method<typeof searchNetsTool>;
  searchComponentsByRefdes: Method<typeof searchComponentsByRefdesTool>;
  searchComponentsByMpn: Method<typeof searchComponentsByMpnTool>;
  searchComponentsByDescription: Method<typeof searchComponentsByDescriptionTool>;
  queryXnetByNetName: Method<typeof queryXnetByNetNameTool>;
  queryXnetByPinName: Method<typeof queryXnetByPinNameTool>;
  queryComponent: Method<typeof queryComponentTool>;
  runErc: Method<typeof runErcTool>;
  /** Call a tool by its snake_case name, as an MCP client would. */
  call(name: string, args?: unknown): Promise<unknown>;
  /** The tools this service offers. */
  readonly tools: readonly AnyToolDefinition[];
  /** What the service reads through. */
  readonly context: ServiceContext;
}

/** A service over an already built context: the MCP server's and the CLI's. */
export const serviceFor = (context: ServiceContext): NetlistService => {
  const call = (name: string, args: unknown = {}) => callTool(name, args, context);
  // Each method is its tool, named in camelCase; the cast restores the result
  // type the registry erased.
  const method =
    <T>(name: string): Method<T> =>
    (args) =>
      call(name, args) as Promise<ToolResult<T> | ErrorResult>;
  return Object.freeze({
    listDesigns: (args = {}) =>
      call("list_designs", args) as Promise<ToolResult<typeof listDesignsTool>>,
    listComponents: method<typeof listComponentsTool>("list_components"),
    listNets: method<typeof listNetsTool>("list_nets"),
    searchNets: method<typeof searchNetsTool>("search_nets"),
    searchComponentsByRefdes: method<typeof searchComponentsByRefdesTool>(
      "search_components_by_refdes"
    ),
    searchComponentsByMpn: method<typeof searchComponentsByMpnTool>("search_components_by_mpn"),
    searchComponentsByDescription: method<typeof searchComponentsByDescriptionTool>(
      "search_components_by_description"
    ),
    queryXnetByNetName: method<typeof queryXnetByNetNameTool>("query_xnet_by_net_name"),
    queryXnetByPinName: method<typeof queryXnetByPinNameTool>("query_xnet_by_pin_name"),
    queryComponent: method<typeof queryComponentTool>("query_component"),
    runErc: method<typeof runErcTool>("run_erc"),
    call,
    tools: TOOLS,
    context,
  });
};

/**
 * Create a service that reads designs as the options say. Nothing is taken
 * from the environment: a host passes the reader, root, secrets and
 * `kicad-cli` settings it wants.
 */
export const createNetlistService = (options: NetlistServiceOptions = {}): NetlistService => {
  const files = options.files ?? nodeFileReader;
  const kicadCli = options.kicadCli ?? (options.files ? false : {});
  return serviceFor({
    parser: {
      files,
      kicadCli,
      dsnPasswords: passwordList(options.secrets?.dsnPasswords),
    },
    ...(options.root !== undefined ? { root: options.root } : {}),
  });
};
