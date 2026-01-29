# API Documentation

## Overview

The Universal Netlist MCP Server provides tools for querying electronic design netlists through any MCP-compatible AI assistant. Once configured, you can ask your AI assistant to analyze your circuit designs, find components, trace signal paths, and more.

## Supported Formats

| Format | File Extension | Description |
|--------|---------------|-------------|
| Cadence CIS | `.dsn` | Cadence Capture CIS schematic designs |
| Cadence HDL | `.cpm` | Cadence HDL schematic designs |
| Altium Designer | `.PrjPcb` | Altium Designer PCB projects |

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
| `list_designs` | Find design projects in a directory |
| `list_components` | List components by type (U, R, C, etc.) |
| `list_nets` | List all nets in a design |
| `search_nets` | Search nets by pattern |
| `search_components_by_refdes` | Search components by reference designator |
| `search_components_by_mpn` | Search components by part number |
| `search_components_by_description` | Search components by description |
| `query_component` | Get component details with all pin connections |
| `query_xnet_by_net_name` | Trace circuit connectivity from a net |
| `query_xnet_by_pin_name` | Trace circuit connectivity from a component pin |
| `export_cadence_netlist` | Export Cadence schematic to Allegro format (Windows) |

## Example Queries

Once configured, you can ask your AI assistant questions like:

- "Find all designs in /path/to/projects"
- "List all the capacitors in MyDesign.PrjPcb"
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

- [Compact Array Behavior](schemas/shared-types.md#compact-array-behavior) - Single-element arrays are compacted to scalars
- [DNS Detection](schemas/shared-types.md#dns-detection) - How Do Not Stuff components are identified
- [Power/Ground Stop Nets](schemas/shared-types.md#powerground-stop-nets) - Nets that stop circuit traversal
- [Case Sensitivity](schemas/shared-types.md#case-sensitivity) - Which operations are case-sensitive
- [Notes Array](schemas/shared-types.md#notes-array) - Meaning of informational notes in responses
