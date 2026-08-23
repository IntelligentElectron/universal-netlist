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
- **Cadence CIS/HDL**: .DSN binary schematics, which is what to read. Exported .dat netlist files (pstxnet.dat, pstxprt.dat, pstchip.dat) are a fallback, for a design that ships without its schematic.
- **Altium Designer**: .SchDoc schematic documents, discovered through their .PrjPcb project.
- **KiCad**: .kicad_pro projects, or a root .kicad_sch.
- **Universal Netlist**: .json files in this server's own netlist schema (nets plus components), validated on load.

## Example Workflow

1. \`list_designs\` first: it finds the designs and gives you the path to query
2. \`search_nets\` and \`search_components_by_*\` to find things by pattern
3. \`query_component\` and \`query_xnet_*\` for detail and connectivity
4. \`run_erc\` for electrical rule checks

## Conventions

- Design paths are relative to the working directory; absolute paths are also accepted
- DNS (Do Not Stuff) components are left out of results, and the tools that can include them take \`include_dns=true\`
- A result carrying an \`error\` field failed, and the message names the tool that finds the value you wanted
`.trim();

// =============================================================================
// Tool Descriptions
// =============================================================================

export const LIST_DESIGNS_DESCRIPTION = `\
List all design projects in the given directory, one path each: a .DSN, a .PrjPcb, a \
.kicad_pro, a Universal Netlist .json, or the netlist of a design that is only a netlist. \
That path is the design, and it is what every other tool takes. \
Always use this tool to discover designs instead of searching the filesystem manually.

The result names the directory it searched in \`root\`, and reading it is worth the \
glance: \`path\` is optional, and omitting it or leaving it blank searches the server's \
working directory, which is where the server was launched and not necessarily where you \
are. An argument the schema does not define is dropped before it arrives, so a \
misspelled \`path\` behaves exactly like an omitted one. Each of those returns a list of \
real designs from a directory nobody asked about, and \`root\` is what tells it apart \
from a correct answer. A result cut short by \`max_results\` says so in its notes.

Cadence: the path is the .DSN schematic. It is the design as it stands, and it carries \
what an exported netlist cannot: a part a CIS variant leaves off the board is written to \
the .dat triad exactly like a part that is stuffed, with an ordinary value and all of its \
connections, so nothing in those files marks it. Reading a .DSN takes longer than reading \
a triad, which is the cost of reading the design rather than a summary of it.

If a query reports missing netlist files: a CIS design has nothing to fix, re-run this \
tool and use the .DSN it reports. An HDL (.cpm) design has no .DSN and does need a \
netlist, which \`export_cadence_netlist\` cannot write; those are written from Cadence, \
Tools → Create Netlist → PCB Editor format.

KiCad: the path is the .kicad_pro, and its netlist resolves automatically when queried, so \
nothing needs exporting by hand. A committed kicadsexpr export (<project>.net) beside the \
project is parsed directly, needing no KiCad install; otherwise kicad-cli generates one on \
demand (requires KiCad installed; set KICAD_CLI_PATH for a non-standard location). If \
neither is available the result carries an \`error\` saying so.`;

export const LIST_COMPONENTS_DESCRIPTION = `\
List components of a specific type in a design. \
The type is the refdes prefix, matched whole and case-insensitively: "u" gives U1 and \
U2 but NOT USB1, whose prefix is USB, and "tp" gives the test points. Asking for a \
partial prefix returns nothing rather than everything starting with it, so if a part you \
expected is missing, look for it under its own prefix. \
Identical components are grouped for compact output: parts share a group only when their \
MPN, description, comment and value all agree, so every field a group reports is true of \
every part in it. A group whose parts carry no MPN says so in its notes. \
If no components match, the error lists the prefixes the same query would return, and \
names apart any prefix whose components are all DNS. A prefix whose components are all \
DNS returns an empty list with a note saying so; pass include_dns=true to list them.`;

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
Identical components are grouped for compact output, on MPN, description, comment and \
value together, so every field a group reports is true of every part in it. \
A notes field is returned when nothing matches. \
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
Traces through series components, so the result is the whole electrical node rather \
than the one net; \`circuit_hash\` identifies unique topologies. Traversal stops at \
power and ground nets, recognised by name (VCC*, VDD*, 3V3, GND*, VSS*, ...) or by \
carrying more than 40 pins. A rail named outside that, such as VDIO_LMS, is traversed \
like a signal, so a query that pulls up to one returns its whole pull-up network; \
\`visited_nets\` names every net the result crossed, which is where to look when a \
result is broader than expected. \`skip_types\` leaves series passives out, and \
\`skip_types=['C','L','R']\` is the cheapest way to cut such a result down. \
Rejects ground nets (GND, AGND, DGND, etc.) with an error. \
If the net is not found, \`search_nets\` finds the name.`;

