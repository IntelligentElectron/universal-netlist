# search_components_by_mpn

Search for components by Manufacturer Part Number (MPN) pattern.

## Description

Searches components using a regex pattern against MPN values. Useful for finding all instances of a specific part or part family.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | Yes | - | Regex pattern for MPN (case-insensitive) |
| `design` | string | Yes | - | Absolute path to design file |
| `include_dns` | boolean | No | `false` | Include DNS components |

## Response Schema

Returns results keyed by design name, each containing an array of [`ComponentGroup`](../schemas/shared-types.md#componentgroup) objects:

```json
{
  "results": {
    "DesignName": [ComponentGroup, ...]
  },
  "notes": ["..."]  // Present when no matches or no MPN data
}
```

## Example

**Searching for TPS buck regulators:**

Call:
```json
{
  "tool": "search_components_by_mpn",
  "arguments": {
    "pattern": "TPS62",
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
        "mpn": "TPS62840DLCR",
        "description": "IC REG BUCK ADJ 750MA 8WSON",
        "count": 2,
        "refdes": ["U1", "U5"]
      },
      {
        "mpn": "TPS62088YFPR",
        "description": "IC REG BUCK ADJ 2A 12DSBGA",
        "count": 1,
        "refdes": "U3"
      }
    ]
  }
}
```

**No MPN data in design:**
```json
{
  "results": {
    "OldDesign": []
  },
  "notes": ["This netlist has no MPN data. Ask user for BOM or schematic PDF"]
}
```

**No matches:**
```json
{
  "results": {
    "PowerBoard": []
  },
  "notes": ["No components matched pattern 'STM32.*'. Try a broader pattern or use search_components_by_refdes instead"]
}
```

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern '(?invalid)'"
}
```

## Example Patterns

| Pattern | Matches |
|---------|---------|
| `TPS62` | All TPS62xxx buck regulators |
| `^RC0402` | 0402 resistors starting with RC |
| `DLCR$` | Parts ending in DLCR package code |
| `LDO\|REG` | LDO or regulator parts |
| `.*BUCK.*` | Any part with "BUCK" in the MPN |

## Notes

- Pattern matching is **case-insensitive**
- Only searches components that have MPN data
- If a design has no MPN data at all, `notes` will suggest asking for a BOM
- Components without MPN cannot be found with this tool; use `search_components_by_refdes` instead
