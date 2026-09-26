# query_component

Get full component details including all pin connections.

## Description

Returns detailed information about a specific component, including MPN, description, and all pin-to-net mappings. The result names the `design_variant` it describes, and its part fields describe the part as built for that variant: a part the variant substitutes for the base one is flagged `alternate_part: true`.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to design file |
| `refdes` | string | Yes | - | Component reference designator (e.g., `U1`, `R10`) |
| `design_variant` | string | Conditional | - | Design variant name from `list_designs`' `design_variants`. Required when the design records named variants, which are its only builds. `<Default>` (alias: `default`) is the one build of a design that records none |

## Response Schema

Returns component details with pin-to-net mappings using [`PinEntry`](../schemas/universal-netlist.md#pinentry) format:

```json
{
  "design_variant": "<Default>", // The variant described: a native name or <Default>
  "refdes": "string",
  "mpn": "string",              // optional, the manufacturer's part number
  "internal_pn": "string",      // optional, the design owner's part number
  "manufacturer": "string",     // optional, the manufacturer's name
  "description": "string",       // optional
  "comment": "string",           // optional
  "value": "string",             // optional
  "dns": true,                   // optional, true if Do Not Stuff
  "alternate_part": true,        // optional, true when the selected variant substitutes this part for the base one
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
    "design": "PowerBoard/PowerBoard.PrjPcb",
    "refdes": "U1"
  }
}
```

Response:
```json
{
  "design_variant": "<Default>",
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
  "design_variant": "<Default>",
  "refdes": "R1",
  "mpn": "RC0402FR-071KL",
  "internal_pn": "INT-1001",
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
  "design_variant": "<Default>",
  "refdes": "C5",
  "description": "CAP CER 10UF 0402",
  "value": "10uF",
  "pins": {
    "1": "PP1V8",
    "2": "GND"
  },
  "notes": ["MPN not found in exported netlist data. Tell user to update symbol properties in library, or to point you to the BOM"]
}
```

**Alternate part in a selected design variant:**

Call:
```json
{
  "tool": "query_component",
  "arguments": {
    "design": "PowerBoard/PowerBoard.PrjPcb",
    "refdes": "R94",
    "design_variant": "Production"
  }
}
```

Response:
```json
{
  "design_variant": "Production",
  "refdes": "R94",
  "mpn": "CRG0805F12K",
  "manufacturer": "TE Connectivity",
  "description": "RES 12K OHM 1% 0805",
  "value": "12k",
  "alternate_part": true,
  "pins": {
    "1": "ADC_REF",
    "2": "GND"
  }
}
```

The same call with `design_variant: "<Default>"` returns the base part (here a 5.6k Yageo `RC0805FR-075K6L`) with no `alternate_part` field.

**Error (component not found):**
```json
{
  "error": "Component 'U99' not found in design 'PowerBoard'. Use list_components() or search_components_by_refdes() to find available components."
}
```

**Error (design variant omitted on a design that records named variants):**
```json
{
  "error": "Design 'BSPD_002.PrjPcb' defines design variants ['BSPD-DNP']. Pass design_variant as one of those names; they are the only builds it records. list_designs() reports them under design_variants."
}
```

**Error (unknown design variant):**
```json
{
  "error": "Design variant 'Production' not found for design 'BSPD_002.PrjPcb'. Available: ['BSPD-DNP']."
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
- Components without a part number omit the `mpn` field and include a `notes` field
- `mpn` is the manufacturer's part number and nothing else; `internal_pn` is the
  number the design owner identifies the part by. They are different namespaces,
  neither is derived from the other, and each is omitted when the design records
  it nowhere. `mpn` is never filled from a library symbol or footprint name
- Pin numbers are string keys (may be alphanumeric like `A1`, `B2` for BGAs)
- `design_variant` names the assembly the result describes. A design that records named variants requires it on every call; those variants are its only builds and `<Default>` is refused on it. `<Default>` (alias `default`) is the one build of a design that records no variant, the design with every part's own Do Not Stuff state, names match case-insensitively, and the result echoes the canonical spelling
- `alternate_part: true` is present when the selected design variant substitutes another part for the base one. `value`, `mpn`, `manufacturer`, and `description` always describe the part as built for the selected variant; a DNS part in that variant carries `dns: true` beside it
