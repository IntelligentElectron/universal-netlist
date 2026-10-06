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
| `net.whitespace_in_name` | warning | a net's name has leading or trailing whitespace | `REFDES.PIN` endpoints |
| `net.whitespace_name_collision` | error | two or more nets have names that read the same once leading and trailing whitespace is trimmed | `REFDES.PIN` endpoints, one entry per net |
| `net.unnamed` | warning | a net with 2+ functional pins carries an auto-generated name | bare net names |

`net.unnamed` only flags real multi-pin nets, so a single-pin auto-named net is reported once (as `net.single_pin`), not twice. The three degenerate rules are mutually exclusive by construction.

The two whitespace rules check net names, independently of the connectivity rules. Capture keeps leading and trailing whitespace as part of a net name, so `"SIGNAL_A "` names its own net, and the Allegro netlister trims it on export to `SIGNAL_A`. `net.whitespace_in_name` lists every such net: its name differs between the schematic and the board, so an exact lookup, a mating board, or the design's own export spells it differently. `net.whitespace_name_collision` lists nets such as `" SIGNAL_A"` and `SIGNAL_A` that are separate nets drawn with what reads as the same name: an open on the schematic, and two nets the netlister renames apart on export (warning `ORCAP-36005`). A padded net in a collision appears under both rules. Spaces inside a name, such as `TYPE C_USB_DP`, are written unchanged and are not flagged. Each padded net's `net_name_warnings` entry in the query tools names the objects that carry the text (see [shared types](../schemas/shared-types.md#net-name-warnings)).

An auto-generated name is one the EDA tool derived from a pin rather than a label: Cadence `N123`, KiCad `Net-(D1-A)` and `unconnected-(J1-Pad3)`, Altium `Net<refdes>_<pin>` such as `NetR9_2` or `NetU9_A3` (the refdes part carries a number or a `?`, so a hand-written `NetCtrl_EN` is a named net).

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to design file, as returned by `list_designs` |
| `include_dns` | boolean | No | `false` | Include DNS (Do Not Stuff) components in the checks; by default a DNS part is treated as absent from the board and counted in `skipped.dns` |
| `include_rules` | string[] | No | all | Run only these rule ids (e.g. `["net.single_pin"]`) |
| `exclude_rules` | string[] | No | none | Skip these rule ids (applied after `include_rules`) |
| `design_variant` | string | Conditional | - | Design variant name from `list_designs`' `design_variants`. Required when the design records named variants, which are its only builds. `<Default>` (alias: `default`) is the one build of a design that records none |

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
  "checked": ["net.single_pin", "net.testpoint_orphan", "net.testpoint_stub", "net.whitespace_in_name", "net.whitespace_name_collision", "net.unnamed"],
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
  "checked": ["net.single_pin", "net.testpoint_orphan", "net.testpoint_stub", "net.whitespace_in_name", "net.whitespace_name_collision", "net.unnamed"],
  "skipped": { "dns": 0 }
}
```

## Notes

- Endpoints use the `REFDES.PIN` form, the same spec `query_xnet_by_pin_name` accepts, so a finding's endpoint can be fed straight back into a query.
- Endpoint arrays are always arrays, even for a single endpoint, so the shape is uniform for every finding.
- Unconnected pins without a no-connect symbol are **not** checked: the parsers cannot reliably distinguish them from intentional no-connects (KiCad omits unconnected pins entirely; Altium normalizes both to `NC`).
- Test point detection is heuristic (the `TP` refdes prefix).
- `design_variant` selects the assembly to check. A design that records named variants requires it on every call; those variants are its only builds and `<Default>` is refused on it. `<Default>` (alias `default`) is the one build of a design that records no variant, the design with every part's own Do Not Stuff state. A part the selected variant marks Not Fitted is a DNS part for the run.

## See Also

- [query_xnet_by_pin_name](query_xnet_by_pin_name.md) - Trace connectivity from a `REFDES.PIN` endpoint
- [DNS Detection](../schemas/shared-types.md#dns-detection) - How DNS components are identified
