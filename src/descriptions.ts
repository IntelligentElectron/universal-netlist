/**
 * Description constants for MCP server instructions and tool descriptions.
 * Extracted from server.ts for easier maintenance.
 */

// =============================================================================
// Server Instructions
// =============================================================================

export const SERVER_INSTRUCTIONS = `
# Netlist MCP Server

This server provides tools to query EDA netlists for circuit design review.

Supported formats:
- **Cadence CIS/HDL**: Supports both exported .dat files (preferred) and .DSN binary schematics (fallback).
- **Altium Designer**: Reads .SchDoc schematic documents associated to a .PrjPcb project file.
- **KiCad**: Reads a .kicad_pro project (or root .kicad_sch). Prefers a committed kicadsexpr netlist export (.net) beside the project; otherwise generates one via kicad-cli (requires KiCad installed; set KICAD_CLI_PATH for a non-standard location). Nets declared inside a hierarchical sheet are sheet-path-prefixed (e.g. "/Peripherals/D0", not "/D0"); when using \`search_nets\`, prefer unanchored patterns so you do not miss bussed/hierarchical nets.

## Cadence Design Priority

\`list_designs\` returns the best available path for each Cadence design:
- If exported .dat files exist: returns pstxnet.dat path (preferred, more complete data)
- If no .dat files exist: returns the .DSN path

When \`list_designs\` returns a .DSN path (no .dat files available):
1. On Windows: run \`export_cadence_netlist\` with the .DSN path to generate .dat files, then re-run \`list_designs\`
2. If export fails or on macOS/Linux: query using the .DSN path directly (DSN fallback parser)

## KiCad Design Priority

\`list_designs\` surfaces each \`.kicad_pro\` project. When you query a KiCad design the server resolves its netlist automatically; you do NOT need to export anything by hand:
1. If a committed kicadsexpr export (\`<project>.net\`) sits beside the project, it is parsed directly (no KiCad install needed).
2. Otherwise the server runs \`kicad-cli\` on the root \`.kicad_sch\` to generate one on demand (requires KiCad installed; set \`KICAD_CLI_PATH\` for a non-standard install location).
3. If neither a committed \`.net\` nor a usable \`kicad-cli\` is available, the result has an \`error\` saying so.

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
- Design paths are relative to the working directory (absolute paths also accepted)

## Error Handling

Results with an \`error\` field indicate a problem:
- Design not found: Check available designs with \`list_designs\`
- Net not found: Use \`search_nets\` to find available nets
- Component not found: Use \`search_components_by_refdes\` to find available components
- Missing netlist files: Run \`export_cadence_netlist\` to generate .dat files
`.trim();

// =============================================================================
// Tool Descriptions
// =============================================================================

export const LIST_DESIGNS_DESCRIPTION = `\
List all design projects in the given directory. \
Returns the best available path for each design. \
For Cadence with exported .dat files: path is pstxnet.dat (preferred), \
source has the .DSN schematic. Without .dat files: path is the .DSN. \
For Altium: path is the .PrjPcb. \
For KiCad: path is the .kicad_pro; its netlist resolves automatically when queried \
(a committed .net export if present, otherwise generated via kicad-cli), so no manual export is needed. \
Always use this tool to discover designs instead of searching the filesystem manually.`;

export const LIST_COMPONENTS_DESCRIPTION = `\
List components of a specific type in a design. \
The type prefix is case-insensitive, so "u" matches U1, U2, etc. \
Components are grouped by MPN for compact output. \
If no components match, the error lists the available prefixes in the design.`;

export const LIST_NETS_DESCRIPTION = `\
List all net names in a design, sorted alphabetically. \
The result can be large. Prefer search_nets for targeted queries.`;

export const SEARCH_NETS_DESCRIPTION = `\
Search for nets matching a regex pattern. \
Matching is case-insensitive by default. \
Returns sorted results keyed by design name, \
with a notes field when nothing matches. \
KiCad nets declared inside a hierarchical sheet are sheet-path-prefixed \
(e.g. a "D0" data line on the Peripherals sheet is named "/Peripherals/D0", not "/D0"), \
so prefer unanchored patterns like "D0" over "^/D0$" or you may miss bussed/hierarchical nets. \
Rejects patterns that match all items; use list_nets for full results.`;

export const SEARCH_COMPONENTS_BY_REFDES_DESCRIPTION = `\
Search for components by refdes pattern. Matching is case-insensitive. \
Results are grouped by MPN for compact output, \
with a notes field when nothing matches. \
Rejects patterns that match all items; use list_components for full results.`;

export const SEARCH_COMPONENTS_BY_MPN_DESCRIPTION = `\
Search for components by MPN (Manufacturer Part Number) pattern. \
Not all netlists include MPN data; if unavailable, \
fall back to search_components_by_refdes or search_components_by_description, \
or ask the user for a BOM. \
Rejects patterns that match all items; use list_components for full results.`;

export const SEARCH_COMPONENTS_BY_DESCRIPTION_DESCRIPTION = `\
Search for components by description pattern. \
Not all netlists include description data; if unavailable, \
fall back to search_components_by_refdes or search_components_by_mpn, \
or ask the user for a BOM. \
Rejects patterns that match all items; use list_components for full results.`;

export const QUERY_XNET_BY_NET_NAME_DESCRIPTION = `\
Get full XNET (Extended Net) connectivity for a net. \
Rejects ground nets (GND, AGND, DGND, etc.) with an error.`;

export const QUERY_XNET_BY_PIN_NAME_DESCRIPTION = `\
Get full XNET connectivity starting from a component pin. \
Rejects pins connected to ground nets (GND, AGND, DGND, etc.) \
with an error.`;

export const QUERY_COMPONENT_DESCRIPTION = `\
Get full component details including all pin connections. \
Refdes lookup is case-insensitive. \
Returns MPN, description, value, and pin-to-net mappings when available. \
Errors include guidance and suggestions.`;

export const EXPORT_CADENCE_NETLIST_DESCRIPTION = `\
Export Cadence schematic netlist to Allegro PCB format. \
Windows only. Requires Cadence SPB installation. \
Calls are queued internally so it is safe to call in parallel \
for multiple designs, but serialize calls if you encounter \
license or timeout errors. DSN lock files are handled automatically. \
After a successful export, re-run \`list_designs\` \
to get the updated pstxnet.dat path.`;

export const RUN_ERC_DESCRIPTION = `\
Run electrical rule checks (ERC) on a design's netlist and return findings grouped \
by severity (\`errors\`, \`warnings\`) then rule id. Full output, never truncated. \
Rules: \`net.single_pin\` (error: a net with one functional pin and no test point), \
\`net.testpoint_orphan\` (error: a net touched only by test points), \
\`net.testpoint_stub\` (warning: one functional pin plus test point(s)), \
\`net.unnamed\` (warning: an auto-generated net name on a real 2+-pin net). \
Test points are identified by the \`TP\` refdes prefix. Findings key each net to its \
\`REFDES.PIN\` endpoints (always arrays); \`net.unnamed\` lists bare net names. \
\`checked\` lists the rules that ran, so a rule absent from the findings found nothing. \
Use \`include_rules\`/\`exclude_rules\` (rule ids) to scope the run and \`include_dns\` to \
count Do-Not-Stuff parts. Unconnected pins without a no-connect symbol are NOT checked: \
the parsers cannot reliably tell them apart from intentional no-connects.`;
