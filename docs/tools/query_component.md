# query_component

Get full component details including all pin connections.

## Description

Returns detailed information about a specific component, including MPN, description, and all pin-to-net mappings.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Absolute path to design file |
| `refdes` | string | Yes | - | Component reference designator (e.g., `U1`, `R10`) |

## Response Schema

Returns component details with pin-to-net mappings using [`PinEntry`](../schemas/universal-netlist.md#pinentry) format:

```json
{
  "refdes": "string",
  "mpn": "string | null",
  "description": "string",       // optional
  "comment": "string",           // optional
  "value": "string",             // optional
  "dns": true,                   // optional, true if Do Not Stuff
  "pins": {
    "pinNumber": PinEntry,       // See PinEntry in universal-netlist.md
    ...
  },
  "notes": ["..."]               // optional
}
```

## Example

**Querying an IC with named pins:**

Call:
```json
{
  "tool": "query_component",
  "arguments": {
    "design": "/Users/eng/projects/PowerBoard/PowerBoard.PrjPcb",
    "refdes": "U1"
  }
}
```

Response:
```json
{
  "refdes": "U1",
  "mpn": "TPS62840DLCR",
  "description": "IC REG BUCK ADJ 750MA 8WSON",
  "pins": {
    "1": { "name": "VIN", "net": "PP5V" },
    "2": { "name": "GND", "net": "GND" },
    "3": { "name": "EN", "net": "PP5V" },
    "4": { "name": "VSET", "net": "U1_VSET" },
    "5": { "name": "SW", "net": "U1_LX" },
    "6": { "name": "VOS", "net": "PP1V8" },
    "7": { "name": "NC", "net": "NC" },
    "8": { "name": "GND", "net": "GND" }
  }
}
```

**Resistor with simple pins:**
```json
{
  "refdes": "R1",
  "mpn": "RC0402FR-071KL",
  "description": "RES 1K OHM 1% 1/16W 0402",
  "value": "1k",
  "pins": {
    "1": "PP3V3",
    "2": "U1_EN"
  }
}
```

**Component without MPN:**
```json
{
  "refdes": "C5",
  "mpn": null,
  "description": "CAP CER 10UF 0402",
  "value": "10uF",
  "pins": {
    "1": "PP1V8",
    "2": "GND"
  },
  "notes": ["MPN not found in exported netlist data. Tell user to update symbol properties in library, or to point you to the BOM"]
}
```

**Error (component not found):**
```json
{
  "error": "Component 'U99' not found in design 'PowerBoard'. Use list_components() or search_components_by_refdes() to find available components."
}
```

## Pin Entry Format

Pins use two formats:

1. **Simple string**: When pin name equals pin number or has no name
   ```json
   "1": "GND"
   ```

2. **Object with name**: When pin name differs from pin number
   ```json
   "1": { "name": "VIN", "net": "PP5V" }
   ```

## Notes

- Reference designator lookup is **case-insensitive** (`u1` matches `U1`)
- The `NC` net indicates an unconnected pin (No Connect)
- Components with `mpn: null` include a `notes` field
- Pin numbers are string keys (may be alphanumeric like `A1`, `B2` for BGAs)
