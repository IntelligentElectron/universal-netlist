# list_components

List components of a specific type in a design.

## Description

Lists the components whose reference designator prefix is exactly `type` (e.g., `U` for ICs, `R` for resistors). Components are grouped by MPN for compact output.

The prefix is matched whole, not as a leading substring: `U` returns `U1` and `U2` but **not** `USB1`, whose prefix is `USB`. A partial prefix therefore returns nothing rather than everything beneath it, so a part that seems to be missing is usually filed under a prefix of its own. The error for an unmatched type lists the prefixes the same query would return, and names apart any prefix whose components are all DNS (those need `include_dns: true`).

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to design file (e.g., `./Design.PrjPcb`) |
| `type` | string | Yes | - | Whole refdes prefix: `U`, `C`, `R`, `L`, `J`, `D`, `Q`, `TP`, `USB`, etc. |
| `include_dns` | boolean | No | `false` | Include DNS (Do Not Stuff) components |

## Response Schema

Returns an array of [`ComponentGroup`](../schemas/shared-types.md#componentgroup) objects, with a `notes` array when the list is empty because every component under the prefix is DNS:

```json
{
  "components": [ComponentGroup, ...],
  "notes": ["string"]
}
```

## Example

**Listing ICs in a design:**

Call:
```json
{
  "tool": "list_components",
  "arguments": {
    "design": "PowerBoard/PowerBoard.PrjPcb",
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
      "internal_pn": "INT-1002",
      "description": "IC REG BUCK ADJ 750MA 8WSON",
      "count": 2,
      "refdes": ["U1", "U2"]
    },
    {
      "mpn": "STM32F401CCU6",
      "description": "IC MCU 32BIT 256KB FLASH 48UFQFPN",
      "count": 1,
      "refdes": ["U5"]
    },
    {
      "description": "IC GENERIC",
      "count": 1,
      "refdes": ["U3"],
      "notes": ["MPN not found in exported netlist data. Tell user to update symbol properties in library, or to point you to the BOM"]
    }
  ]
}
```

**Error (invalid prefix):**
```json
{
  "error": "No components with prefix 'X' found in design 'PowerBoard'. Available prefixes: [C, D, FB, J, L, Q, R, RS, U] Prefixes whose components are all DNS, listed only with include_dns=true: [TP]"
}
```

**Every component under the prefix is DNS:**
```json
{
  "components": [],
  "notes": ["All 7 components with prefix 'TP' in design 'PowerBoard' are DNS (Do Not Stuff) and were left out. Pass include_dns=true to list them."]
}
```

## Notes

- The `type` parameter is case-insensitive (`u` and `U` both work)
- `type` matches the whole prefix, so `U` does not return `USB1`, and `TP` returns the test points. Query each prefix you need, or read the list the unmatched-type error gives you
- Components are grouped by MPN; components without MPN are listed individually
- Components without MPN include a `notes` field suggesting next steps
- Use `include_dns: true` to see DNS components (marked with `dns: true`). A prefix whose components are all DNS returns an empty list with a `notes` entry saying so, and the unmatched-type error lists such prefixes apart from the ones the query would return

## See Also

- [DNS Detection](../schemas/shared-types.md#dns-detection) - How DNS components are identified
- [Notes Array](../schemas/shared-types.md#notes-array) - Meaning of notes field values
