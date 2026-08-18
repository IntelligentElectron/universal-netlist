# list_designs

List all design projects in a directory.

## Description

Discovers Cadence, Altium, and KiCad design files by scanning the specified directory recursively. Returns the best available path for each design. Use this tool first to find available projects before querying them.

For Cadence designs, `path` is the `.DSN` schematic, which is what you should query: it is the design as it stands, and a part a CIS variant leaves off the board is written to the `.dat` triad exactly like a stuffed one. Where a netlist has been exported beside the design, `netlist` gives its `pstxnet.dat`. For Altium, `path` is the `.PrjPcb`. For KiCad, `path` is the `.kicad_pro` project (discovery keys off `.kicad_pro`, even when the directory name differs from the project basename).

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
      "source": {
        "type": "string",
        "description": "Schematic source path (same as path for a Cadence design, which is read from its schematic)"
      },
      "netlist": {
        "type": "string",
        "description": "Exported netlist path (present for a Cadence design with a pstxnet.dat beside it)"
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
    "path": "MainBoard/schematic.DSN",
    "source": "MainBoard/schematic.DSN",
    "netlist": "MainBoard/Allegro/pstxnet.dat"
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
- `source` names the schematic, which is what it has always named. It now holds what `path` holds, and is kept rather than dropped for being redundant
- `netlist` is present only for a Cadence design with an exported `pstxnet.dat` beside it. Reading it is supported and agrees with the schematic on Do Not Stuff, because the schematic's variant data is read alongside it, but it is a snapshot of the design at export time rather than the design
- Generating a netlist is not a step towards querying a Cadence design. Every tool reads the `.DSN` directly, on every platform
- For KiCad designs, `path` is the `.kicad_pro`; the netlist is resolved automatically when queried (committed `.net` export if present, otherwise generated via `kicad-cli`), so no manual export step is needed
- The `pattern` parameter filters on the design `name`, not the full path
