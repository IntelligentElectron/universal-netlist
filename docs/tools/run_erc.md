# run_erc

Run electrical rule checks (ERC) on a design's netlist.

## Description

Evaluates deterministic connectivity rules over the parsed netlist and returns findings grouped by severity (`errors`, `warnings`) then rule id. Findings are paged across every rule, errors first: `max_results` findings (default 50) from `offset`, with `next_offset` set while more remain and a note saying which findings the page holds. `totals` gives every rule's finding count on each page, so a rule whose findings fall on a later page is still visible on the first. `checked` lists every rule that ran.

Test points are identified by the `TP` reference-designator prefix. "Functional pins" are all non-test-point pins on a net.

| Rule | Severity | Fires when | Finding value |
|------|----------|-----------|---------------|
| `net.single_pin` | error | a net has exactly one functional pin and no test point | `REFDES.PIN` endpoints |
| `net.testpoint_orphan` | error | a net is touched only by test points (no functional pin) | `REFDES.PIN` endpoints |
| `net.testpoint_stub` | warning | a net has one functional pin plus one or more test points | `REFDES.PIN` endpoints |
| `net.whitespace_in_name` | warning | a net's name has leading or trailing whitespace | `REFDES.PIN` endpoints |
| `net.whitespace_name_collision` | error | two or more nets have names that read the same once leading and trailing whitespace is trimmed | `REFDES.PIN` endpoints, one entry per net |
| `net.unnamed` | warning | a net with 2+ functional pins carries an auto-generated name | bare net names |
| `refdes.duplicate` | error | the schematic gives one reference designator to several different parts | keyed by the refdes: `{ "part_count": 2, "pages": ["07_CLOCKS", "11_BUTTONS"] }` |
| `pin.output_conflict` | error | pins that drive the net short each other: two or more outputs, an output beside a supply output or an open collector or emitter, two or more supply outputs, or a supply output beside an open collector or emitter | the driving pins' `REFDES.PIN` endpoints |
| `pin.output_contention` | warning | a possible fight: a bidirectional or three-state pin on a net an output or supply drives, or an output or open collector or emitter on an undirected power pin | the driving pins' `REFDES.PIN` endpoints |
| `pin.input_undriven` | error | a net has input or supply-input pins and no pin that can drive it | the input pins' `REFDES.PIN` endpoints |
| `pin.power_unconnected` | error | a supply input (`power_in`) is the only functional pin on its net, or is unconnected | the supply pins' `REFDES.PIN` endpoints; unconnected ones under `NC` |
| `pin.power_undirected_unconnected` | warning | an undirected `power` pin is the only functional pin on its net, or is unconnected: an unpowered supply input, or an unused supply output | the power pins' `REFDES.PIN` endpoints; unconnected ones under `NC` |
| `capture.erc_error` | error | Capture's own design rules check left an `ERROR(...)` marker on a page, still there when the file was saved (Cadence designs only) | keyed by the page, as `list_pages` names it: `[{ "message": "ERROR(ORCAP-1628): Possible pin type conflict", "detail": "U252,OUT Output Connected to Output", "location": "", "x": 10250, "y": 8200 }]`, positions in mils as `get_page` gives them |
| `capture.erc_warning` | warning | the same for any other marker, such as `WARNING(ORCAP-1600): Net has fewer than two connections` | keyed by the page, as for `capture.erc_error` |
| `refdes.section_repeated` | error | one part draws the same section more than once, with no pin wired to two different nets | keyed by the refdes: `[{ "section": "F", "placements": 2, "pages": ["15_POWER", "18_DISPLAY"] }]`; `section` is omitted for a part with one section |

The five `pin.*` rules read each pin's electrical `type` (see [query_component](query_component.md)) and are the same for every format; the golden tables in [docs/decision-tables/pin-erc](../decision-tables/pin-erc/net.rules.md) define them cell by cell. Pins are grouped by what they can do to a net:

- **drive and fight:** `output` (push-pull), `power_out` (a supply output) and `power` (an undirected supply pin: a supply input or output whose direction and polarity are not recorded);
- **pull one way:** `open_collector`, `open_emitter`;
- **drive at times:** `bidirectional`, `tristate`;
- **may drive, direction unknown:** `passive`, `unspecified`, `free`, and a pin with no `type`;
- **load only:** `input`, `power_in`;
- **neither:** `no_connect`.

A pin whose direction is unknown never makes an error: an undirected `power` pin makes at most a warning, and a pin with no type never makes a conflict, and since it may drive, it keeps a net from being reported as undriven. A design whose pins carry no type gets no `pin.*` findings. Test points neither drive nor load a net for these rules, and DNS parts are absent unless `include_dns` is set, so an input whose only pull-up is DNS is undriven. A conflict or contention names the driving pins, leaving out `power` pins (the net is a rail). A `power_in` pin alone on its net is reported by `net.single_pin`, `pin.input_undriven` and `pin.power_unconnected`: one pin, no driver, and an unpowered part.

The two `capture.*` rules relay what Capture's own design rules check found and left on the pages; they read nothing of the netlist, find nothing in a KiCad, Altium or Universal Netlist design, and do not depend on `include_dns` or the design variant. A schematic that several blocks place stores its markers once, and they are reported once, under the first placement's page name. Each marker counts as one finding for paging and `totals`.

