# search_components_by_mpn

Search for components by Manufacturer Part Number (MPN) pattern.

## Description

Searches components using a regex pattern against part numbers. Useful for finding all instances of a specific part or part family.

Both part numbers are searched: `mpn`, the manufacturer's, and `internal_pn`,
the number the design owner identifies the part by. They are different
namespaces, and a caller holding one of them has no way to know which, so
matching only `mpn` would answer "no such part" to a correct internal number.
A group is returned once however many of its numbers matched.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | Yes | - | Regex pattern for either part number (case-insensitive) |
| `design` | string | Yes | - | Path to design file |
| `include_dns` | boolean | No | `true` | Include DNS components, flagged `dns: true`; pass `false` for fitted parts only |
| `design_variant` | string | Conditional | - | Design variant name from `list_designs`' `design_variants`, or `<Default>` (alias: `default`) for the unmodified/core design. Required when the design records named variants |

## Response Schema

Returns the design variant the result describes and results keyed by design name, each containing an array of [`ComponentGroup`](../schemas/shared-types.md#componentgroup) objects:

```json
{
  "design_variant": "<Default>",       // The variant described: a native name or <Default>
  "results": {
    "DesignName": [ComponentGroup, ...]
  },
  "notes": ["..."]  // Present when no matches or no MPN data
}
```

## Example

**Searching for TPS buck regulators:**

Call:
```json
{
  "tool": "search_components_by_mpn",
  "arguments": {
    "pattern": "TPS62",
    "design": "PowerBoard/PowerBoard.PrjPcb"
  }
}
```

Response:
```json
{
  "design_variant": "<Default>",
  "results": {
    "PowerBoard": [
      {
        "mpn": "TPS62840DLCR",
        "internal_pn": "INT-1002",
        "description": "IC REG BUCK ADJ 750MA 8WSON",
        "count": 2,
        "refdes": ["U1", "U5"]
      },
      {
        "mpn": "TPS62088YFPR",
        "description": "IC REG BUCK ADJ 2A 12DSBGA",
        "count": 1,
        "refdes": ["U3"]
      }
    ]
  }
}
```

**No MPN data in design:**
```json
{
  "design_variant": "<Default>",
  "results": {
    "OldDesign": []
  },
  "notes": ["This netlist has no MPN data. Ask user for BOM or schematic PDF"]
}
```

**No matches:**
```json
{
  "design_variant": "<Default>",
  "results": {
    "PowerBoard": []
  },
  "notes": ["No components matched pattern 'STM32.*'. Try a broader pattern or use search_components_by_refdes instead"]
}
```

**Error (invalid regex):**
```json
{
  "error": "Invalid regex pattern '(?invalid)'"
}
```

## Example Patterns

| Pattern | Matches |
|---------|---------|
| `TPS62` | All TPS62xxx buck regulators |
| `^RC0402` | 0402 resistors starting with RC |
| `DLCR$` | Parts ending in DLCR package code |
| `LDO\|REG` | LDO or regulator parts |
| `.*BUCK.*` | Any part with "BUCK" in the MPN |

## Notes

- Pattern matching is **case-insensitive**
- Inline flags like `(?i)` are accepted (matching is already case-insensitive by default)
- Only searches components that have at least one part number
- If a design has no part-number data at all, `notes` will suggest asking for a BOM
- Components without any part number cannot be found with this tool; use `search_components_by_refdes` instead
- Each field is omitted when the design records nothing for it, so a design that
  carries only one of the two is matched on that one
- DNS components are included by default and flagged `dns: true`; pass `include_dns: false` for fitted parts only
- `design_variant` names the assembly the result describes. A design that records named variants requires it on every call; `<Default>` (alias `default`) selects the unmodified/core design
- `alternate_part: true` marks a group whose part the selected design variant substitutes for the base one; its `value`, `mpn`, `manufacturer`, and `description` describe the part as built for that variant. The `mpn` searched is the substituted part's, so a variant's alternate part is found by its own number
