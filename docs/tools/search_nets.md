# search_nets

Search for nets matching a regex pattern.

## Description

Searches all net names in a design using a regular expression pattern. Useful for finding related signals (e.g., all I2C nets, all power rails).

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | Yes | - | Regex pattern to match against net names |
| `design` | string | Yes | - | Path to design file |
| `design_variant` | string | Conditional | - | Design variant name from `list_designs`' `design_variants`, or `<Default>` (alias: `default`) for the unmodified/core design. Required when the design records named variants |

## Response Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "design_variant": {
      "type": "string",
      "description": "The design variant this result describes: a native name or <Default>"
    },
    "results": {
      "type": "object",
      "description": "Keyed by design name",
      "additionalProperties": {
        "type": "array",
        "items": { "type": "string" }
      }
    },
    "notes": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Present when no matches found"
    }
  },
  "required": ["design_variant", "results"]
}
```

## Example

**Searching for I2C nets:**

Call:
```json
{
  "tool": "search_nets",
  "arguments": {
    "pattern": "I2C",
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
      "I2C0_SCL",
      "I2C0_SDA",
      "I2C1_SCL",
      "I2C1_SDA"
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
  "notes": ["No nets matched pattern 'SPI_.*'"]
}
```

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern '[unclosed'"
}
```

## Example Patterns

| Pattern | Matches |
|---------|---------|
| `I2C` | Any net containing "I2C" |
| `^PP` | Nets starting with "PP" (power rails) |
| `_[PN]$` | Nets ending with "_P" or "_N" (differential pairs) |
| `SPI.*MOSI` | SPI MOSI signals |
| `CLK\|CLOCK` | Nets containing "CLK" or "CLOCK" |
| `vdd` | Case-insensitive: matches "VDD", "vdd", "Vdd" |

## Notes

- Pattern matching is **case-insensitive** by default
- Inline flags like `(?i)` are accepted (matching is already case-insensitive by default)
- Results are sorted alphabetically
- The design name (without extension) is used as the results key
- Empty results include a `notes` field explaining the empty match
- `design_variant` names the assembly the result describes. A design that records named variants requires it on every call; `<Default>` (alias `default`) selects the unmodified/core design
- **KiCad**: nets declared inside a hierarchical sheet are sheet-path-prefixed (e.g. a `D0` data line on the Peripherals sheet is named `/Peripherals/D0`, not `/D0`). Prefer unanchored patterns like `D0` over `^/D0$` to avoid missing bussed or hierarchical nets