`net.unnamed` only flags real multi-pin nets, so a single-pin auto-named net is reported once (as `net.single_pin`), not twice. The three degenerate rules are mutually exclusive by construction.

The two whitespace rules check net names, independently of the connectivity rules. Capture keeps leading and trailing whitespace as part of a net name, so `"SIGNAL_A "` names its own net, and the Allegro netlister trims it on export to `SIGNAL_A`. `net.whitespace_in_name` lists every such net: its name differs between the schematic and the board, so an exact lookup, a mating board, or the design's own export spells it differently. `net.whitespace_name_collision` lists nets such as `" SIGNAL_A"` and `SIGNAL_A` that are separate nets drawn with what reads as the same name: an open on the schematic, and two nets the netlister renames apart on export (warning `ORCAP-36005`). A padded net in a collision appears under both rules. Inside a Cadence hierarchical block, a padded label puts its whitespace ahead of the placement suffix, as in `"SIG _U1"`, and a KiCad sub-sheet label puts it after the sheet path, as in `/Sheet/ SIG`; both rules cover those forms too. The Allegro behavior applies to Cadence designs; for other formats the rules flag the same names as label typos. Spaces inside a name, such as `MAIN PWR_EN`, are written unchanged and are not flagged. Each padded net's `net_name_warnings` entry in the query tools names the objects that carry the text (see [shared types](../schemas/shared-types.md#net-name-warnings)).

An auto-generated name is one the EDA tool derived from a pin rather than a label: Cadence `N123`, KiCad `Net-(D1-A)` and `unconnected-(J1-Pad3)`, Altium `Net<refdes>_<pin>` such as `NetR9_2` or `NetU9_A3` (the refdes part carries a number or a `?`, so a hand-written `NetCtrl_EN` is a named net).

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to design file, as returned by `list_designs` |
| `include_dns` | boolean | No | `false` | Include DNS (Do Not Stuff) components in the checks; by default a DNS part is treated as absent from the board and counted in `skipped.dns` |
| `include_rules` | string[] | No | all | Run only these rule ids (e.g. `["net.single_pin"]`) |
| `exclude_rules` | string[] | No | none | Skip these rule ids (applied after `include_rules`) |
| `design_variant` | string | Conditional | - | Design variant name from `list_designs`' `design_variants`. Required when the design records named variants, which are its only builds. `<Default>` (alias: `default`) is the one build of a design that records none |
| `max_results` | integer | No | 50 | Max `findings` entries to return |
| `offset` | integer | No | 0 | Index of the first `findings` entry to return, from `next_offset` |

`findings` is paged. When a page does not hold every entry, `notes` says which entries it holds, and `next_offset` is the offset of the next page while more remain.

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
  "checked": ["net.single_pin", "net.testpoint_orphan", "net.testpoint_stub", "net.whitespace_in_name", "net.whitespace_name_collision", "refdes.duplicate", "refdes.section_repeated", "pin.output_conflict", "pin.output_contention", "pin.input_undriven", "pin.power_unconnected", "pin.power_undirected_unconnected", "capture.erc_error", "capture.erc_warning", "net.unnamed"],
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
  "checked": ["net.single_pin", "net.testpoint_orphan", "net.testpoint_stub", "net.whitespace_in_name", "net.whitespace_name_collision", "refdes.duplicate", "refdes.section_repeated", "pin.output_conflict", "pin.output_contention", "pin.input_undriven", "pin.power_unconnected", "pin.power_undirected_unconnected", "capture.erc_error", "capture.erc_warning", "net.unnamed"],
  "skipped": { "dns": 0 }
}
```

## Notes

- Endpoints use the `REFDES.PIN` form, the same spec `query_xnet_by_pin_name` accepts, so a finding's endpoint can be fed straight back into a query.
- Endpoint arrays are always arrays, even for a single endpoint, so the shape is uniform for every finding.
- Pins on `NC` are not checked, except by `pin.power_unconnected`, which reports a supply input there. `NC` is the net of a pin the design leaves unconnected, as `query_component` shows it, and it joins no net the rules scan. A KiCad pin reads as `NC` when it is alone on a no-connect flag, or alone on its net with electrical type `no_connect`: an engineer-drawn no-connect is never a `net.single_pin` error. A KiCad pin left open with no flag stays a one-pin net such as `unconnected-(R2-Pad1)`, and `net.single_pin` reports it, as KiCad's own ERC does. Cadence and Altium designs read an open pin as `NC` whether or not a no-connect symbol marks it, so an open pin there is not reported.
- Test point detection is heuristic (the `TP` refdes prefix).
- `design_variant` selects the assembly to check. A design that records named variants requires it on every call; those variants are its only builds and `<Default>` is refused on it. `<Default>` (alias `default`) is the one build of a design that records no variant, the design with every part's own Do Not Stuff state. A part the selected variant marks Not Fitted is a DNS part for the run.

## See Also

- [query_xnet_by_pin_name](query_xnet_by_pin_name.md) - Trace connectivity from a `REFDES.PIN` endpoint
- [DNS Detection](../schemas/shared-types.md#dns-detection) - How DNS components are identified
