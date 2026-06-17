# Parser quality improvements (June 2026 stress-test findings)

## Context

On 2026-06-12 we ran a full-fixture stress test of the MCP server: 11 agents (one
per fixture), 19 designs, ~370 native tool calls against the local source via the
session MCP (`npx tsx src/index.ts`). Every fixture passed: no crashes, hangs,
malformed output, or unterminated traces, and DSN fallback results matched the
.dat output pin-for-pin wherever both formats exist (BeagleBoard-xM,
BeagleBone-Black, CutiePi, LAUNCHXL-CC1310, OSHW-Jetson J201).

The test surfaced 10 pre-existing quality gaps (none are regressions). This plan
turns them into actionable work, ordered by impact. Findings 1-4 change query
correctness; the rest are data fidelity and polish.

## Finding 1: Solder bridges (and jumpers) are not traversed as series elements

**Evidence:** nRF52840-DK: the SWDIO xnet stops at `SB54.1`; `U6.16` is
electrically on SWDIO through a closed solder bridge but never appears in the
trace. Resistors traverse fine. The board has dozens of `SBxx` parts, so
default-config connectivity is systematically hidden.

**Root cause:** traversal only walks through components whose refdes prefix is in
`PASSIVE_PREFIXES = {RS, R, FR, L, C, FB}` (`src/circuit-traversal.ts:37`, gate at
`src/circuit-traversal.ts:331`). `SB`, `JP`, `JMP` are not in the set.

**Refdes conventions for copper shorts / bridges / jumpers (researched 2026-06-12):**

| Prefix | Meaning | Source / status |
|---|---|---|
| `W` | Wire, cable, cable assembly; the standards-correct class for a wire link | IEEE 315 / ASME Y14.44 (verified via PCB Libraries forum) |
| `XW` | Copper short / etch short; composes per IEEE 315 as "X holder + W wire" (cf. XF fuse holder, XBT battery holder) | Big-tech internal convention (user-reported); composition verified on Wikipedia's designator table |
| `JP` | Jumper (link); not a standard class letter per IEEE 315 but ubiquitous | Wikipedia designator table |
| `JMP` | Jumper variant | Seen in Altium libraries (LimeSDR fixture has `JMP` prefix) |
| `SB` | Solder bridge | Vendor convention (Nordic dev kits; nRF52840-DK fixture) |
| `NT` | Net tie (copper-short footprint joining differing nets, usually BOM-excluded) | Altium whitepaper shows NT5-NT11; KiCad net-tie convention |
| `LK` | Link | Anecdotal (UK/AU designs); not verified, include only if seen in fixtures |
| `R` + 0R value | Zero-ohm resistor as short | Already traversed via `R` prefix |

**Fix (prefix set + pin-count guard, not a new regex):**

- Add `SB`, `JP`, `JMP`, `W`, `XW`, `NT` to `PASSIVE_PREFIXES`. The existing
  `getRefdesPrefix` mechanism already handles prefix extraction; no new regex
  needed.
- Altium only: net ties are identified by the component `Type` field
  ("Net Tie" / "Net Tie (In BOM)") in the source data, independent of refdes.
  If the SchDoc component records expose that kind field, prefer it over the
  prefix heuristic and mark such components traversable explicitly.
- Add a 2-pin guard to the traversal gate: only walk through a matched
  component if `Object.keys(comp.pins).length === 2`. This protects against
  3-pad select bridges (where shorting all pads would merge both mux
  alternatives into one xnet), multi-pin cable assemblies under the `W`
  prefix, and multi-pin star-point net ties; it also hardens existing
  behavior (a multi-pin part with an `R` prefix, e.g. a resistor pack,
  currently gets fully traversed).
- Document the assumption in the tool descriptions: the netlist does not carry
  open/closed state for bridges/jumpers, so traversal assumes the bridge is
  closed. The bridge itself appears in the trace (it already would), so a
  reviewer can see the assumption.
- `skip_types=['SB']` remains available per-query for callers who want the old
  behavior.

**Caveat to decide during implementation:** some boards use `SB` refdes for
default-OPEN bridges. Assuming closed creates false connectivity there. If that
proves to be a problem on real designs, fall back to an opt-in
`traverse_types` parameter instead of changing the default. The nRF52840-DK
fixture is the test bed either way.

**Tests:** `circuit-traversal.test.ts` cases for 2-pin SB traversal, 3-pad SB
non-traversal, multi-pin R-pack non-traversal. MCP verification: SWDIO xnet on
pca10056 must include U6.16 (interface MCU COM1).

## Finding 2: Altium DNS detection misses value-field markers ("DNP")

