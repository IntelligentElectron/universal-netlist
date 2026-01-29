# Shared Response Types

This document defines shared types used across tool responses in the Universal Netlist MCP Server.

For the core netlist data model, see [universal-netlist.md](universal-netlist.md).

## ComponentGroup

Used in `list_components` and `search_components_by_*` results. Groups components by MPN for compact output.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "refdes": {
      "oneOf": [
        { "type": "string" },
        { "type": "array", "items": { "type": "string" } }
      ],
      "description": "Single refdes or array (compacted)"
    },
    "count": {
      "type": "integer",
      "description": "Number of components in group"
    },
    "mpn": {
      "oneOf": [
        { "type": "string" },
        { "type": "null" }
      ],
      "description": "Manufacturer Part Number (null if missing)"
    },
    "description": {
      "type": "string",
      "description": "Component description (omitted if not available)"
    },
    "comment": {
      "type": "string",
      "description": "Optional comment field"
    },
    "value": {
      "type": "string",
      "description": "Optional value (e.g., '10uF', '4.7k')"
    },
    "dns": {
      "type": "boolean",
      "description": "True if Do Not Stuff"
    },
    "notes": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Informational notes (e.g., missing MPN warning)"
    }
  },
  "required": ["refdes", "count", "mpn"]
}
```

**Example:**

```json
{
  "mpn": "RC0402FR-071KL",
  "description": "RES 1K OHM 1% 1/16W 0402",
  "value": "1k",
  "count": 5,
  "refdes": ["R1", "R2", "R3", "R5", "R7"]
}
```

## AggregatedComponent

Used in `query_xnet_*` results. Groups components by MPN with orientation tracking.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "mpn": {
      "oneOf": [
        { "type": "string" },
        { "type": "null" }
      ]
    },
    "description": { "type": "string" },
    "comment": { "type": "string" },
    "value": { "type": "string" },
    "dns": { "type": "boolean" },
    "total_count": {
      "type": "integer",
      "description": "Total components with this MPN"
    },
    "refdes": {
      "oneOf": [
        { "type": "string" },
        { "type": "array", "items": { "type": "string" } }
      ],
      "description": "Present when single orientation"
    },
    "connections": {
      "type": "array",
      "items": { "$ref": "#/$defs/PinNetConnection" },
      "description": "Present when single orientation"
    },
    "orientations": {
      "type": "array",
      "items": { "$ref": "#/$defs/OrientationVariant" },
      "description": "Present when multiple orientations"
    },
    "notes": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["mpn", "total_count"]
}
```

**Example (single orientation):**

```json
{
  "mpn": "RC0402FR-074K7L",
  "description": "RES 4.7K OHM 1% 0402",
  "value": "4.7k",
  "total_count": 2,
  "refdes": ["R10", "R11"],
  "connections": [
    { "net": "PP3V3", "pins": "1" },
    { "net": "I2C_SDA", "pins": "2" }
  ]
}
```

**Example (multiple orientations):**

```json
{
  "mpn": "RC0402FR-0710KL",
  "description": "RES 10K OHM 1% 0402",
  "value": "10k",
  "total_count": 4,
  "orientations": [
    {
      "count": 2,
      "refdes": ["R1", "R2"],
      "connections": [
        { "net": "PP3V3", "pins": "1" },
        { "net": "GPIO_A", "pins": "2" }
      ]
    },
    {
      "count": 2,
      "refdes": ["R3", "R4"],
      "connections": [
        { "net": "GPIO_B", "pins": "1" },
        { "net": "PP3V3", "pins": "2" }
      ]
    }
  ]
}
```

### Count Field Naming

`AggregatedComponent` uses `total_count` while `OrientationVariant` uses `count`. This distinction is intentional:

| Type | Field | Meaning |
|------|-------|---------|
| `AggregatedComponent` | `total_count` | Sum of all components with this MPN across all orientations |
| `OrientationVariant` | `count` | Number of components with this specific orientation |

When all components share the same orientation, `total_count` equals the implicit count. When multiple orientations exist, `total_count` = sum of all `orientations[].count`.

### Single vs Multiple Orientation Modes

