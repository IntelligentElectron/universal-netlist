# list_variants

List the assembly variants recorded by a design.

## Description

Returns `<Default>` plus every native named variant. `<Default>` means the
unmodified/core design. Altium names come from `ProjectVariantN` sections in the
`.PrjPcb`, Cadence names come from the CIS BOM variant store in the `.DSN`, and
KiCad names come from instance variant blocks across the schematic hierarchy.

When this tool returns one or more native names, every tool that loads the design
requires a `variant` argument. Pass a native name to query that assembly, or pass
`<Default>` explicitly to query the core design. Matching is case-insensitive,
but responses and diagnostics preserve the native spelling. Omitting the selector
or passing an unknown name returns an error rather than silently guessing an
assembly.

For KiCad, listing names reads the schematic files directly. Querying a named
variant invokes `kicad-cli --variant`, even when a committed base `.net` export
exists, and therefore requires a KiCad version that supports variants.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to design file, as returned by `list_designs` |

## Response Schema

```json
{
  "variants": [
    {
      "name": "<Default>",
      "description": "Unmodified/core design",
      "is_default": true
    },
    {
      "name": "Production"
    }
  ]
}
```

`<Default>` is always the first result. Designs without native variants return
only that entry.

## Example

Call:

```json
{
  "tool": "list_variants",
  "arguments": {
    "design": "BSPD_002/BSPD_002.PrjPcb"
  }
}
```

Response:

```json
{
  "variants": [
    {
      "name": "<Default>",
      "description": "Unmodified/core design",
      "is_default": true
    },
    {
      "name": "BSPD-DNP"
    }
  ]
}
```