**Evidence:** LAUNCHXL-CC1310's embedded `temperatureSensor` Altium project: R1
has value "DNP" yet is returned with `include_dns=false` by search and xnet
tools. By contrast nRF52840 C22 ("N.C.", description "Not mounted") is
correctly flagged.

**Root cause:** `isDnsComponent` builds its haystack from `mpn`, `description`,
and `comment` only; it never looks at `value`
(`src/circuit-traversal.ts:64-72`). The Altium parser calls it with comment +
assembly-info (`src/parsers/altium/index.ts:355-367`), so a DNP that lives only
in the value field is invisible.

**Fix:** include `value` in the `isDnsComponent` haystack, but NOT with the full
`DNS_PATTERN`: the `NF` and `NC` tokens would false-positive on legitimate
values like `10 NF` or a part value of `NC` written with separators. For the
value field, match only the unambiguous markers
(`DNS|DNP|DNF|DNI|DNM`, plus exact-match `NC`/`N.C.` as the entire value).
Also verify why "N.C." currently passes: `DNS_PATTERN`'s `NC` token requires
contiguous letters, so C22 is likely caught by its "Not mounted" description,
meaning a bare "N.C." value with no description would be missed today too.

**Tests:** unit tests on `isDnsComponent` for value-only DNP, value "N.C.",
value "10 NF" (must NOT flag), value "100nF" (must NOT flag). MCP verification:
temperatureSensor R1 hidden by default, returned with `include_dns=true` and
`dns: true`.

## Finding 3: .dat designs keyed by file stem "pstxnet" instead of design name

**Evidence:** all 5 Cadence-DAT fixtures: search results and error messages say
design "pstxnet" while `list_designs` reports the real name (e.g.
`BEAGLEBONEBLK_C3`). LAUNCHXL (2 Cadence designs) and OSHW-Jetson (5) all
collide on the same `"pstxnet"` key, so any multi-design aggregation is
ambiguous. DSN-path queries use the real design name correctly.

**Root cause:** design name is derived as `path.basename(designPath, ext)`
(`src/parsers/cadence/discovery.ts:224` and `:409`), which for a
`pstxnet.dat` path yields `pstxnet`. `list_designs` separately resolves the
root drawing name (`src/parsers/cadence/discovery.ts:320`), so the two disagree.

**Fix:** centralize design-name resolution so the .dat load path reuses the same
logic `list_designs` uses (root drawing name, falling back to the containing
design directory name, never the netlist file stem). PR #62 (merged, v0.1.4)
extracted a `getDesignName` helper in exactly this area; build on it rather
than duplicating the logic.

**Tests:** result keys and error strings for a .dat design must match the
`list_designs` name; add a two-design-directory case asserting distinct keys.

## Finding 4: DSN component grouping collapses value/MPN variants

**Evidence:** OSHW-Jetson J201 via DSN: U58 (TXS0104EPWR) is displayed as
TXB0104PWR because its group's representative carries that MPN; 8 parts shown
as SN74LV1T125DBVR where 3 are actually 74LVC1G07GW. CutiePi via DSN: 63
resistors with different real values grouped under MPN "RES" showing one value
"10K". Totals and refdes sets are correct; per-member identity is wrong.

**Root cause (to confirm):** DSN-path grouping appears to group by library part
name and then emit a single representative MPN/value for the whole group
(`src/service/component-grouping.ts`), while the DAT path groups by composite
MPN which already encodes the value.

**Fix:** group DSN components by the (MPN, value) pair actually extracted per
instance, not by library part name alone; never print a representative value
that differs from a member's own value. If per-instance values are unavailable
for some parts, omit the value rather than showing a wrong one.

**Tests:** golden-based: `scripts/dsn-coverage-report.ts` should show no
MPN/value mismatches between group display and per-component queries for
OSHW-Jetson and CutiePi.

## Finding 5: Altium Cyrillic strings decoded as Latin-1 (mojibake)

**Evidence:** aberrant-sound-module: description "ËÈ1 4x2AND" (should be
"ЛИ1"), comment "ÊÐ1533ËÅ4" (should be "КР1533ЛЕ4").

**Root cause:** `src/parsers/altium/record-parser.ts:59-62` falls back from
UTF-8 to Latin-1 when replacement characters appear. Altium pre-Unicode string
records are encoded in the authoring system's ANSI codepage (CP1251 for
Cyrillic), not Latin-1.

**Fix:** Altium SchDoc records store a `%UTF8%`-prefixed duplicate parameter for
Unicode text in newer formats; prefer that when present. Otherwise detect the
codepage: SchDoc binary storage exposes the sheet's font/charset info, and
records may carry a charset byte. As a pragmatic fallback, run a cheap
heuristic (if Latin-1 output is dominated by `À-ÿ` letters, re-decode as
CP1251 via `TextDecoder('windows-1251')`). Keep pure: decode function takes
bytes + optional charset and returns string.