export const QUERY_XNET_BY_PIN_NAME_DESCRIPTION = `\
Get full XNET connectivity starting from a component pin, named REFDES.PIN \
(e.g. U1.A5, R10.1). Traces through series components, so the result is the whole \
electrical node; \`circuit_hash\` identifies unique topologies. Traversal stops at power \
and ground nets, recognised by name (VCC*, VDD*, 3V3, GND*, VSS*, ...) or by carrying \
more than 40 pins; a rail named outside that is traversed like a signal, and \
\`visited_nets\` names every net the result crossed. \`skip_types\` leaves series \
passives out, such as \`skip_types=['C','L','R']\` to cut a broad result down. \
A pin on no net reads as the net \`NC\` and returns an empty result. \
Rejects pins connected to ground nets (GND, AGND, DGND, etc.) with an error.`;

export const QUERY_COMPONENT_DESCRIPTION = `\
Get full component details including all pin connections. \
Refdes lookup is case-insensitive. \
Returns MPN, description, value, and pin-to-net mappings when available. \
Each pin maps to its net name, or to {name, net} where the pin has a function name that \
differs from its number. A pin on no net reads as the net "NC", which is a marker rather \
than a net you can look up. \
If the refdes is not found, \`search_components_by_refdes\` finds it; \
errors include guidance and suggestions.`;

export const EXPORT_CADENCE_NETLIST_DESCRIPTION = `\
DEPRECATED. This tool is kept for backward compatibility and will eventually be \
removed. You do not need it to query a Cadence design: every tool reads the .DSN \
schematic directly, which is what \`list_designs\` returns as \`path\`. Call it only \
when the exported netlist files are themselves the goal, such as handing them to \
Allegro. Do not call it to make a design queryable. \
Exports a Cadence schematic netlist to Allegro PCB format. \
Windows only. Requires Cadence SPB installation. \
Calls are queued internally so it is safe to call in parallel \
for multiple designs, but serialize calls if you encounter \
license or timeout errors. DSN lock files are handled automatically. \
Output goes to \`<design>_netlist/\` beside the .DSN, so several designs \
in one folder no longer overwrite each other's netlist; a folder holding a \
single design that already has an \`allegro/\` directory keeps using it. \
After a successful export the netlist sits beside the design; \
\`list_designs\` keeps reporting the .DSN, which is what to query.`;

export const RUN_ERC_DESCRIPTION = `\
Run electrical rule checks (ERC) on a design's netlist and return findings grouped \
by severity (\`errors\`, \`warnings\`) then rule id. Full output, never truncated. \
Rules: \`net.single_pin\` (error: a net with one functional pin and no test point), \
\`net.testpoint_orphan\` (error: a net touched only by test points), \
\`net.testpoint_stub\` (warning: one functional pin plus test point(s)), \
\`net.unnamed\` (warning: an auto-generated net name on a real 2+-pin net). \
Test points are identified by the \`TP\` refdes prefix. Findings key each net to its \
\`REFDES.PIN\` endpoints (always arrays); \`net.unnamed\` lists bare net names. \
\`checked\` lists the rules that ran, so a rule absent from the findings found nothing, \
and \`skipped\` counts the parts left out of the run, such as Do-Not-Stuff ones. \
Use \`include_rules\`/\`exclude_rules\` (rule ids) to scope the run and \`include_dns\` to \
count Do-Not-Stuff parts; an unknown rule id returns an error rather than silently \
checking nothing. Unconnected pins without a no-connect symbol are NOT checked: \
the parsers cannot reliably tell them apart from intentional no-connects.`;
