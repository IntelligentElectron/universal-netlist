# search_components_by_refdes

Search for components by reference designator pattern.

## Description

Searches components using a regex pattern against reference designators. Components are grouped by MPN for compact output.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | Yes | - | Regex pattern for refdes (case-insensitive) |
| `design` | string | Yes | - | Path to design file |
| `include_dns` | boolean | No | `true` | Include DNS components, flagged `dns: true`; pass `false` for fitted parts only |
| `design_variant` | string | Conditional | - | Design variant name from `list_designs`' `design_variants`. Required when the design records named variants, which are its only builds. `<Default>` (alias: `default`) is the one build of a design that records none |

## Response Schema

Returns the design variant the result describes and results keyed by design name, each containing an array of [`ComponentGroup`](../schemas/shared-types.md#componentgroup) objects:

```json
{
  "design_variant": "<Default>",       // The variant described: a native name or <Default>
  "results": {
    "DesignName": [ComponentGroup, ...]
  },
  "notes": ["..."]  // Present when no matches
}
```

## Example

**Searching for sense resistors (`RS*`):**

Call:
```json
{
  "tool": "search_components_by_refdes",
  "arguments": {
    "pattern": "RS.*",
    "design": "PowerBoard/PowerBoard.PrjPcb"
  }
}
```

Response:
```json
{
  "design_variant": "<Default>",
  "results": {
    "PowerBoard": [
      {
        "mpn": "ERJ-1GNF10R0C",
        "description": "RES 10 OHM 1% 1/20W 0201",
        "value": "10R",
        "count": 3,
        "refdes": ["RS1", "RS2", "RS3"]
      }
    ]
  }
}
```

**No matches:**
```json
{
  "design_variant": "<Default>",
  "results": {
    "PowerBoard": []
  },
  "notes": ["No components matched refdes pattern 'XYZ.*'"]
}
```

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern '(unclosed'"
}
```

## Example Patterns

| Pattern | Matches |
|---------|---------|
| `U1` | Exact match for U1 |
| `U[0-9]+` | All ICs (U1, U2, U10, etc.) |
| `R[0-9]$` | Single-digit resistors (R1-R9) |
| `FB` | All ferrite beads |
| `J[0-9]+` | All connectors |

## Notes

- Pattern matching is **case-insensitive** (unlike `search_nets`)
- Inline flags like `(?i)` are accepted (matching is already case-insensitive by default)
- Results are grouped by MPN for compactness
- Components without MPN are listed individually with a `notes` field
- DNS components are included by default and flagged `dns: true`; pass `include_dns: false` for fitted parts only
- `design_variant` names the assembly the result describes. A design that records named variants requires it on every call; those variants are its only builds and `<Default>` is refused on it. `<Default>` (alias `default`) is the one build of a design that records no variant, the design with every part's own Do Not Stuff state
- `alternate_part: true` marks a group whose part the selected design variant substitutes for the base one; its `value`, `mpn`, `manufacturer`, and `description` describe the part as built for that variant