`AggregatedComponent` has two mutually exclusive modes based on whether components share the same pin-to-net wiring:

**Single orientation mode** (all components wired identically):
- `refdes`: present (string or array)
- `connections`: present (array of `PinNetConnection`)
- `orientations`: absent

**Multiple orientations mode** (different wiring patterns exist):
- `refdes`: absent
- `connections`: absent
- `orientations`: present (array of `OrientationVariant`)

This is an XOR relationship: a response will have either (`refdes` + `connections`) OR `orientations`, never both.

## PinNetConnection

Represents pin-to-net connections in circuit traversal results.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "net": {
      "type": "string",
      "description": "Connected net name"
    },
    "pins": {
      "oneOf": [
        { "type": "string" },
        { "type": "array", "items": { "type": "string" } }
      ],
      "description": "Pin numbers (compacted)"
    }
  },
  "required": ["net", "pins"]
}
```

**Examples:**

```json
// Single pin
{ "net": "PP3V3", "pins": "1" }

// Multiple pins on same net
{ "net": "GND", "pins": ["2", "4", "6"] }
```

## OrientationVariant

Tracks different orientations/polarities for 2-pin components.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "count": {
      "type": "integer",
      "description": "Number of components with this orientation"
    },
    "refdes": {
      "oneOf": [
        { "type": "string" },
        { "type": "array", "items": { "type": "string" } }
      ]
    },
    "connections": {
      "type": "array",
      "items": { "$ref": "#/$defs/PinNetConnection" }
    }
  },
  "required": ["count", "refdes", "connections"]
}
```

**Example:**

```json
{
  "count": 3,
  "refdes": ["R1", "R2", "R3"],
  "connections": [
    { "net": "PP3V3", "pins": "1" },
    { "net": "EN_SIGNAL", "pins": "2" }
  ]
}
```

## AggregatedCircuitResult

Response type for `query_xnet_by_net_name` and `query_xnet_by_pin_name`.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "starting_point": {
      "type": "string",
      "description": "The query starting point (net name or 'REFDES.PIN')"
    },
    "net": {
      "type": "string",
      "description": "The starting net name (present when querying by pin)"
    },
    "total_components": {
      "type": "integer",
      "description": "Total number of components in the circuit"
    },
    "unique_configurations": {
      "type": "integer",
      "description": "Number of unique MPN/orientation combinations"
    },
    "components_by_mpn": {
      "type": "array",
      "items": { "$ref": "#/$defs/AggregatedComponent" },
      "description": "Components grouped by MPN with orientation tracking"
    },
    "visited_nets": {
      "type": "array",
      "items": { "type": "string" },
      "description": "All nets encountered during traversal"
    },
    "circuit_hash": {
      "type": "string",
      "description": "Stable 16-character hash identifying this circuit topology"
    },
    "skipped": {
      "type": "object",
      "additionalProperties": { "type": "integer" },
      "description": "Count of skipped components by type (when skip_types used)"
    }
  },
  "required": ["starting_point", "total_components", "unique_configurations", "components_by_mpn", "visited_nets", "circuit_hash"]
}
```

**Example:**

```json
{
  "starting_point": "I2C_SDA",
  "total_components": 3,
  "unique_configurations": 2,
  "components_by_mpn": [
    {
      "mpn": "RC0402FR-074K7L",
      "description": "RES 4.7K OHM 1% 0402",
      "value": "4.7k",
      "total_count": 1,
      "refdes": "R10",
      "connections": [
        { "net": "PP3V3", "pins": "1" },
        { "net": "I2C_SDA", "pins": "2" }
      ]
    },
    {
      "mpn": "TPS62840DLCR",
      "description": "IC REG BUCK 750MA",
      "total_count": 1,
      "refdes": "U5",
      "connections": [
        { "net": "I2C_SDA", "pins": "3" }
      ]
    }
  ],
  "visited_nets": ["I2C_SDA", "PP3V3"],
  "circuit_hash": "a1b2c3d4e5f67890"
}
```

## ErrorResult

All tools may return an error result instead of the expected response.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "error": {
      "type": "string",
      "description": "Error message"
    }
  },
  "required": ["error"],
  "additionalProperties": false
}
```

**Example:**

