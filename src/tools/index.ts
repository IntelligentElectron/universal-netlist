/**
 * Tool registry.
 *
 * One entry per tool: its name, title, description, annotations, input schema
 * and the function that runs it. The MCP server and the command line are both
 * built from this list, so a tool's name, arguments, defaults and behavior are
 * the same everywhere it is offered. An argument's default lives in its schema:
 * `run` receives the arguments after the schema has parsed them, defaults
 * applied. (The positional functions in `./service` still carry their own
 * copies of these defaults for their direct callers.) `callTool` is the entry point for raw arguments: it
 * parses them first, so an unknown or mistyped argument is refused instead of
 * being dropped or passed on.
 *
 * This module imports neither the MCP SDK nor OpenTelemetry, so a library that
 * embeds the tools does not load either.
 */

import { z } from "zod";
import { CADENCE_EXPORT_ENABLED } from "../features.js";
import type { ErrorResult } from "../types.js";
import {
  EXPORT_CADENCE_NETLIST_DESCRIPTION,
  LIST_COMPONENTS_DESCRIPTION,
  LIST_DESIGNS_DESCRIPTION,
  LIST_NETS_DESCRIPTION,
  QUERY_COMPONENT_DESCRIPTION,
  QUERY_XNET_BY_NET_NAME_DESCRIPTION,
  QUERY_XNET_BY_PIN_NAME_DESCRIPTION,
  RUN_ERC_DESCRIPTION,
  SEARCH_COMPONENTS_BY_DESCRIPTION_DESCRIPTION,
  SEARCH_COMPONENTS_BY_MPN_DESCRIPTION,
  SEARCH_COMPONENTS_BY_REFDES_DESCRIPTION,
  SEARCH_NETS_DESCRIPTION,
} from "../descriptions.js";
import {
  exportCadenceNetlist,
  listComponents,
  listDesigns,
  listNets,
  queryComponent,
  queryXnetByNetName,
  queryXnetByPinName,
  runErc,
  searchComponentsByDescription,
  searchComponentsByMpn,
  searchComponentsByRefdes,
  searchNets,
} from "../service/index.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Hints a client reads to decide which tools need the user's confirmation.
 * The fields are MCP's tool annotations, declared here so this module does not
 * depend on the MCP SDK.
 */
export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

/** One tool: what a client is told about it, and the function that runs it. */
export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  /** The tool's name, in snake_case, as MCP clients and the CLI call it. */
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
  /** A strict object schema: an argument it does not define is refused. */
  readonly inputSchema: S;
  /**
   * Run the tool on arguments already parsed by `inputSchema`. Raw arguments
   * go through `callTool`, which parses them first.
   */
  readonly run: (args: z.output<S>) => Promise<unknown>;
}

/** A tool whose argument types have been erased, as the registry lists them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<z.ZodObject<any>>;

/** Keep a tool's argument types while it is written, then erase them. */
const defineTool = <S extends z.ZodObject>(tool: ToolDefinition<S>): AnyToolDefinition =>
  Object.freeze(tool) as unknown as AnyToolDefinition;

// =============================================================================
// Shared annotations and arguments
// =============================================================================

/**
 * Every tool declares whether it can write, so a client can decide what needs
 * the user's confirmation. Read-only tools may run without one; a tool that
 * touches the disk always prompts.
 *
 * `openWorldHint` is false throughout: every tool operates on the design files
 * already on this machine, not on an open-ended set of external entities.
 */
export const READ_ONLY: ToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/**
 * `export_cadence_netlist` runs Cadence's own exporter, which writes a netlist
 * directory beside the schematic and overwrites an earlier export in place.
 */
export const WRITES_TO_DISK: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
});

/** One native design variant, or the explicit base build. */
const DESIGN_VARIANT_ARGUMENT = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Design variant name from list_designs' design_variants. Required when the design records named variants, which are its only builds. <Default> (alias: default) is the one build of a design that records none"
  );

/** Listing and search tools show DNS parts unless asked not to. */
const INCLUDE_DNS_IN_SEARCH = z
  .boolean()
  .optional()
  .default(true)
  .describe("Include DNS components, flagged dns=true. Pass false for fitted parts only");

