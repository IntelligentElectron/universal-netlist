# search_nets

Search for nets matching a regex pattern.

## Description

Searches all net names in a design using a regular expression pattern. Useful for finding related signals (e.g., all I2C nets, all power rails).

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | Yes | - | Regex pattern to match against net names |
| `design` | string | Yes | - | Absolute path to design file |

## Response Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
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
  "required": ["results"]
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
    "design": "/Users/eng/projects/PowerBoard/PowerBoard.PrjPcb"
  }
}
```

Response:
```json
{
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

## Notes

- Pattern matching is case-sensitive
- Results are sorted alphabetically
- The design name (without extension) is used as the results key
- Empty results include a `notes` field explaining the empty match
