# run_erc

Run electrical rule checks (ERC) on a design's netlist.

## Description

Evaluates deterministic connectivity rules over the parsed netlist and returns findings grouped by severity (`errors`, `warnings`) then rule id. Output is complete and never truncated.

Test points are identified by the `TP` reference-designator prefix. "Functional pins" are all non-test-point pins on a net.

| Rule | Severity | Fires when | Finding value |
|------|----------|-----------|---------------|
| `net.single_pin` | error | a net has exactly one functional pin and no test point | `REFDES.PIN` endpoints |
| `net.testpoint_orphan` | error | a net is touched only by test points (no functional pin) | `REFDES.PIN` endpoints |
| `net.testpoint_stub` | warning | a net has one functional pin plus one or more test points | `REFDES.PIN` endpoints |
| `net.unnamed` | warning | a net with 2+ functional pins carries an auto-generated name | bare net names |

`net.unnamed` only flags real multi-pin nets, so a single-pin auto-named net is reported once (as `net.single_pin`), not twice. The three degenerate rules are mutually exclusive by construction.

An auto-generated name is one the EDA tool derived from a pin rather than a label: Cadence `N123`, KiCad `Net-(D1-A)` and `unconnected-(J1-Pad3)`, Altium `Net<refdes>_<pin>` such as `NetR9_2` or `NetU9_A3` (the refdes part carries a number or a `?`, so a hand-written `NetCtrl_EN` is a named net).

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to design file, as returned by `list_designs` |
| `include_dns` | boolean | No | `false` | Include DNS (Do Not Stuff) components in the checks; by default a DNS part is treated as absent from the board and counted in `skipped.dns` |
| `include_rules` | string[] | No | all | Run only these rule ids (e.g. `["net.single_pin"]`) |
| `exclude_rules` | string[] | No | none | Skip these rule ids (applied after `include_rules`) |
| `design_variant` | string | Conditional | - | Design variant name from `list_designs`' `design_variants`, or `<Default>` (alias: `default`) for the unmodified/core design. Required when the design records named variants |

An unknown rule id in `include_rules` or `exclude_rules` returns an `ErrorResult` listing the valid ids, rather than silently checking nothing (which would look like a clean design). An empty `include_rules` array is likewise rejected: omit the field to run all rules.

## Response Schema

```json
{
  "design": "string",
  "design_variant": "string",
  "checked": ["string"],
  "skipped": { "dns": 0 },
  "errors": { "<rule_id>": { "<net>": ["REFDES.PIN"] } },
  "warnings": {
    "<rule_id>": { "<net>": ["REFDES.PIN"] },
    "net.unnamed": ["<net>"]
  }
}
```

- Severity is structural: a finding's bucket (`errors`/`warnings`) is its severity.
- Endpoint lists are always arrays, even for one element.
- `checked` lists the rules that ran. A rule in `checked` but absent from the findings fired nothing; a rule not in `checked` was not run.
- `design_variant` names the assembly that was checked: a native name or `<Default>`.
- `skipped` is always present. `skipped.dns` counts the DNS parts left out of the scan; it reads `0` when `include_dns` is `true` or when nothing was skipped, so a clean scan and a scan that never looked at DNS parts read differently.
- Empty buckets and empty rule groups are omitted.
- `net.unnamed`'s value is a bare array of net names (no endpoints).

## Example

Call:
```json
{
  "tool": "run_erc",
  "arguments": { "design": "PowerBoard/PowerBoard.kicad_pro" }
}
```

Response:
```json
{
  "design": "PowerBoard/PowerBoard.kicad_pro",
  "design_variant": "<Default>",
  "checked": ["net.single_pin", "net.testpoint_orphan", "net.testpoint_stub", "net.unnamed"],
  "skipped": { "dns": 7 },
  "errors": {
    "net.single_pin": { "GND_ISLAND": ["U7.3"] },
    "net.testpoint_orphan": { "VTEST_RAIL": ["TP1.1", "TP2.1"] }
  },
  "warnings": {
    "net.testpoint_stub": { "DDR_CLK": ["TP9.1", "U12.AB3"] },
    "net.unnamed": ["Net-(R5-Pad2)", "unconnected-(U9-IO14-Pad88)"]
  }
}
```

Clean design (every checked rule passed, nothing skipped):
```json
{
  "design": "PowerBoard/PowerBoard.kicad_pro",
  "design_variant": "<Default>",
  "checked": ["net.single_pin", "net.testpoint_orphan", "net.testpoint_stub", "net.unnamed"],
  "skipped": { "dns": 0 }
}
```

## Notes

- Endpoints use the `REFDES.PIN` form, the same spec `query_xnet_by_pin_name` accepts, so a finding's endpoint can be fed straight back into a query.
- Endpoint arrays are always arrays, even for a single endpoint, so the shape is uniform for every finding.
- Unconnected pins without a no-connect symbol are **not** checked: the parsers cannot reliably distinguish them from intentional no-connects (KiCad omits unconnected pins entirely; Altium normalizes both to `NC`).
- Test point detection is heuristic (the `TP` refdes prefix).
- `design_variant` selects the assembly to check. A design that records named variants requires it on every call; `<Default>` (alias `default`) selects the unmodified/core design. A part the selected variant marks Not Fitted is a DNS part for the run.

## See Also

- [query_xnet_by_pin_name](query_xnet_by_pin_name.md) - Trace connectivity from a `REFDES.PIN` endpoint
- [DNS Detection](../schemas/shared-types.md#dns-detection) - How DNS components are identified