/** Traversal leaves DNS parts out unless asked for them. */
const INCLUDE_DNS_IN_TRAVERSAL = z
  .boolean()
  .optional()
  .default(false)
  .describe("Include DNS components");

// =============================================================================
// Tools
// =============================================================================

const listDesignsTool = defineTool({
  name: "list_designs",
  title: "List designs",
  description: LIST_DESIGNS_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    path: z.string().optional().describe("Path to directory to search for designs"),
    pattern: z.string().optional().describe("Regex pattern to filter design names"),
    max_depth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Max directory recursion depth (0 = no recursion). Omit for unlimited."),
    max_results: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(50)
      .describe("Max designs to return. Default: 50."),
  }),
  run: ({ path, pattern, max_depth, max_results }) =>
    listDesigns({ searchPath: path, pattern, maxDepth: max_depth, maxResults: max_results }),
});

const listComponentsTool = defineTool({
  name: "list_components",
  title: "List components",
  description: LIST_COMPONENTS_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    design: z.string().describe("Path to design file, as returned by list_designs"),
    type: z.string().describe("Component prefix: U, C, R, L, etc."),
    include_dns: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Include DNS (Do Not Stuff) components, flagged dns=true. Pass false to list only fitted parts"
      ),
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ design, type, include_dns, design_variant }) =>
    listComponents(design, type, include_dns, design_variant),
});

const listNetsTool = defineTool({
  name: "list_nets",
  title: "List nets",
  description: LIST_NETS_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    design: z.string().describe("Path to design file"),
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ design, design_variant }) => listNets(design, design_variant),
});

const searchNetsTool = defineTool({
  name: "search_nets",
  title: "Search nets",
  description: SEARCH_NETS_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    pattern: z.string().describe("Regex pattern"),
    design: z.string().describe("Path to design file"),
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ pattern, design, design_variant }) => searchNets(pattern, design, design_variant),
});

const searchComponentsByRefdesTool = defineTool({
  name: "search_components_by_refdes",
  title: "Search components by refdes",
  description: SEARCH_COMPONENTS_BY_REFDES_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    pattern: z.string().describe("Regex pattern for refdes"),
    design: z.string().describe("Path to design file"),
    include_dns: INCLUDE_DNS_IN_SEARCH,
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ pattern, design, include_dns, design_variant }) =>
    searchComponentsByRefdes(pattern, design, include_dns, design_variant),
});

const searchComponentsByMpnTool = defineTool({
  name: "search_components_by_mpn",
  title: "Search components by MPN",
  description: SEARCH_COMPONENTS_BY_MPN_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    pattern: z.string().describe("Regex pattern for MPN"),
    design: z.string().describe("Path to design file"),
    include_dns: INCLUDE_DNS_IN_SEARCH,
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ pattern, design, include_dns, design_variant }) =>
    searchComponentsByMpn(pattern, design, include_dns, design_variant),
});

const searchComponentsByDescriptionTool = defineTool({
  name: "search_components_by_description",
  title: "Search components by description",
  description: SEARCH_COMPONENTS_BY_DESCRIPTION_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    pattern: z.string().describe("Regex pattern for description"),
    design: z.string().describe("Path to design file"),
    include_dns: INCLUDE_DNS_IN_SEARCH,
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ pattern, design, include_dns, design_variant }) =>
    searchComponentsByDescription(pattern, design, include_dns, design_variant),
});

const queryXnetByNetNameTool = defineTool({
  name: "query_xnet_by_net_name",
  title: "Trace XNET from a net",
  description: QUERY_XNET_BY_NET_NAME_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    design: z.string().describe("Path to design file"),
    net_name: z
      .string()
      .describe(
        "Net name. An exact match wins; otherwise it is matched ignoring leading and trailing whitespace, and for Cadence as a 31-character PSTWRITER 16.6 name"
      ),
    skip_types: z
      .array(z.string())
      .optional()
      .describe("Component prefixes to exclude (e.g., ['C', 'L'])"),
    include_dns: INCLUDE_DNS_IN_TRAVERSAL,
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ design, net_name, skip_types, include_dns, design_variant }) =>
    queryXnetByNetName(design, net_name, skip_types, include_dns, design_variant),
});

