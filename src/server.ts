/**
 * Netlist MCP Server
 *
 * Model Context Protocol server for querying EDA netlists.
 * Supports Cadence (CIS, HDL) and Altium Designer formats.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "./version.js";
import {
  listDesigns,
  listComponents,
  listNets,
  searchNets,
  searchComponentsByRefdes,
  searchComponentsByMpn,
  searchComponentsByDescription,
  queryComponent,
  queryXnetByNetName,
  queryXnetByPinName,
  exportCadenceNetlist,
} from "./service.js";

// =============================================================================
// Server Instructions
// =============================================================================

const SERVER_INSTRUCTIONS = `
# Netlist MCP Server

This server provides tools to query EDA (Electronic Design Automation) netlists for circuit design review.
Supports Cadence (CIS, HDL) and Altium Designer formats.

## Workflow Guidance

1. Use \`list_designs\` first to discover available projects in a directory
2. Use \`search_nets\` with regex patterns before querying specific nets
3. Use \`search_components_by_*\` to find components by refdes, MPN, or description
4. Use \`query_xnet_by_net_name\` or \`query_xnet_by_pin_name\` to trace signal paths
5. For token optimization, use \`skip_types=['C','L']\` to skip series passives on power rails

## Tool Usage Tips

- Pin names use REFDES.PIN format (e.g., U1.A5, R10.1)
- DNS (Do Not Stuff) components are excluded by default; use \`include_dns=true\` to include them
- \`query_xnet_*\` traces through series components; \`circuit_hash\` identifies unique topologies
- \`query_xnet_*\` stops traversal at power/ground nets; use \`skip_types\` to reduce noise on rails
- All design paths should be absolute paths

## Error Handling

Results with an \`error\` field indicate a problem:
- Design not found: Check available designs with \`list_designs\`
- Net not found: Use \`search_nets\` to find available nets
- Component not found: Use \`search_components_by_refdes\` to find available components
- Missing netlist files: Run \`export_cadence_netlist\` to generate .dat files

## Netlist Export (Windows Only)

Use \`export_cadence_netlist\` to generate Allegro-compatible netlist files from Cadence schematics.
- Requires Cadence SPB installation (auto-detected from C:/Cadence)
- Uses the latest installed version by default
- Output directory: \`{schematic_dir}/Allegro/\`
- Returns error on non-Windows platforms
`.trim();

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a result as MCP tool response content.
 */
const formatResult = (
  result: unknown,
): { content: { type: "text"; text: string }[] } => ({
  content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
});

// =============================================================================
// Server Setup
// =============================================================================

