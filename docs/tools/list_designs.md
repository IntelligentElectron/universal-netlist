# list_designs

List all design projects in a directory.

## Description

Discovers Cadence and Altium design files by scanning the specified directory recursively. Use this tool first to find available projects before querying them.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | Current working directory | Absolute path to directory to search |
| `pattern` | string | No | `".*"` | Regex pattern to filter design names |

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
        "description": "Absolute path to design file"
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
    "path": "/Users/eng/projects"
  }
}
```

Response:
```json
[
  {
    "name": "PowerBoard",
    "path": "/Users/eng/projects/PowerBoard/PowerBoard.PrjPcb"
  },
  {
    "name": "MainBoard",
    "path": "/Users/eng/projects/MainBoard/schematic.dsn"
  },
  {
    "name": "AudioModule",
    "path": "/Users/eng/projects/AudioModule/design.cpm",
    "error": "Missing pstxnet.dat file"
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

- The `path` field in results is always an absolute path that can be passed directly to other tools
- Designs with missing netlist files will include an `error` field explaining what's needed
- For Cadence designs without `.dat` files, run `export_cadence_netlist` to generate them
- The `pattern` parameter filters on the design `name`, not the full path
