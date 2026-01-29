# list_components

List components of a specific type in a design.

## Description

Lists all components matching a reference designator prefix (e.g., `U` for ICs, `R` for resistors). Components are grouped by MPN for compact output.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Absolute path to design file (e.g., `/path/to/Design.PrjPcb`) |
| `type` | string | Yes | - | Component prefix: `U`, `C`, `R`, `L`, `J`, `D`, `Q`, etc. |
| `include_dns` | boolean | No | `false` | Include DNS (Do Not Stuff) components |

## Response Schema

Returns an array of [`ComponentGroup`](../schemas/shared-types.md#componentgroup) objects:

```json
{
  "components": [ComponentGroup, ...]
}
```

## Example

**Listing ICs in a design:**

Call:
```json
{
  "tool": "list_components",
  "arguments": {
    "design": "/Users/eng/projects/PowerBoard/PowerBoard.PrjPcb",
    "type": "U"
  }
}
```

Response:
```json
{
  "components": [
    {
      "mpn": "TPS62840DLCR",
      "description": "IC REG BUCK ADJ 750MA 8WSON",
      "count": 2,
      "refdes": ["U1", "U2"]
    },
    {
      "mpn": "STM32F401CCU6",
      "description": "IC MCU 32BIT 256KB FLASH 48UFQFPN",
      "count": 1,
      "refdes": "U5"
    },
    {
      "mpn": null,
      "description": "IC GENERIC",
      "count": 1,
      "refdes": "U3",
      "notes": ["MPN not found in exported netlist data. Tell user to update symbol properties in library, or to point you to the BOM"]
    }
  ]
}
```

**Error (invalid prefix):**
```json
{
  "error": "No components with prefix 'X' found in design 'PowerBoard'. Available prefixes: [C, D, FB, J, L, Q, R, RS, U]"
}
```

## Notes

- The `type` parameter is case-insensitive (`u` and `U` both work)
- Components are grouped by MPN; components without MPN are listed individually
- Single-element `refdes` arrays are compacted to strings
- Components with `mpn: null` include a `notes` field suggesting next steps
- Use `include_dns: true` to see DNS components (marked with `dns: true`)

## See Also

- [Compact Array Behavior](../schemas/shared-types.md#compact-array-behavior) - How single-element arrays are compacted
- [DNS Detection](../schemas/shared-types.md#dns-detection) - How DNS components are identified
- [Notes Array](../schemas/shared-types.md#notes-array) - Meaning of notes field values