```json
{
  "error": "Component 'U99' not found in design 'PowerBoard'. Use list_components() to find available components."
}
```

## Compact Array Behavior

To reduce token usage, single-element arrays are compacted to scalar values:

```json
// Array with multiple elements: preserved as array
["R1", "R2", "R3"]

// Array with single element: compacted to scalar
"R1"  // instead of ["R1"]
```

This applies to:
- `refdes` fields in `ComponentGroup` and `AggregatedComponent`
- `pins` fields in `PinNetConnection`

## DNS Detection

Components are marked as DNS (Do Not Stuff) when any of their MPN, description, or comment fields match these markers (case-insensitive):

**Acronyms:**
- `DNS` - Do Not Stuff
- `DNP` - Do Not Populate
- `DNF` - Do Not Fit
- `DNI` - Do Not Install

**Phrases:**
- `DO NOT STUFF`
- `DO NOT POPULATE`
- `DO NOT INSTALL`
- `NOT POPULATED`
- `NO POP`

**Regex pattern (for reference):**
```regex
/\b(DNS|DNP|DNF|DNI)\b|DO\s*NOT\s*(STUFF|POPULATE|INSTALL)|NOT\s*POPULATED|NO\s*POP/i
```

DNS components are excluded by default. Use `include_dns: true` to include them.

## Power/Ground Stop Nets

Circuit traversal (`query_xnet_*`) stops at power and ground nets to prevent unbounded exploration.

**Ground nets:**
- `GND`, `VSS`, `AGND`, `DGND`, `PGND`, `SGND`, `CGND`

**Power rail patterns:**
- `VCC*`, `VDD*` - Standard power rails
- `VIN*`, `VOUT*` - Input/output voltage rails
- `VBAT*`, `VBUS*`, `VSYS*` - Battery, USB, and system rails
- `PP*`, `PN*` - Power positive/negative (common convention)
- `LD_PP*`, `LD_PN*` - Load-side power rails (downstream of sense resistors)
- `PWR_*`, `RAIL_*` - Explicit power rail naming
- Voltage patterns: `+3V3`, `+5V`, `-12V`, `1V8`, etc. (matches `[+-]?\d+V\d*\w*`)
- Any net starting with `+` or `-` (e.g., `+BATT`, `-5V_REF`)

**Regex pattern (for reference):**
```regex
/^(GND|VSS|AGND|DGND|PGND|SGND|CGND|VCC\w*|VDD\w*|VIN\w*|VOUT\w*|VBAT\w*|VBUS\w*|VSYS\w*|PWR_\w+|RAIL_\w+|PP\w*|PN\w*|LD_PP\w*|LD_PN\w*|[+-]?\d+V\d*\w*|[+-].+)$/i
```

**Note:** `NC` (No Connect) is not a stop net but is handled specially - pins connected to NC return an empty circuit.

## Notes Array

The `notes` field provides contextual information:

| Note | Meaning |
|------|---------|
| `"MPN not found in exported netlist data..."` | Component lacks MPN; suggest user provide BOM |
| `"No nets matched pattern '...'"` | Search returned empty results |
| `"This netlist has no MPN data..."` | Design has no MPN information |

## Case Sensitivity

Different operations have different case sensitivity behaviors:

| Operation | Case Sensitive | Notes |
|-----------|----------------|-------|
| `search_nets` pattern | Yes | Regex pattern matches exactly as provided |
| `search_components_by_refdes` pattern | No | Regex uses `i` flag for case-insensitive matching |
| `search_components_by_mpn` pattern | No | Regex uses `i` flag for case-insensitive matching |
| `search_components_by_description` pattern | No | Regex uses `i` flag for case-insensitive matching |
| `query_component` refdes | No | Refdes lookup is case-insensitive |
| `query_xnet_by_pin_name` refdes/pin | No | Both refdes and pin lookup are case-insensitive |
| `list_components` type prefix | No | Prefix matching is case-insensitive |

**Examples:**
- `search_nets("USB")` matches `USB_DP` but not `usb_dp`
- `search_components_by_refdes("u1")` matches `U1`, `u1`, and `U1A`
- `query_component("u15")` finds component `U15`
