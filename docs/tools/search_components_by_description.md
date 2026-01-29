# search_components_by_description

Search for components by description pattern.

## Description

Searches components using a regex pattern against description values. Useful for finding components by function or type when MPN is not available.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | Yes | - | Regex pattern for description (case-insensitive) |
| `design` | string | Yes | - | Absolute path to design file |
| `include_dns` | boolean | No | `false` | Include DNS components |

## Response Schema

Returns results keyed by design name, each containing an array of [`ComponentGroup`](../schemas/shared-types.md#componentgroup) objects:

```json
{
  "results": {
    "DesignName": [ComponentGroup, ...]
  },
  "notes": ["..."]  // Present when no matches or no description data
}
```

## Example

**Searching for LDO regulators:**

Call:
```json
{
  "tool": "search_components_by_description",
  "arguments": {
    "pattern": "LDO",
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
        "mpn": "TLV733P-Q1",
        "description": "IC LDO REG 300MA SOT-23-5",
        "count": 4,
        "refdes": ["U10", "U11", "U12", "U13"]
      },
      {
        "mpn": "AP2112K-3.3TRG1",
        "description": "IC LDO REG 600MA SOT-23-5",
        "count": 1,
        "refdes": "U15"
      }
    ]
  }
}
```

**No description data in design:**
```json
{
  "results": {
    "LegacyDesign": []
  },
  "notes": ["This netlist has no description data. Ask user for BOM or schematic PDF"]
}
```

**No matches:**
```json
{
  "results": {
    "PowerBoard": []
  },
  "notes": ["No components matched pattern 'FPGA'. Try a broader pattern or use search_components_by_refdes instead"]
}
```

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern '[bad'"
}
```

## Example Patterns

| Pattern | Matches |
|---------|---------|
| `LDO` | All LDO regulators |
| `BUCK` | Buck converters |
| `0402` | 0402 package components |
| `CAP.*10UF` | 10uF capacitors |
| `ESD` | ESD protection devices |
| `CONN\|HEADER` | Connectors and headers |

## Notes

- Pattern matching is **case-insensitive**
- Only searches components that have description data
- If a design has no description data, `notes` will suggest asking for a BOM
- Descriptions typically include package size, value, and function
- Use this tool when components lack MPN data but have descriptions
