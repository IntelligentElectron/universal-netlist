# list_designs

List all design projects in a directory.

## Description

Discovers Cadence, Altium, KiCad, and Universal Netlist design files by scanning the specified directory recursively. Returns the best available path for each design. Use this tool first to find available projects before querying them.

Each design lists its `design_variants`: `<Default>` (the unmodified/core design) first, then every native variant the design records. Altium names come from the `ProjectVariantN` sections of the `.PrjPcb`, Cadence names from the CIS BOM variant store in the `.DSN`, and KiCad names from the instance variant blocks across the schematic hierarchy. A native entry carries `fabrication` where the vendor marks the variant as a build assembly: Altium records it per variant as `AllowFabrication`, and every Cadence CIS BOM variant is one by definition. KiCad has no such flag, so its entries omit it. Listing reads the design's own file without parsing connectivity; a design whose variants cannot be read reports `<Default>` alone and carries the reason in `error`.

A design with named variants requires `design_variant` on every query. Pass one of the listed names, or `<Default>` (alias `default`) for the core design. Names match case-insensitively, and results echo the canonical spelling.

Every design reports one path to query. For Cadence, it is the `.DSN` schematic, read directly with component properties, connectivity, and CIS variant stuffing information. For Altium, `path` is the `.PrjPcb`. For KiCad, `path` is the `.kicad_pro` project (discovery keys off `.kicad_pro`, even when the directory name differs from the project basename). For a Universal Netlist, `path` is the `.netlist.json` file itself. Other JSON files are ignored. A `.netlist.json` document must carry the supported `universalNetlistSchemaVersion`; one that is malformed, unsigned, unsupported, or structurally invalid is listed with an `error`. Directories named `node_modules` or starting with `.` are not searched.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | Current working directory | Path to directory to search |
| `pattern` | string | No | `".*"` | Regex pattern to filter design names |
| `max_depth` | integer | No | Unlimited | Max directory recursion depth (0 = no recursion) |
| `max_results` | integer | No | 50 | Max designs to return |

## Response Schema

Returns the directory searched, the designs found in it, and notes about the search:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "root": {
      "type": "string",
      "description": "Absolute directory the search ran in"
    },
    "designs": {
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
          "design_variants": {
            "type": "array",
            "description": "<Default> first, then every native design variant the design records",
            "items": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "Variant name, in the design's own spelling; <Default> is the unmodified/core design"
                },
                "is_default": {
                  "type": "boolean",
                  "description": "Present and true on the <Default> entry only"
                },
                "fabrication": {
                  "type": "boolean",
                  "description": "Whether the vendor marks the variant as a build assembly (Altium AllowFabrication; always true for Cadence CIS BOM variants; omitted for KiCad)"
                }
              },
              "required": ["name"]
            }
          },
          "error": {
            "type": "string",
            "description": "Error message if design has issues"
          }
        },
        "required": ["name", "path", "design_variants"]
      }
    },
    "notes": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Present when no directory was named, or when the result was cut short by max_results"
    }
  },
  "required": ["root", "designs"]
}
```

`root` is reported on every result because it is the one thing a caller cannot check from the designs alone: an omitted, blank, or misspelled `path` searches the server's working directory and returns real designs from a directory nobody asked about.

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
{
  "root": "/home/user/designs",
  "designs": [
    {
      "name": "PowerBoard",
      "path": "PowerBoard/PowerBoard.PrjPcb",
      "design_variants": [
        { "name": "<Default>", "is_default": true },
        { "name": "Production", "fabrication": true },
        { "name": "EVT-DNP", "fabrication": false }
      ]
    },
    {
      "name": "MainBoard",
      "path": "MainBoard/schematic.DSN",
      "design_variants": [
        { "name": "<Default>", "is_default": true },
        { "name": "Standard", "fabrication": true }
      ]
    },
    {
      "name": "AudioModule",
      "path": "AudioModule/design.DSN",
      "design_variants": [
        { "name": "<Default>", "is_default": true }
      ]
    },
    {
      "name": "SensorHub",
      "path": "SensorHub/SensorHub.kicad_pro",
      "design_variants": [
        { "name": "<Default>", "is_default": true },
        { "name": "LowPower" }
      ]
    }
  ]
}
```

`PowerBoard`, `MainBoard`, and `SensorHub` each record named variants, so every query on them takes `design_variant`. `AudioModule` lists `<Default>` alone and needs no selector.

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern '[invalid'"
}
```

## Notes

- `path` is always the recommended path to pass to other tools
- Generating a netlist is not a step towards querying a Cadence design. Every tool reads the `.DSN` directly, on every platform
- Read `design_variants` before querying a design. A design with more than the `<Default>` entry requires `design_variant` on every query: one of the listed names, or `<Default>` (alias `default`) for the core design. A query that omits it returns an error such as `Design 'BSPD_002.PrjPcb' defines design variants ['BSPD-DNP']. Pass design_variant='<Default>' (alias 'default') for the unmodified/core design, or one of those names. list_designs() reports them under design_variants.`
- `fabrication` is present on native entries where the vendor records a build flag: Altium's `AllowFabrication` per variant, and `true` on every Cadence CIS BOM variant. KiCad entries carry no such flag
- For KiCad designs, `path` is the `.kicad_pro`; `<Default>` uses the committed `.net` export when present, while a named variant is generated via `kicad-cli --variant`, which applies KiCad 10's per-instance variant blocks (dnp and field overrides) itself, so no manual export step is needed
- For Universal Netlist designs, `name` is the file basename without `.netlist.json`
- The `pattern` parameter filters on the design `name`, not the full path
