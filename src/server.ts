/**
 * Netlist MCP Server
 *
 * Model Context Protocol server for querying EDA netlists.
 * Supports Cadence (CIS, HDL) and Altium Designer formats.
 */

import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "./version.js";
import { initTelemetry, withTelemetry } from "./telemetry.js";
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
import {
  SERVER_INSTRUCTIONS,
  LIST_DESIGNS_DESCRIPTION,
  LIST_COMPONENTS_DESCRIPTION,
  LIST_NETS_DESCRIPTION,
  SEARCH_NETS_DESCRIPTION,
  SEARCH_COMPONENTS_BY_REFDES_DESCRIPTION,
  SEARCH_COMPONENTS_BY_MPN_DESCRIPTION,
  SEARCH_COMPONENTS_BY_DESCRIPTION_DESCRIPTION,
  QUERY_XNET_BY_NET_NAME_DESCRIPTION,
  QUERY_XNET_BY_PIN_NAME_DESCRIPTION,
  QUERY_COMPONENT_DESCRIPTION,
  EXPORT_CADENCE_NETLIST_DESCRIPTION,
} from "./descriptions.js";

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

  // -------------------------------------------------------------------------
  // Tool: list_designs
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_designs",
    {
      description: LIST_DESIGNS_DESCRIPTION,
      inputSchema: {
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
      },
    },
    withTelemetry("list_designs", async ({ path, pattern, max_depth, max_results }) => {
      const result = await listDesigns({
        searchPath: path,
        pattern,
        maxDepth: max_depth,
        maxResults: max_results,
      });
      return formatResult(result);
    })
  );

  // -------------------------------------------------------------------------
  // Tool: list_components
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_components",
    {
      description: LIST_COMPONENTS_DESCRIPTION,
      inputSchema: {
        design: z.string().describe("Path to design file, as returned by list_designs"),
        type: z.string().describe("Component prefix: U, C, R, L, etc."),
        include_dns: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include DNS (Do Not Stuff) components"),
      },
    },
    withTelemetry("list_components", async ({ design, type, include_dns }) => {
      const result = await listComponents(design, type, include_dns);
      return formatResult(result);
    })
  );

  // -------------------------------------------------------------------------
  // Tool: list_nets
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_nets",
    {
      description: LIST_NETS_DESCRIPTION,
      inputSchema: {
        design: z.string().describe("Path to design file"),
      },
    },
    withTelemetry("list_nets", async ({ design }) => {
      const result = await listNets(design);
      return formatResult(result);
    })
  );

  // -------------------------------------------------------------------------
  // Tool: search_nets
  // -------------------------------------------------------------------------
  server.registerTool(
    "search_nets",
    {
      description: SEARCH_NETS_DESCRIPTION,
      inputSchema: {
        pattern: z.string().describe("Regex pattern"),
        design: z.string().describe("Path to design file"),
      },
    },
    withTelemetry("search_nets", async ({ pattern, design }) => {
      const result = await searchNets(pattern, design);
      return formatResult(result);
    })
  );

  // -------------------------------------------------------------------------
  // Tool: search_components_by_refdes
  // -------------------------------------------------------------------------
  server.registerTool(
    "search_components_by_refdes",
    {
      description: SEARCH_COMPONENTS_BY_REFDES_DESCRIPTION,
      inputSchema: {
        pattern: z.string().describe("Regex pattern for refdes"),
        design: z.string().describe("Path to design file"),
        include_dns: z.boolean().optional().default(false).describe("Include DNS components"),
      },
    },
    withTelemetry("search_components_by_refdes", async ({ pattern, design, include_dns }) => {
      const result = await searchComponentsByRefdes(pattern, design, include_dns);
      return formatResult(result);
    })
  );

  // -------------------------------------------------------------------------
  // Tool: search_components_by_mpn
  // -------------------------------------------------------------------------
  server.registerTool(
    "search_components_by_mpn",
    {
      description: SEARCH_COMPONENTS_BY_MPN_DESCRIPTION,
      inputSchema: {
        pattern: z.string().describe("Regex pattern for MPN"),
        design: z.string().describe("Path to design file"),
        include_dns: z.boolean().optional().default(false).describe("Include DNS components"),
      },
    },
    withTelemetry("search_components_by_mpn", async ({ pattern, design, include_dns }) => {
      const result = await searchComponentsByMpn(pattern, design, include_dns);
      return formatResult(result);
    })
  );

  // -------------------------------------------------------------------------
  // Tool: search_components_by_description
  // -------------------------------------------------------------------------
  server.registerTool(
    "search_components_by_description",
    {
      description: SEARCH_COMPONENTS_BY_DESCRIPTION_DESCRIPTION,
      inputSchema: {
        pattern: z.string().describe("Regex pattern for description"),
        design: z.string().describe("Path to design file"),
        include_dns: z.boolean().optional().default(false).describe("Include DNS components"),
      },
    },
    withTelemetry("search_components_by_description", async ({ pattern, design, include_dns }) => {
      const result = await searchComponentsByDescription(pattern, design, include_dns);
      return formatResult(result);
    })
  );

  // -------------------------------------------------------------------------
  // Tool: query_xnet_by_net_name
  // -------------------------------------------------------------------------
  server.registerTool(
    "query_xnet_by_net_name",
    {
      description: QUERY_XNET_BY_NET_NAME_DESCRIPTION,
      inputSchema: {
        design: z.string().describe("Path to design file"),
        net_name: z.string().describe("Exact net name"),
        skip_types: z
          .array(z.string())
          .optional()
          .describe("Component prefixes to exclude (e.g., ['C', 'L'])"),
        include_dns: z.boolean().optional().default(false).describe("Include DNS components"),
      },
    },
    withTelemetry(
      "query_xnet_by_net_name",
      async ({ design, net_name, skip_types, include_dns }) => {
        const result = await queryXnetByNetName(design, net_name, skip_types, include_dns);
        return formatResult(result);
      }
    )
  );

  // -------------------------------------------------------------------------
  // Tool: query_xnet_by_pin_name
  // -------------------------------------------------------------------------
  server.registerTool(
    "query_xnet_by_pin_name",
    {
      description: QUERY_XNET_BY_PIN_NAME_DESCRIPTION,
      inputSchema: {
        design: z.string().describe("Path to design file"),
        pin_name: z.string().describe("Pin spec: REFDES.PIN (e.g., U2.10, U1.A5)"),
        skip_types: z.array(z.string()).optional().describe("Component prefixes to exclude"),
        include_dns: z.boolean().optional().default(false).describe("Include DNS components"),
      },
    },
    withTelemetry(
      "query_xnet_by_pin_name",
      async ({ design, pin_name, skip_types, include_dns }) => {
        const result = await queryXnetByPinName(design, pin_name, skip_types, include_dns);
        return formatResult(result);
      }
    )
  );

  // -------------------------------------------------------------------------
  // Tool: query_component
  // -------------------------------------------------------------------------
  server.registerTool(
    "query_component",
    {
      description: QUERY_COMPONENT_DESCRIPTION,
      inputSchema: {
        design: z.string().describe("Path to design file"),
        refdes: z.string().describe("Component reference designator"),
      },
    },
    withTelemetry("query_component", async ({ design, refdes }) => {
      const result = await queryComponent(design, refdes);
      return formatResult(result);
    })
  );

  // -------------------------------------------------------------------------
  // Tool: export_cadence_netlist
  // -------------------------------------------------------------------------
  server.registerTool(
    "export_cadence_netlist",
    {
      description: EXPORT_CADENCE_NETLIST_DESCRIPTION,
      inputSchema: {
        design: z.string().describe("Path to .DSN schematic file"),
      },
    },
    withTelemetry("export_cadence_netlist", async ({ design }) => {
      const result = await exportCadenceNetlist(design);
      return formatResult(result);
    })
  );

  return server;
};

/**
 * Run the MCP server with stdio transport.
 */
export const runServer = async (): Promise<void> => {
  initTelemetry(crypto.randomUUID());
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
