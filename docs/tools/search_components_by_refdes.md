# search_components_by_refdes

Search for components by reference designator pattern.

## Description

Searches components using a regex pattern against reference designators. Components are grouped by MPN for compact output.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | Yes | - | Regex pattern for refdes (case-insensitive) |
| `design` | string | Yes | - | Absolute path to design file |
| `include_dns` | boolean | No | `false` | Include DNS components |

## Response Schema

Returns results keyed by design name, each containing an array of [`ComponentGroup`](../schemas/shared-types.md#componentgroup) objects:

```json
{
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
    "design": "/Users/eng/projects/PowerBoard/PowerBoard.PrjPcb"
  }
}
```

Response:
```json
{
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
- Results are grouped by MPN for compactness
- Components without MPN are listed individually with a `notes` field
- Single-element arrays are compacted to scalar strings
