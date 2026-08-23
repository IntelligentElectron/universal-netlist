# API Documentation

## Overview

The Universal Netlist MCP Server provides tools for querying electronic design netlists through any MCP-compatible AI assistant. Once configured, you can ask your AI assistant to analyze your circuit designs, find components, trace signal paths, and more.

## Supported Formats

| Format | Input Files | Description |
|--------|------------|-------------|
| Cadence (CIS / HDL) | `.DSN` schematic (preferred), or `.dat` netlist files | The `.DSN` binary schematic is parsed directly and is what `list_designs` returns. Exported Allegro netlist files (`pstxnet.dat`, `pstxprt.dat`, `pstchip.dat`) are also readable, but they do not distinguish parts that a CIS variant leaves off the board from stuffed parts. |
| Altium Designer | `.SchDoc` | Altium schematic documents (discovered via `.PrjPcb` project files) |
| KiCad | `.kicad_pro` (or root `.kicad_sch`) | A committed `kicadsexpr` netlist export (`.net`) beside the project is parsed directly (preferred). When unavailable, one is generated on demand via `kicad-cli` (requires KiCad installed; set `KICAD_CLI_PATH` for a non-standard location). |
| Universal Netlist | `.json` | A file in the [Universal Netlist schema](schemas/universal-netlist.md). Validated on load: `nets` and `components` must be exact inverses and every refdes and pin must resolve. See [Loading a Universal Netlist file](schemas/universal-netlist.md#loading-a-universal-netlist-file). |

## Design Philosophy

### Simple Tools, Smart LLM

Each tool has a single, focused responsibility. Complex reasoning is offloaded to the LLM rather than embedded in tool logic. This keeps tools predictable and debuggable while allowing the AI to combine them creatively.

### Universal Netlist Schema

All EDA formats convert to one compact JSON structure that captures connectivity essentials without bloat. Components have pins, pins connect to nets, and nets connect components. See [schemas/universal-netlist.md](schemas/universal-netlist.md) for the schema definition.

### Datasheet-Deferred Details

The schema captures identification (MPN, description) but not electrical specifications like voltage ratings or tolerances. These details belong in datasheets - let the LLM fetch them when needed rather than bloating the netlist.

## Available Tools

| Tool | Description |
|------|-------------|
| [`list_designs`](tools/list_designs.md) | Find design projects in a directory |
| [`list_components`](tools/list_components.md) | List components by type (U, R, C, etc.) |
| [`list_nets`](tools/list_nets.md) | List all nets in a design |
| [`search_nets`](tools/search_nets.md) | Search nets by pattern |
| [`search_components_by_refdes`](tools/search_components_by_refdes.md) | Search components by reference designator |
| [`search_components_by_mpn`](tools/search_components_by_mpn.md) | Search components by part number |
| [`search_components_by_description`](tools/search_components_by_description.md) | Search components by description |
| [`query_component`](tools/query_component.md) | Get component details with all pin connections |
| [`query_xnet_by_net_name`](tools/query_xnet_by_net_name.md) | Trace circuit connectivity from a net |
| [`query_xnet_by_pin_name`](tools/query_xnet_by_pin_name.md) | Trace circuit connectivity from a component pin |
| [`run_erc`](tools/run_erc.md) | Run electrical rule checks (ERC) on the netlist |
| [`export_cadence_netlist`](tools/export_cadence_netlist.md) | Deprecated. Export Cadence schematic to Allegro format (Windows); not needed to query a design |

## Schematic Authoring

To get the most out of this MCP, follow the recommended [Net Naming Conventions](net-naming-conventions.md) when naming nets and marking DNS components in your schematics. Net names drive power/ground detection, circuit traversal stop behavior, and `search_nets` pattern matching.

## Command Line

The binary's commands (`export-json`, `update`, `uninstall`, `export-telemetry`, `coverage`) are documented in [cli.md](cli.md). `export-json` writes a design as a Universal Netlist JSON file, which is itself a design every tool reads.

## Observability

The server can emit OpenTelemetry traces, metrics, and logs for every tool call, so you can integrate your own OTel service. It is disabled by default and configured entirely through standard `OTEL_*` environment variables. See [Observability (OpenTelemetry)](observability.md) for setup and the full list of emitted spans, metrics, and logs.

## Example Queries

Once configured, you can ask your AI assistant questions like:

- "Find all designs in the current directory"
- "List all the capacitors in MyDesign.PrjPcb"
- "List the op-amps in MyBoard.kicad_pro"
- "What nets contain 'USB' in their name?"
- "Show me the pin connections for U15"
- "Trace the circuit connected to the VIN pin of U3"
- "Find all components using the TPS62840 part number"

## Tool Documentation

See the [tools/](tools/) directory for detailed documentation on each tool's parameters and response format.

## Response Schemas

- [schemas/universal-netlist.md](schemas/universal-netlist.md) - Core netlist data model (JSON Schema)
- [schemas/shared-types.md](schemas/shared-types.md) - Shared response types (JSON Schema)

## Error Handling

All tools return an [`ErrorResult`](schemas/shared-types.md#errorresult) on failure:

```json
{
  "error": "Descriptive error message with suggestions"
}
```

Error messages include actionable guidance (e.g., "Use list_components() to find available components").

## Behavioral Notes

Important behavioral documentation in [shared-types.md](schemas/shared-types.md):

- [DNS Detection](schemas/shared-types.md#dns-detection) - How Do Not Stuff components are identified
- [How Cadence Records Do Not Install](cadence-dni.md) - The two mechanisms a Cadence design uses, and why one of them never reaches the exported netlist
- [Power/Ground Stop Nets](schemas/shared-types.md#powerground-stop-nets) - Nets that stop circuit traversal
- [Case Sensitivity](schemas/shared-types.md#case-sensitivity) - Which operations are case-sensitive
- [Notes Array](schemas/shared-types.md#notes-array) - Meaning of informational notes in responses
