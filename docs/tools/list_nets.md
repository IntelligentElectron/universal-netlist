# list_nets

List all net names in a design.

## Description

Returns all net names defined in the design, sorted alphabetically. Use this to understand the design's signal structure or find specific nets for querying.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Absolute path to design file |

## Response Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "nets": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of net names, sorted alphabetically"
    }
  },
  "required": ["nets"]
}
```

## Example

**Listing all nets in a design:**

Call:
```json
{
  "tool": "list_nets",
  "arguments": {
    "design": "/Users/eng/projects/PowerBoard/PowerBoard.PrjPcb"
  }
}
```

Response:
```json
{
  "nets": [
    "AGND",
    "CLK_25MHZ",
    "GND",
    "I2C_SCL",
    "I2C_SDA",
    "NC",
    "PP1V8",
    "PP3V3",
    "PP5V",
    "SPI_CLK",
    "SPI_CS",
    "SPI_MISO",
    "SPI_MOSI",
    "USB_DM",
    "USB_DP",
    "VBUS"
  ]
}
```

**Error (unsupported format):**
```json
{
  "error": "Unsupported design file format '.kicad_pcb'. Supported: .dsn, .cpm (Cadence), .PrjPcb (Altium)"
}
```

## Notes

- Nets are sorted alphabetically (case-sensitive)
- The `NC` net represents "No Connect" pins
- Power nets typically follow naming conventions:
  - `PP*` for power rails (e.g., `PP3V3`, `PP1V8_CORE`)
  - `GND`, `AGND`, `DGND` for grounds
- For targeted searches, use `search_nets` with a regex pattern instead