**Tests:** unit test with a CP1251-encoded byte sequence; fixture check that
DD-component comments on aberrant-sound-module render Cyrillic.

## Finding 6: Altium hidden power pins missing from query_component

**Evidence:** aberrant-sound-module U1 (LM358N, 8-pin) reports 6 pins; pins 4
(GND) and 8 (V+) are absent entirely. Also pins 1-3 lack names while 5-7 have
them (multi-section symbol; section A names lost).

**Root cause (to confirm):** hidden pins in SchDoc are pin records with the
hidden/`PINCONGLOMERATE` flag, likely filtered or not net-resolved by
`src/parsers/altium/record-parser.ts` / `connectivity.ts`. Hidden power pins
auto-connect to the net named in their default designator unless overridden.

**Fix:** parse hidden pins, emit them with their implicit power net (the pin's
hidden-net name), and resolve section A/B pin names for multi-part components.

**Tests:** U1 must report 8 pins with 4 -> GND-equivalent net and 8 -> +5;
regression check on nRF52840 (no double-counting of normal pins).

## Finding 7: Inconsistent pin shape in query_component output

**Evidence:** pins serialize as a bare net string when no pin name exists, and
as `{name, net}` when one does; both shapes can appear within one design
(CutiePi DAT vs DSN, LAUNCHXL). Consumers must branch on shape.

**Fix:** always emit `{name?, net}` objects (omit `name` when unknown), or keep
the string shape but document it in the tool descriptions. Pick one; the
object shape is the better contract but is a breaking change for downstream
agents (westworld), so coordinate and bump minor version. `getPinNet` in
`src/types.ts` already abstracts both shapes internally.

## Finding 8: "NC" pseudo-net inconsistencies

**Evidence:** Altium: pins report net "NC" but "NC" is absent from `list_nets`
and `query_xnet_by_net_name("NC")` errors. Cadence DAT: "NC" is a real
aggregated net (BeagleBoard-xM, BBB) that xnet tools will happily trace,
aliasing genuinely unconnected pins together. nRF52840 DD11 shows powered pins
on "NC", which can mislead a reviewer into thinking an IC is unpowered.

**Fix:** unify on a sentinel: report unconnected pins as `"NC"` consistently,
exclude "NC" from `list_nets`, and reject xnet queries on it with a clear
error ("NC aggregates unconnected pins and is not a real net"), matching the
existing ground-net rejection. For Cadence sources where NC arrives as a real
net, special-case the name at the service layer.

## Finding 9: Error-message polish

- Invalid directory path leaks `ENOENT: no such file or directory, scandir ...`
  instead of a guidance message pointing to `list_designs` (LimeSDR agent,
  reproduced twice).
- A directory path without extension yields `Unsupported design file format ''`
  with an empty placeholder (`src/service/load-netlist.ts:36`); name the path
  and say "directory given where a design file was expected".

## Finding 10: LimeSDR 1v4 description-search inconsistency

**Evidence:** 1v2/1v2s report "This netlist has no description data" while
1v4/1v4s report "No components matched pattern" for every pattern tried,
implying 1v4 has description fields that never match common terms. Determine
whether 1v4 descriptions exist but are unsearchable (encoding? field mapping?)
or whether the "has description data" detection misfires.

## Out of scope (covered by existing plans)

- Power-rail xnet verbosity / traversal walking through named rails like
  `MCU_3V3`: see [power-net-stop-pattern.md](./power-net-stop-pattern.md) and
  [xnet-depth-limit.md](./xnet-depth-limit.md). The stress test re-confirmed
  both (CutiePi SWDIO expanded through MCU_3V3; Altium-STM32 +3V3 pulled in the
  I2C bus).
- Graphical-only DNS annotations in Cadence DAT exports: known documented
  limitation (BeagleBoard-xM RP1/RP5, LAUNCHXL R13, OSHW-Jetson).

## Suggested order

1. Finding 3 (design-name keying) — small, builds on PR #62, fixes ambiguity
   that affects every multi-design directory.
2. Finding 2 (Altium DNP) — small pure-function change, closes a DNS hole.
3. Finding 1 (solder bridges) — high review-quality impact, needs the
   open/closed-assumption decision.
4. Finding 4 (DSN grouping) — correctness of displayed identity.
5. Findings 8, 9 (NC + errors) — service-layer polish.
6. Findings 5, 6 (Altium encoding + hidden pins) — parser work, larger.
7. Findings 7, 10 — contract decision and investigation respectively.

## Verification

- `npm run type-check && npm run lint && npm test` per item.
- Re-run the fixture stress test (one agent per fixture, native MCP calls)
  after the batch lands; each finding above lists its specific fixture +
  query reproduction.