const queryXnetByPinNameTool = defineTool({
  name: "query_xnet_by_pin_name",
  title: "Trace XNET from a pin",
  description: QUERY_XNET_BY_PIN_NAME_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    design: z.string().describe("Path to design file"),
    pin_name: z.string().describe("Pin spec: REFDES.PIN (e.g., U2.10, U1.A5)"),
    skip_types: z.array(z.string()).optional().describe("Component prefixes to exclude"),
    include_dns: INCLUDE_DNS_IN_TRAVERSAL,
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ design, pin_name, skip_types, include_dns, design_variant }) =>
    queryXnetByPinName(design, pin_name, skip_types, include_dns, design_variant),
});

const queryComponentTool = defineTool({
  name: "query_component",
  title: "Get component details",
  description: QUERY_COMPONENT_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    design: z.string().describe("Path to design file"),
    refdes: z.string().describe("Component reference designator"),
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ design, refdes, design_variant }) => queryComponent(design, refdes, design_variant),
});

const runErcTool = defineTool({
  name: "run_erc",
  title: "Run electrical rule checks",
  description: RUN_ERC_DESCRIPTION,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    design: z.string().describe("Path to design file"),
    include_dns: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include DNS (Do Not Stuff) components in the checks"),
    include_rules: z
      .array(z.string())
      .optional()
      .describe("Only run these rule ids (e.g., ['net.single_pin']). Omit for all"),
    exclude_rules: z.array(z.string()).optional().describe("Skip these rule ids"),
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: ({ design, include_dns, include_rules, exclude_rules, design_variant }) =>
    runErc(design, {
      includeDns: include_dns,
      includeRules: include_rules,
      excludeRules: exclude_rules,
      designVariant: design_variant,
    }),
});

/** Dormant: registered only when `CADENCE_EXPORT_ENABLED` is on. */
const exportCadenceNetlistTool = defineTool({
  name: "export_cadence_netlist",
  title: "Export Cadence netlist (deprecated)",
  description: EXPORT_CADENCE_NETLIST_DESCRIPTION,
  annotations: WRITES_TO_DISK,
  inputSchema: z.strictObject({
    design: z.string().describe("Path to .DSN schematic file"),
  }),
  run: ({ design }) => exportCadenceNetlist(design),
});

// =============================================================================
// Registry
// =============================================================================

/**
 * Tools kept in the code but offered only when their feature flag is on
 * (src/features.ts). A tool not named here is always offered.
 */
const FEATURE_FLAGS: Readonly<Record<string, boolean>> = {
  export_cadence_netlist: CADENCE_EXPORT_ENABLED,
};

/** Every tool this build offers, in the order clients list them. */
export const TOOLS: readonly AnyToolDefinition[] = Object.freeze(
  [
    listDesignsTool,
    listComponentsTool,
    listNetsTool,
    searchNetsTool,
    searchComponentsByRefdesTool,
    searchComponentsByMpnTool,
    searchComponentsByDescriptionTool,
    queryXnetByNetNameTool,
    queryXnetByPinNameTool,
    queryComponentTool,
    runErcTool,
    exportCadenceNetlistTool,
  ].filter((tool) => FEATURE_FLAGS[tool.name] ?? true)
);

/** The tool with this exact name, or undefined when this build offers none. */
export const findTool = (name: string): AnyToolDefinition | undefined =>
  TOOLS.find((tool) => tool.name === name);

/**
 * Call a tool by name on raw arguments. The arguments are parsed by the tool's
 * schema first, so defaults apply and anything the schema refuses comes back
 * as an `{ error }` result naming the argument, the same way a tool reports
 * its own failures. A name this build does not offer, and an exception the
 * tool throws, are reported the same way, so the promise never rejects.
 */
export const callTool = async (
  name: string,
  args: unknown = {}
): Promise<unknown | ErrorResult> => {
  const tool = findTool(name);
  if (!tool) {
    return { error: `Unknown tool '${name}'. Available: ${TOOLS.map((t) => t.name).join(", ")}.` };
  }
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) {
    return { error: `Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}` };
  }
  try {
    return await tool.run(parsed.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};
