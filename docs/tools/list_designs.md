# list_designs

List all design projects in a directory.

## Description

Discovers Cadence and Altium design files by scanning the specified directory recursively. Returns the best available path for each design. Use this tool first to find available projects before querying them.

For Cadence designs with exported `.dat` files, `path` points to `pstxnet.dat` (preferred, more complete data) and `source` provides the `.DSN` schematic path. Without `.dat` files, `path` is the `.DSN` directly. For Altium, `path` is the `.PrjPcb`.

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
        "description": "Schematic source path (present when path differs from source, e.g. Cadence with .dat files)"
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
    "path": "MainBoard/Allegro/pstxnet.dat",
    "source": "MainBoard/schematic.DSN"
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
- `source` is present only when `path` differs from the schematic source (i.e., Cadence designs with exported `.dat` files)
- For Cadence designs where `path` is a `.DSN`: on Windows, run `export_cadence_netlist` to generate `.dat` files, then re-run `list_designs` to get the updated `pstxnet.dat` path; on macOS/Linux, query using the `.DSN` path directly (DSN fallback parser)
- The `pattern` parameter filters on the design `name`, not the full path