/**
 * Create and configure the MCP server.
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
    },
  );

  // -------------------------------------------------------------------------
  // Tool: list_designs
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_designs",
    {
      description: "List all design projects in the given directory",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Absolute path to directory to search for designs"),
        pattern: z
          .string()
          .optional()
          .describe("Regex pattern to filter design names"),
      },
    },
    async ({ path, pattern }) => {
      const result = await listDesigns(path, pattern);
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: list_components
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_components",
    {
      description: "List components of a specific type in a design",
      inputSchema: {
        design: z
          .string()
          .describe(
            "Absolute path to design file (e.g., /path/to/Design.PrjPcb)",
          ),
        type: z.string().describe("Component prefix: U, C, R, L, etc."),
        include_dns: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include DNS (Do Not Stuff) components"),
      },
    },
    async ({ design, type, include_dns }) => {
      const result = await listComponents(design, type, include_dns);
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: list_nets
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_nets",
    {
      description: "List all net names in a design",
      inputSchema: {
        design: z.string().describe("Absolute path to design file"),
      },
    },
    async ({ design }) => {
      const result = await listNets(design);
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: search_nets
  // -------------------------------------------------------------------------
  server.registerTool(
    "search_nets",
    {
      description: "Search for nets matching a regex pattern",
      inputSchema: {
        pattern: z.string().describe("Regex pattern"),
        design: z.string().describe("Absolute path to design file"),
      },
    },
    async ({ pattern, design }) => {
      const result = await searchNets(pattern, design);
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: search_components_by_refdes
  // -------------------------------------------------------------------------
  server.registerTool(
    "search_components_by_refdes",
    {
      description: "Search for components by refdes pattern",
      inputSchema: {
        pattern: z.string().describe("Regex pattern for refdes"),
        design: z.string().describe("Absolute path to design file"),
        include_dns: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include DNS components"),
      },
    },
    async ({ pattern, design, include_dns }) => {
      const result = await searchComponentsByRefdes(
        pattern,
        design,
        include_dns,
      );
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: search_components_by_mpn
  // -------------------------------------------------------------------------
  server.registerTool(
    "search_components_by_mpn",
    {
      description:
        "Search for components by MPN (Manufacturer Part Number) pattern",
      inputSchema: {
        pattern: z.string().describe("Regex pattern for MPN"),
        design: z.string().describe("Absolute path to design file"),
        include_dns: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include DNS components"),
      },
    },
    async ({ pattern, design, include_dns }) => {
      const result = await searchComponentsByMpn(pattern, design, include_dns);
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: search_components_by_description
  // -------------------------------------------------------------------------
  server.registerTool(
    "search_components_by_description",
    {
      description: "Search for components by description pattern",
      inputSchema: {
        pattern: z.string().describe("Regex pattern for description"),
        design: z.string().describe("Absolute path to design file"),
        include_dns: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include DNS components"),
      },
    },
    async ({ pattern, design, include_dns }) => {
      const result = await searchComponentsByDescription(
        pattern,
        design,
        include_dns,
      );
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: query_xnet_by_net_name
  // -------------------------------------------------------------------------
  server.registerTool(
    "query_xnet_by_net_name",
    {
      description: "Get full XNET (Extended Net) connectivity for a net",
      inputSchema: {
        design: z.string().describe("Absolute path to design file"),
        net_name: z.string().describe("Exact net name"),
        skip_types: z
          .array(z.string())
          .optional()
          .describe("Component prefixes to exclude (e.g., ['C', 'L'])"),
        include_dns: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include DNS components"),
      },
    },
    async ({ design, net_name, skip_types, include_dns }) => {
      const result = await queryXnetByNetName(
        design,
        net_name,
        skip_types,
        include_dns,
      );
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: query_xnet_by_pin_name
  // -------------------------------------------------------------------------
  server.registerTool(
    "query_xnet_by_pin_name",
    {
      description: "Get full XNET connectivity starting from a component pin",
      inputSchema: {
        design: z.string().describe("Absolute path to design file"),
        pin_name: z
          .string()
          .describe("Pin spec: REFDES.PIN (e.g., U2.10, U1.A5)"),
        skip_types: z
          .array(z.string())
          .optional()
          .describe("Component prefixes to exclude"),
        include_dns: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include DNS components"),
      },
    },
    async ({ design, pin_name, skip_types, include_dns }) => {
      const result = await queryXnetByPinName(
        design,
        pin_name,
        skip_types,
        include_dns,
      );
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: query_component
  // -------------------------------------------------------------------------
  server.registerTool(
    "query_component",
    {
      description: "Get full component details including all pin connections",
      inputSchema: {
        design: z.string().describe("Absolute path to design file"),
        refdes: z.string().describe("Component reference designator"),
      },
    },
    async ({ design, refdes }) => {
      const result = await queryComponent(design, refdes);
      return formatResult(result);
    },
  );

  // -------------------------------------------------------------------------
  // Tool: export_cadence_netlist
  // -------------------------------------------------------------------------
  server.registerTool(
    "export_cadence_netlist",
    {
      description:
        "Export Cadence schematic netlist to Allegro PCB format. Windows only. Requires Cadence SPB installation.",
      inputSchema: {
        design: z.string().describe("Absolute path to .DSN schematic file"),
      },
    },
    async ({ design }) => {
      const result = await exportCadenceNetlist(design);
      return formatResult(result);
    },
  );

  return server;
};

/**
 * Run the MCP server with stdio transport.
 */
export const runServer = async (): Promise<void> => {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
