# list_components

List components of a specific type in a design.

## Description

Lists the components whose reference designator prefix is exactly `type` (e.g., `U` for ICs, `R` for resistors). Components are grouped by MPN for compact output. DNS (Do Not Stuff) parts are listed and flagged `dns: true`; pass `include_dns: false` to hide them. Every result names the `design_variant` it describes, and a part the selected variant substitutes for the base one is flagged `alternate_part: true`.

The prefix is matched whole, not as a leading substring: `U` returns `U1` and `U2` but **not** `USB1`, whose prefix is `USB`. A partial prefix therefore returns nothing rather than everything beneath it, so a part that seems to be missing is usually filed under a prefix of its own. The error for an unmatched type lists the prefixes the same query would return; with `include_dns: false` it names apart any prefix whose components are all DNS.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to design file (e.g., `./Design.PrjPcb`) |
| `type` | string | Yes | - | Whole refdes prefix: `U`, `C`, `R`, `L`, `J`, `D`, `Q`, `TP`, `USB`, etc. |
| `include_dns` | boolean | No | `true` | Include DNS (Do Not Stuff) components, flagged `dns: true`; pass `false` to list only fitted parts |
| `design_variant` | string | Conditional | - | Design variant name from `list_designs`' `design_variants`. Required when the design records named variants, which are its only builds. `<Default>` (alias: `default`) is the one build of a design that records none |

## Response Schema

Returns the design variant the result describes and an array of [`ComponentGroup`](../schemas/shared-types.md#componentgroup) objects, with a `notes` array when the list is empty because every component under the prefix is DNS and `include_dns` is `false`:

```json
{
  "design_variant": "<Default>",       // The variant described: a native name or <Default>
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
  "design_variant": "<Default>",
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

**Listing resistors in a named design variant, one of them an alternate part:**

Call:
```json
{
  "tool": "list_components",
  "arguments": {
    "design": "PowerBoard/PowerBoard.PrjPcb",
    "type": "R",
    "design_variant": "Production"
  }
}
```

Response:
```json
{
  "design_variant": "Production",
  "components": [
    {
      "mpn": "CRG0805F12K",
      "manufacturer": "TE Connectivity",
      "description": "RES 12K OHM 1% 0805",
      "value": "12k",
      "count": 1,
      "refdes": ["R94"],
      "alternate_part": true
    },
    {
      "mpn": "RC0402FR-071KL",
      "description": "RES 1K OHM 1% 1/16W 0402",
      "value": "1k",
      "count": 3,
      "refdes": ["R1", "R2", "R3"]
    },
    {
      "mpn": "RC0402FR-070RL",
      "description": "RES 0 OHM JUMPER 0402",
      "value": "0R",
      "count": 1,
      "refdes": ["R23"],
      "dns": true
    }
  ]
}
```

**Error (invalid prefix, with `include_dns: false`):**
```json
{
  "error": "No components with prefix 'X' found in design 'PowerBoard'. Available prefixes: [C, D, FB, J, L, Q, R, RS, U] Prefixes whose components are all DNS, listed only with include_dns=true: [TP]"
}
```

**Every component under the prefix is DNS (with `include_dns: false`):**
```json
{
  "design_variant": "<Default>",
  "components": [],
  "notes": ["All 7 components with prefix 'TP' in design 'PowerBoard' are DNS (Do Not Stuff) and were left out. Pass include_dns=true to list them."]
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
  "error": "Design variant 'Production' not found for design 'BSPD_002.PrjPcb'. Available: ['BSPD-DNP', '<Default>']."
}
```

## Notes

- The `type` parameter is case-insensitive (`u` and `U` both work)
- `type` matches the whole prefix, so `U` does not return `USB1`, and `TP` returns the test points. Query each prefix you need, or read the list the unmatched-type error gives you
- Components are grouped by MPN; components without MPN are listed individually
- Components without MPN include a `notes` field suggesting next steps
- DNS components are listed by default and marked `dns: true`. With `include_dns: false` they are hidden: a prefix whose components are all DNS then returns an empty list with a `notes` entry saying so, and the unmatched-type error lists such prefixes apart from the ones the query would return
- `design_variant` names the assembly the result describes. A design that records named variants requires it on every call; those variants are its only builds and `<Default>` is refused on it. `<Default>` (alias `default`) is the one build of a design that records no variant, the design with every part's own Do Not Stuff state, and names match case-insensitively
- `alternate_part: true` marks a group whose part the selected design variant substitutes for the base one. The group's `value`, `mpn`, `manufacturer`, and `description` describe the part as built for that variant

## See Also

- [Design Variants](../schemas/shared-types.md#design-variants) - Selecting one assembly, and the `alternate_part` flag
- [DNS Detection](../schemas/shared-types.md#dns-detection) - How DNS components are identified
- [Notes Array](../schemas/shared-types.md#notes-array) - Meaning of notes field values
