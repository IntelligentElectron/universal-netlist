# Universal Netlist Schema

This document defines the **Universal Netlist Schema** - the core data model that represents netlists from any supported EDA format (Cadence CIS, Cadence HDL, Altium Designer, KiCad). All parsers convert format-specific data into this unified representation.

Every on-disk Universal Netlist is named `*.netlist.json`. Its top-level
`universalNetlistSchemaVersion` identifies the document and schema; its nested
`metadata` records when the document was generated, the origin of its content,
and a verified SHA-256 identity for `nets` and `components` together. The
current version is `1`; ordinary JSON files are not Universal Netlists, even if
they happen to contain keys named `nets` or `components`.

### Schema evolution

Readers are registered by schema version. Each reader validates its historical
document shape and normalizes it into the server's internal `ParsedNetlist`, so
query tools do not need version-specific behavior. The exporter writes only the
current schema version.

When introducing version 2 or later:

1. Add a new version-specific reader and writer to the schema codec registry.
2. Keep every older reader registered so existing files remain loadable.
3. Advance `UNIVERSAL_NETLIST_SCHEMA_VERSION` only after the new codec exists.
4. Keep at least one fixture for every supported historical version.

A document with an unregistered version is refused and the error lists the
versions that build supports.

## Overview

```
UniversalNetlistDocument
├── universalNetlistSchemaVersion: 1
├── metadata
│   ├── generatedAt: "2026-09-01T12:34:56.789Z"
│   ├── netlistHash: "sha256:<64 lowercase hex digits>"
│   └── origin: { type: "native" } | { type: "vendor", source: ... }
├── nets: NetConnections
│   └── {netName}: { refdes: pin(s) }
└── components: ComponentDetails
    └── {refdes}: { mpn, description, pins: { pinNum: PinEntry } }
```

## UniversalNetlistDocument

The root schema representing a complete netlist.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "universalNetlistSchemaVersion": {
      "const": 1
    },
    "metadata": {
      "type": "object",
      "properties": {
        "generatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "netlistHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "origin": {
          "oneOf": [
            {
              "type": "object",
              "properties": { "type": { "const": "native" } },
              "required": ["type"],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "type": { "const": "vendor" },
                "source": {
                  "type": "object",
                  "properties": {
                    "vendor": { "type": "string", "minLength": 1 },
                    "fileType": {
                      "type": "string",
                      "pattern": "^\\.[a-z0-9][a-z0-9_+-]*$"
                    },
                    "formatVersion": { "type": "string", "minLength": 1 }
                  },
                  "required": ["vendor", "fileType"],
                  "additionalProperties": false
                }
              },
              "required": ["type", "source"],
              "additionalProperties": false
            }
          ]
        }
      },
      "required": ["generatedAt", "netlistHash", "origin"],
      "additionalProperties": false
    },
    "nets": {
      "$ref": "#/$defs/NetConnections"
    },
    "components": {
      "$ref": "#/$defs/ComponentDetails"
    }
  },
  "required": [
    "universalNetlistSchemaVersion",
    "metadata",
    "nets",
    "components"
  ],
  "additionalProperties": false
}
```

**Example:**

```json
{
  "universalNetlistSchemaVersion": 1,
  "metadata": {
    "generatedAt": "2026-09-01T12:34:56.789Z",
    "netlistHash": "sha256:d162573135e49348295f639ec3485dc0cb233cebbb56bbbb4f8055bc202e3649",
    "origin": {
      "type": "vendor",
      "source": {
        "vendor": "Cadence",
        "fileType": ".dsn",
        "formatVersion": "3.3"
      }
    }
  },
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

## Metadata, content hash, and origin

`metadata.netlistHash` is SHA-256 over one canonical JSON object containing the
complete normalized `nets` and `components` payload together. Object keys are
sorted recursively before hashing; array order is preserved. The schema version
and complete `metadata` object are excluded, so identical electrical content
has the same hash regardless of its generation time or provenance. Readers
recompute and verify the hash before accepting a document.

This is an integrity checksum, not a digital signature: anyone who changes a
netlist can recompute its hash. It detects stale or accidental changes and gives
identical content a stable identifier; it does not establish who produced the
file.

`metadata.generatedAt` is the instant this JSON document was generated, encoded
as the canonical UTC form produced by JavaScript `Date.toISOString()`, including
milliseconds and the trailing `Z`. It applies to both native documents and
documents converted from vendor files.

`metadata.origin.type` is `native` when the Universal Netlist was created
directly. Native origins omit `source`. It is `vendor` when a vendor file was
parsed; then `source.vendor` and the canonical lowercase extension in
`source.fileType` are required. `source.formatVersion` is optional because many
files do not carry a reliable embedded format version.

There is intentionally no `modifiedAt` in schema version 1: it cannot be kept
reliable when JSON may be hand-edited. Editing `nets` or `components` is allowed,
but requires recomputing `netlistHash`. The hash detects a mismatch; it does not
make the file immutable.

## Loading a Universal Netlist file

A `.netlist.json` file in this schema is itself a design: `list_designs` discovers it, and every tool accepts its path. `universal-netlist export-json <design> [output.netlist.json]` writes this format, so an exported design round-trips. Other `.json` files are ignored.

The file is validated on load, because the EDA parsers build a consistent netlist by construction and a file may have been written or edited by anyone. A file is refused, naming the first defect, when:

- `universalNetlistSchemaVersion` is missing, is not an integer, or names a version the reader does not support
- `metadata.netlistHash` is missing, malformed, or does not match canonical `nets` and `components`
- `metadata.generatedAt` is missing or is not a canonical ISO 8601 UTC timestamp
- `metadata.origin` is not a valid native or vendor origin, or vendor source metadata is incomplete
- `nets` or `components` is not an object, or the document carries any other top-level or metadata key
- a component has no `pins` object, a text field (`mpn`, `description`, `comment`, `value`) that is not a string, or a `dns` that is not a boolean
- a pin entry is neither a net name nor an object with exactly `name` and `net`
- a net member is neither a pin number nor an array of pin numbers, is empty, or lists the same pin twice
- a net lists a component or a pin that is not declared, or a pin whose component entry puts it on a different net
- a component pin names a net that is not declared, or one that does not list that pin

A pin whose net is `""` is unconnected: it belongs to no net, and the server reports it as `NC`. Component fields outside the schema are dropped. A net member written as one pin number string is read as a one-element array.
