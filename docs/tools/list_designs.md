# list_designs

List all design projects in a directory.

## Description

Discovers Cadence, Altium, KiCad, and Universal Netlist design files by scanning the specified directory recursively. Returns the best available path for each design. Use this tool first to find available projects before querying them.

Every design reports one path, and that path is the design: for Cadence the `.DSN` schematic, which is what you should query, because a part a CIS variant leaves off the board is written to the `.dat` triad exactly like a stuffed one. A design that is only an exported netlist reports that netlist. For Altium, `path` is the `.PrjPcb`. For KiCad, `path` is the `.kicad_pro` project (discovery keys off `.kicad_pro`, even when the directory name differs from the project basename). For a Universal Netlist, `path` is the `.netlist.json` file itself. Other JSON files are ignored. A `.netlist.json` document must carry the supported `universalNetlistSchemaVersion`; one that is malformed, unsigned, unsupported, or structurally invalid is listed with an `error`. Directories named `node_modules` or starting with `.` are not searched.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | Current working directory | Path to directory to search |
| `pattern` | string | No | `".*"` | Regex pattern to filter design names |
| `max_depth` | integer | No | Unlimited | Max directory recursion depth (0 = no recursion) |
| `max_results` | integer | No | 50 | Max designs to return |

## Response Schema

Returns an array of design info objects:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Design project name"
      },
      "path": {
        "type": "string",
        "description": "Best available path to query this design"
      },
      "error": {
        "type": "string",
        "description": "Error message if design has issues"
      }
    },
    "required": ["name", "path"]
  }
}
```

## Example

**Listing design projects in a directory:**

Call:
```json
{
  "tool": "list_designs",
  "arguments": {
    "path": "."
  }
}
```

Response:
```json
[
  {
    "name": "PowerBoard",
    "path": "PowerBoard/PowerBoard.PrjPcb"
  },
  {
    "name": "MainBoard",
    "path": "MainBoard/schematic.DSN"
  },
  {
    "name": "AudioModule",
    "path": "AudioModule/design.DSN"
  }
]
```

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern '[invalid'"
}
```

## Notes

- `path` is always the recommended path to pass to other tools
- Generating a netlist is not a step towards querying a Cadence design. Every tool reads the `.DSN` directly, on every platform
- For KiCad designs, `path` is the `.kicad_pro`; the netlist is resolved automatically when queried (committed `.net` export if present, otherwise generated via `kicad-cli`), so no manual export step is needed
- For Universal Netlist designs, `name` is the file basename without `.netlist.json`
- The `pattern` parameter filters on the design `name`, not the full path
