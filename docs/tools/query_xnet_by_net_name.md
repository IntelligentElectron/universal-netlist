# query_xnet_by_net_name

Get full XNET (Extended Net) connectivity for a net.

## Description

Traces circuit connectivity starting from a net name, traversing through series components (resistors, capacitors, inductors, ferrite beads). Stops at power/ground nets to prevent unbounded traversal.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Absolute path to design file |
| `net_name` | string | Yes | - | Exact net name to start from |
| `skip_types` | string[] | No | `[]` | Component prefixes to exclude (e.g., `["C", "L"]`) |
| `include_dns` | boolean | No | `false` | Include DNS components |

## Response Schema

Returns circuit traversal results with components grouped by MPN. See [`AggregatedComponent`](../schemas/shared-types.md#aggregatedcomponent) for the component schema:

```json
{
  "starting_point": "string",           // The net name
  "total_components": 0,                // Total components found
  "unique_configurations": 0,           // Unique MPN/orientation combinations
  "components_by_mpn": [AggregatedComponent, ...],
  "visited_nets": ["net1", "net2"],     // All nets traversed
  "circuit_hash": "string",             // Unique circuit topology hash
  "skipped": { "C": 5, "L": 2 }         // Skipped component counts by type (optional)
}
```

**Related types:**
- [`AggregatedComponent`](../schemas/shared-types.md#aggregatedcomponent) - Component grouping with orientation tracking
- [`PinNetConnection`](../schemas/shared-types.md#pinnetconnection) - Pin-to-net mappings
- [`OrientationVariant`](../schemas/shared-types.md#orientationvariant) - Different wiring patterns

## Example

**Tracing an I2C signal:**

Call:
```json
{
  "tool": "query_xnet_by_net_name",
  "arguments": {
    "design": "/Users/eng/projects/PowerBoard/PowerBoard.PrjPcb",
    "net_name": "I2C_SDA"
  }
}
```

Response:
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
      "total_count": 2,
      "refdes": ["R10", "R11"],
      "connections": [
        { "net": "PP3V3", "pins": "1" },
        { "net": "I2C_SDA", "pins": "2" }
      ]
    },
    {
      "mpn": "STM32F401CCU6",
      "description": "IC MCU 32BIT 256KB FLASH 48UFQFPN",
      "total_count": 1,
      "refdes": "U5",
      "connections": [
        { "net": "I2C_SDA", "pins": ["41", "42"] }
      ]
    }
  ],
  "visited_nets": ["I2C_SDA", "PP3V3"],
  "circuit_hash": "a7b3c9d2"
}
```

**With skipped components:**
```json
{
  "starting_point": "PP3V3",
  "total_components": 5,
  "unique_configurations": 3,
  "components_by_mpn": [...],
  "visited_nets": ["PP3V3", "PP3V3_FILTERED"],
  "circuit_hash": "e4f5a6b7",
  "skipped": {
    "C": 12,
    "L": 2
  }
}
```

**Error (net not found):**
```json
{
  "error": "Net 'SPI_CLK' not found in design 'PowerBoard'. Use search_nets() to find available nets."
}
```

**Error (ground net blocked):**
```json
{
  "error": "GND is a ground net and cannot be queried."
}
```

Ground nets return massive results that are not useful, so they are blocked. See [Power/Ground Stop Nets](../schemas/shared-types.md#powerground-stop-nets) for the full list.

## Circuit Hash

The `circuit_hash` uniquely identifies the circuit topology based on:
- Component types present
- MPN values
- Connection patterns

Identical hashes indicate identical circuit structures, useful for comparing designs or detecting duplicates.

## Traversal Behavior

- **Traverses through**: 2-pin series components (R, RS, FR, C, L, FB)
- **Stops at**: Power rails, ground nets, multi-pin ICs
- **Stop nets**: See [Power/Ground Stop Nets](../schemas/shared-types.md#powerground-stop-nets)

## skip_types Parameter

Use `skip_types` to exclude components during traversal:

| Pattern | Effect |
|---------|--------|
| `["C"]` | Skip capacitors (useful for AC-coupled signals) |
| `["C", "L"]` | Skip caps and inductors (useful for power rails) |
| `["FB"]` | Skip ferrite beads |

Skipped components appear in the `skipped` field with counts.

## Notes

- Components are aggregated by MPN for compact output
- 2-pin components with different orientations are tracked separately
- Single-element arrays are compacted to scalar values
- DNS components are excluded by default

## See Also

- [Power/Ground Stop Nets](../schemas/shared-types.md#powerground-stop-nets) - Which nets stop circuit traversal
- [AggregatedComponent Modes](../schemas/shared-types.md#single-vs-multiple-orientation-modes) - Single vs multiple orientation
- [Compact Array Behavior](../schemas/shared-types.md#compact-array-behavior) - How single-element arrays are compacted
- [DNS Detection](../schemas/shared-types.md#dns-detection) - How DNS components are identified
