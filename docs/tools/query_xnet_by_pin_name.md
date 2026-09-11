# query_xnet_by_pin_name

Get full XNET connectivity starting from a component pin.

## Description

Traces circuit connectivity starting from a specific component pin, traversing through series components. Returns the connected net and all reachable components. Useful for tracing from IC pins outward.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to design file |
| `pin_name` | string | Yes | - | Pin spec in `REFDES.PIN` format (e.g., `U2.10`, `U1.A5`) |
| `skip_types` | string[] | No | `[]` | Component prefixes to exclude |
| `include_dns` | boolean | No | `false` | Include DNS components in the traversal; by default a DNS part is treated as absent from the board |
| `design_variant` | string | Conditional | - | Design variant name from `list_designs`' `design_variants`, or `<Default>` (alias: `default`) for the unmodified/core design. Required when the design records named variants |

## Response Schema

Returns circuit traversal results starting from a pin. See [`AggregatedComponent`](../schemas/shared-types.md#aggregatedcomponent) for the component schema:

```json
{
  "design_variant": "<Default>",        // The variant described: a native name or <Default>
  "starting_point": "REFDES.PIN",       // Pin in REFDES.PIN format
  "net": "string",                      // Connected net name
  "total_components": 0,
  "unique_configurations": 0,
  "components_by_mpn": [AggregatedComponent, ...],
  "visited_nets": ["net1", "net2"],
  "circuit_hash": "string",
  "skipped": { "C": 5, "L": 2 }         // Optional
}
```

**Related types:**
- [`AggregatedComponent`](../schemas/shared-types.md#aggregatedcomponent) - Component grouping with orientation tracking; a group the selected design variant substitutes carries `alternate_part: true`
- [`PinNetConnection`](../schemas/shared-types.md#pinnetconnection) - Pin-to-net mappings
- [`OrientationVariant`](../schemas/shared-types.md#orientationvariant) - Different wiring patterns

## Example

**Tracing from an MCU pin:**

Call:
```json
{
  "tool": "query_xnet_by_pin_name",
  "arguments": {
    "design": "PowerBoard/PowerBoard.PrjPcb",
    "pin_name": "U5.PA9"
  }
}
```

Response:
```json
{
  "design_variant": "<Default>",
  "starting_point": "U5.PA9",
  "net": "UART_TX",
  "total_components": 2,
  "unique_configurations": 2,
  "components_by_mpn": [
    {
      "mpn": "RC0402FR-0722RL",
      "description": "RES 22 OHM 1% 0402",
      "value": "22R",
      "total_count": 1,
      "refdes": ["R15"],
      "connections": [
        { "net": "UART_TX", "pins": ["1"] },
        { "net": "UART_TX_TERM", "pins": ["2"] }
      ]
    },
    {
      "mpn": "TPD2EUSB30DRTR",
      "description": "IC ESD PROT 2CH SOT-563",
      "total_count": 1,
      "refdes": ["D3"],
      "connections": [
        { "net": "UART_TX_TERM", "pins": ["1"] },
        { "net": "GND", "pins": ["2", "4"] }
      ]
    }
  ],
  "visited_nets": ["UART_TX", "UART_TX_TERM", "GND"],
  "circuit_hash": "c8d9e0f1"
}
```

**No Connect pin:**
```json
{
  "design_variant": "<Default>",
  "starting_point": "U1.7",
  "net": "NC",
  "total_components": 0,
  "unique_configurations": 0,
  "components_by_mpn": [],
  "visited_nets": ["NC"],
  "circuit_hash": "nc-U1.7"
}
```

**Error (component not found):**
```json
{
  "error": "Component 'U99' not found in design 'PowerBoard'. Use list_components() or search_components_by_refdes() to find available components."
}
```

**Error (pin not found):**
```json
{
  "error": "Pin 'U1.99' not found. Component U1 has pins: [1, 2, 3, 4, 5, 6, 7, 8]"
}
```

**Error (invalid format):**
```json
{
  "error": "Invalid pin name 'U1-5'. Expected 'REFDES.PIN'."
}
```

**Error (pin connected to ground):**
```json
{
  "error": "Pin C1.2 is connected to GND (ground) and cannot be queried."
}
```

Ground nets return massive results that are not useful, so pins connected to them are blocked. See [Power/Ground Stop Nets](../schemas/shared-types.md#powerground-stop-nets) for the full list.

## Pin Name Format

The `pin_name` parameter uses `REFDES.PIN` format:

| Example | Description |
|---------|-------------|
| `U1.5` | IC U1, pin 5 |
| `U2.A1` | IC U2, BGA pin A1 |
| `R10.1` | Resistor R10, pin 1 |
| `J1.3` | Connector J1, pin 3 |

## Comparison with query_xnet_by_net_name

| Aspect | query_xnet_by_pin_name | query_xnet_by_net_name |
|--------|------------------------|------------------------|
| Starting point | Component pin | Net name |
| Response includes | `net` field with connected net | No `net` field |
| Use case | Trace from IC outward | Trace a known signal |

## Notes

- Pin lookup is **case-insensitive** (`u1.a5` matches `U1.A5`)
- The `net` field shows what net the pin connects to
- NC (No Connect) pins return an empty circuit with `circuit_hash: "nc-REFDES.PIN"`
- Same traversal rules as `query_xnet_by_net_name`, including DNS handling: a DNS part is treated as absent from the board unless `include_dns: true`
- `design_variant` names the assembly the result describes. A design that records named variants requires it on every call; `<Default>` (alias `default`) selects the unmodified/core design
- A component group the selected design variant substitutes for the base part carries `alternate_part: true`

## See Also

- [Power/Ground Stop Nets](../schemas/shared-types.md#powerground-stop-nets) - Which nets stop circuit traversal
- [AggregatedComponent Modes](../schemas/shared-types.md#single-vs-multiple-orientation-modes) - Single vs multiple orientation
