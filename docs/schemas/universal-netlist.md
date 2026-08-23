# Universal Netlist Schema

This document defines the **Universal Netlist Schema** - the core data model that represents netlists from any supported EDA format (Cadence CIS, Cadence HDL, Altium Designer, KiCad). All parsers convert format-specific data into this unified representation.

## Overview

```
ParsedNetlist
├── nets: NetConnections
│   └── {netName}: { refdes: pin(s) }
└── components: ComponentDetails
    └── {refdes}: { mpn, description, pins: { pinNum: PinEntry } }
```

## ParsedNetlist

The root schema representing a complete netlist.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "nets": {
      "$ref": "#/$defs/NetConnections"
    },
    "components": {
      "$ref": "#/$defs/ComponentDetails"
    }
  },
  "required": ["nets", "components"],
  "additionalProperties": false
}
```

**Example:**

```json
{
  "nets": {
    "PP3V3": { "U1": "3", "C1": "1", "R1": "1" },
    "GND": { "U1": "2", "C1": "2" },
    "I2C_SDA": { "U1": "10", "R5": "2" }
  },
  "components": {
    "U1": {
      "mpn": "TPS62840DLCR",
      "description": "IC REG BUCK ADJ 750MA 8WSON",
      "pins": {
        "2": { "name": "GND", "net": "GND" },
        "3": { "name": "EN", "net": "PP3V3" },
        "10": { "name": "SDA", "net": "I2C_SDA" }
      }
    },
    "C1": {
      "mpn": "GRM155R61A105KE15D",
      "value": "1uF",
      "pins": { "1": "PP3V3", "2": "GND" }
    },
    "R1": {
      "mpn": "RC0402FR-071KL",
      "value": "1k",
      "pins": { "1": "PP3V3", "2": "U1_EN" }
    }
  }
}
```

## NetConnections

Maps net names to their component-pin connections. Each net lists which component pins connect to it.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": {
    "type": "object",
    "description": "Map of refdes to pin number(s)",
    "additionalProperties": {
      "oneOf": [
        { "type": "string", "description": "Single pin number" },
        {
          "type": "array",
          "items": { "type": "string" },
          "description": "Multiple pin numbers"
        }
      ]
    }
  }
}
```

**Example:**

```json
{
  "PP3V3": {
    "U1": "3",
    "C1": "1",
    "R1": "1"
  },
  "I2C_SDA": {
    "U1": ["10", "11"],
    "R5": "2"
  }
}
```

## ComponentDetails

Maps reference designators to component information including pin-to-net mappings.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": {
    "type": "object",
    "properties": {
      "mpn": {
        "type": "string",
        "description": "Manufacturer Part Number (omitted if missing)"
      },
      "description": {
        "type": "string",
        "description": "Component description"
      },
      "comment": {
        "type": "string",
        "description": "Comment field from schematic"
      },
      "value": {
        "type": "string",
        "description": "Component value (e.g., '10uF', '4.7k')"
      },
      "pins": {
        "type": "object",
        "description": "Pin number to net mapping",
        "additionalProperties": {
          "$ref": "#/$defs/PinEntry"
        }
      }
    },
    "required": ["pins"]
  }
}
```

**Example:**

```json
{
  "U1": {
    "mpn": "TPS62840DLCR",
    "description": "IC REG BUCK ADJ 750MA 8WSON",
    "pins": {
      "1": { "name": "VIN", "net": "PP5V" },
      "2": { "name": "GND", "net": "GND" },
      "3": { "name": "EN", "net": "PP5V" },
      "4": { "name": "VSET", "net": "U1_VSET" },
      "5": { "name": "SW", "net": "U1_LX" },
      "6": { "name": "VOS", "net": "PP1V8" }
    }
  },
  "R1": {
    "mpn": "RC0402FR-071KL",
    "description": "RES 1K OHM 1% 1/16W 0402",
    "value": "1k",
    "pins": {
      "1": "PP3V3",
      "2": "U1_EN"
    }
  }
}
```

## PinEntry

Represents a pin-to-net connection. Uses a string for simple pins, or an object when the pin name differs from the pin number.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "oneOf": [
    {
      "type": "string",
      "description": "Net name (used when pin name equals pin number or is not meaningful)"
    },
    {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Pin name (e.g., 'VIN', 'GND', 'EN')"
        },
        "net": {
          "type": "string",
          "description": "Connected net name"
        }
      },
      "required": ["name", "net"],
      "additionalProperties": false
    }
  ]
}
```

**Examples:**

```json
// Simple pin - pin name not meaningful or equals pin number
"1": "GND"

// Named pin - pin name adds context
"1": { "name": "VIN", "net": "PP5V" }
```

## Format-Specific Behavior

### Cadence CIS/HDL

- Component properties come from `pstxprt.dat`
- Net connections come from `pstxnet.dat`
- Pin names extracted from `pstchip.dat`
- Without `.dat` files, all three come from the `.DSN` binary schematic directly

### Altium Designer

- Component properties parsed from `.SchDoc` XML
- Net connections derived from wire/junction analysis
- Pin names come from component library definitions

### KiCad

- Component properties come from each `comp` record's `value`, `description`, and MPN-style fields
- Net connections come from the `nets` section of the resolved `kicadsexpr` export
- Pin names come from the `node` entries' `pinfunction`
- Nets declared inside a hierarchical sheet carry the sheet path in their name (e.g. `/Peripherals/D0`)

## Design Decisions

### Why Two Data Structures?

The `nets` and `components` structures are inverses of each other:

- **nets**: Optimized for "what connects to this net?" queries
- **components**: Optimized for "what does this component connect to?" queries

Both are populated during parsing to enable efficient queries without runtime transformation.

### Pin Entry Union Type

The `PinEntry` union type balances information density with token efficiency:

- **String format**: Used for passives (resistors, capacitors) where pin names are just numbers
- **Object format**: Used for ICs where pin names (VIN, EN, SW) provide semantic meaning

This reduces output size by ~30% for typical designs while preserving important pin name information.

## Loading a Universal Netlist file

A `.json` file in this schema is itself a design: `list_designs` discovers it, and every tool accepts its path. `--export-json` writes this format, so an exported design round-trips.

The file is validated on load, because the EDA parsers build a consistent netlist by construction and a file may have been written or edited by anyone. A file is refused, naming the first defect, when:

- the top level is not an object with `nets` and `components` objects, or carries any other key
- a component has no `pins` object, a text field (`mpn`, `description`, `comment`, `value`) that is not a string, or a `dns` that is not a boolean
- a pin entry is neither a net name nor an object with exactly `name` and `net`
- a net member is neither a pin number nor an array of pin numbers, is empty, or lists the same pin twice
- a net lists a component or a pin that is not declared, or a pin whose component entry puts it on a different net
- a component pin names a net that is not declared, or one that does not list that pin

A pin whose net is `""` is unconnected: it belongs to no net, and the server reports it as `NC`. Component fields outside the schema are dropped. A net member written as one pin number string is read as a one-element array.
