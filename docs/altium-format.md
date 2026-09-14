# Altium Designer Schematic Format

Reference for the parts of the `.SchDoc` / `.PrjPcb` format that carry enough hidden
structure to be worth writing down: design variants, multi-channel sheet repetition,
and signal harnesses.
The record model behind everything else is straightforward enough to read off
`src/parsers/altium/`. Companion to [`dsn-format.md`](dsn-format.md), which covers Cadence.

A `.SchDoc` is an OLE compound document. Its `FileHeader` stream holds pipe-delimited
key-value records, one per object:

```
|RECORD=27|OWNERINDEX=12|LOCATION.X=410|LOCATION.Y=670|...
```

Records are single-byte Windows-1252 in older files and UTF-8 in newer ones. The parser
decodes each segment as UTF-8 and falls back to Latin-1 when that yields replacement
characters. Key casing varies between files, so lookups accept both `Location.X` and
`LOCATION.X`.

Signal harness objects (records 215–218) are written to a second stream, `Additional`, in the
same record encoding. The stream is optional and often absent: 101 of the 131 `.SchDoc` files
in `test/fixtures/altium/` have it, and the 30 that do not are all LimeSDR-USB ASCII exports.
Where it exists on a sheet that uses no harnesses it is 75 bytes carrying no records, which is
53 of those 101. So `readSchematicRecords()` reads it through `readOptionalOleStream()` and
returns the `FileHeader` records unchanged when it is missing or empty. Reading `FileHeader`
alone yields a document with no harness objects in it at all.

Because the records are plain text inside the binary container, `grep -a` works directly on
a `.SchDoc` and is the fastest way to survey a design, across both streams at once:

```bash
LC_ALL=C grep -aoE "RECORD=[0-9]+" file.SchDoc | sort -t= -k2 -n | uniq -c
```

The `-t= -k2` matters. A plain `sort -n` sees each line starting with `RECORD`, finds no
leading number, and falls back to lexicographic order, interleaving `RECORD=2` between
`RECORD=18` and `RECORD=209`.

Record type numbers are listed in `src/parsers/altium/types.ts`.

### Coordinates

A coordinate or size is a whole number of units (1 unit = 10 mil) plus an optional `_Frac` field
in hundred-thousandths of a unit: `Width=44 | Width_Frac=35626` is 44.35626. Locations
(`Location.X_Frac`), polyline vertices (`X1_Frac`) and sizes (`Width_Frac`, `XSize_Frac`,
`PinLength_Frac`, `PrimaryConnectionPosition_Frac`) all carry one. `DistanceFromTop_Frac1` is the
exception: millionths of a 10-unit step.

## Design variants

**Confidence: VERIFIED.** Implemented and tested against `qfsae-bspd-variant` (Not
Fitted rows) and the ohwr `Pico-4CH` project (alternate parts and parameter overrides).

Altium models a variant as an overlay on the core project. The fitted/not-fitted
state, the alternate-part choices, and the per-part parameter overrides all live in
numbered, INI-like sections of the text `.PrjPcb` itself:

```ini
[ProjectVariant2]
Description=ADS125H01
AllowFabrication=0
VariationCount=148
Variation1=Designator=D1_CH1|UniqueId=\1PMVAVRRX\COEUSLRK|Kind=1|AlternatePart=
Variation60=Designator=R94|UniqueId=\QHTSDXVH\AWXOAPPG|Kind=2|AlternatePart==Value|AltLibLink_DesignItemID=CRG0805F12K|...
ParamVariationCount=40
ParamVariation1=ParameterName=Comment|VariantValue==Value
ParamDesignator1=R94
ParamVariation20=ParameterName=Value|VariantValue=12k
ParamDesignator20=R94
```

`Description` is the native variant name, and `AllowFabrication` is the flag
`list_designs` reports as `fabrication`. Each `VariationN` row is pipe-delimited and
its `Kind` says what the variant does to the part:

| `Kind` | Meaning | Effect on the component |
|---|---|---|
| `0` | Fitted, written explicitly | none |
| `1` | Not Fitted | `dns: true` |
| `2` | Alternate Part; `AltLibLink_DesignItemID` names the substituted library item | `alternate_part: true`, plus the parameter overrides below |

A per-part parameter override is a `ParamVariationN=ParameterName=<name>|VariantValue=<value>`
row, paired to its part by the `ParamDesignatorN=<designator>` row of the same number.
The parser applies the overrides for the parameters `Value`, `Description`,
`Manufacturer`, and `Manufacturer Part Number` onto the component's `value`,
`description`, `manufacturer`, and `mpn`. A `Comment` of `=Value` is Altium's
expression for "show the Value parameter" and resolves to the value, the same way
the base parser resolves it. A `Kind=2` row without a parameter override for a
field leaves that field at its base value. The result is that every part field
describes the part as built for the selected variant, and `alternate_part` says
only that it differs from the base design.

A real example from `Pico-4CH`: the `ADS125H01` variant replaces `R94`, a 5.6k
Yageo `RC0805FR-075K6L` in the base design, with a 12k TE Connectivity
`CRG0805F12K`, through a `Kind=2` row plus `Value`, `Manufacturer`,
`Manufacturer Part Number`, and `Description` parameter rows. Querying `R94` in
that variant returns `value: "12k"`, `mpn: "CRG0805F12K"`,
`manufacturer: "TE Connectivity"`, and `alternate_part: true`; in `<Default>` it
returns the Yageo part with no flag.

Variant rows are matched to parsed components by designator, case-insensitively,
after all project sheets have been merged. A repeated sheet's channel designators
match too: Altium writes the physical designator into the row (`D1_CH1` above), so a
row reaches the channel instance it names. A designator repeated in several rows,
one per channel, receives every parameter row paired to that designator.

The binary `.PrjPcbVariants` sidecar has a narrower purpose: it stores the
alternate parts' symbol data. The rows that say which part a variant fits, and
with which parameters, are in the project file itself.

`list_designs` reports the native names under `design_variants`. A project with
named variants requires `design_variant` on every query, either one of those names
or `<Default>` (alias `default`), so a caller cannot accidentally treat a
variant-bearing project as fully fitted.

## Ports and sheet entries

**Confidence: VERIFIED** against the boards named below. A `.PcbDoc` carries the netlist Altium
compiled from the same schematics (`Nets6`, `Components6` and `Pads6` streams), and
`test/integration/altium-board.test.ts` reads it back to check which pins share a net and what
the net is called. The single-sheet STM32 fixture agrees on every pin, so any disagreement on the
hierarchical fixtures is the parser's.

### A port is a bar with two hotspots

A `PORT` (`RECORD=18`) is drawn as a bar `Width` long starting at `Location`, rightward for a
horizontal style and upward for a vertical one (`Style` 4 and above). A wire may land on either
end: over the fixture and corpus projects, 140 ports are wired at `Location` and 147 at the far
end. The parser keeps both ends, as it does for a pin, so a port joins whichever end the wire
reaches. Before this, a far-end port joined nothing and its net took a pin name such as
`NetJ10_8` where the board says `CANH`.

A port joins other ports of its name on the same sheet, and nothing else by name. Altium's
connectivity guide is explicit that a port called `Inta` does not connect to a net label called
`Inta`; the two must be wired.

### A sheet entry sits on its symbol's edge

A `SHEET_ENTRY` (`RECORD=16`) has no location of its own. It is a child of its `SHEET_SYMBOL`
(`RECORD=15`), placed by two fields:

| Field | Meaning |
|---|---|
| `Side` | `0` left (the default, and absent from most files), `1` right, `2` top, `3` bottom |
| `DistanceFromTop` | steps of 10 units along that edge from the symbol's top-left corner: downward on a vertical edge, rightward on a horizontal one |
| `DistanceFromTop_Frac1` | the fraction of a step in millionths; `500000` is half a step |

The nRF52840 DK cover sheet places every entry half a step down, and every one of its wires
ends there. Keys are upper case in older files (`DISTANCEFROMTOP`, `SIDE`), as everywhere
else in the format.

Positioned this way, a plain entry is a connection point like a pin: a wire from a parent-sheet
label into it, or from one entry to another across the top sheet, forms a net. Before this, a
top sheet drawn as nothing but sheet symbols wired entry to entry contributed no nets at all
(64 such wires on misko3 alone). A harness-typed entry carries a bundle and is placed by the
harness code instead; an entry in range notation (`AD[0..7]`) or written `Repeat(NAME)` meets a
bus, and joins through it (see Buses below).

### How the sheets are joined

Within a document, geometry decides. Across documents the parser records, for every net, the
identity claims its ports, entries, bus members and power ports make, and resolves them
project-wide with a union-find once every sheet has been read. Each claim is a key:

| Key | Made by | Joins |
|---|---|---|
| `hier\|<child>@<parent>#<symbol>@<channel>\|<name>` | a port on `child`, about the channel of the sheet symbol that placed it; a plain entry on that symbol, about every channel it instantiates; a `Repeat(NAME)` entry's bus member `NAME<n>`, about channel `n` | under every scope |
| `port\|<name>` | a port | under Flat and Global scope, where ports join by name anywhere |
| `power\|<name>` | a power port | wherever power ports are global, i.e. every scope but Strict Hierarchical |
| `harness\|<bundle signal>` | a bus member reaching a harness entry, or a harness-typed port, written as a range | always, the bundle name resolved the way harness signals are |

Under Hierarchical scope the port-to-entry pair is the only way a signal crosses a boundary;
ports of one name on different sheets are different nets, which is what Altium documents
("ports only connect vertically to their corresponding sheet entries"). Under Flat and Global
scope the pair still holds and ports of one name join as well; LimeSDR-USB (Global) draws a
block-diagram top sheet whose entries are wired to each other, and its board agrees with the
result on every pin.

A net with no pins, such as a top-sheet wire between two entries, still links the claims it
carries, and still offers its name (see below). A power port links the nets it sits on across
sheets whatever those nets are called, which is what lets a label outrank it without splitting
the supply.

### Multi-channel sheets are placements

A sheet symbol is a placement of its child document, and a document placed more than once is a
multi-channel sheet whichever way it was placed: by several plain sheet symbols, or by one whose
designator is `Repeat(...)`. Altium's multi-channel guide allows both and expands the child the
same way for each. The parser reads every symbol in the project, parses the child once, and
instantiates it once per channel with the project's channel designator format (see
Multi-channel below); every channel then links to the symbol that placed it as any single
placement does. The `.PrjPcbStructure` is not read for this: it records the same symbols, and is
frequently not committed.

Before this, a child placed by several plain symbols was parsed once and left unlinked (nine
such children on solarcar-bms, one on cube-sat-eps), and a `Repeat()` sheet was joined to its
parent by net name alone, which needed its ports to name nets whatever `AllowPortNetNames`
said. Both now go through the links above, and the option is honoured everywhere.

### What the joined net is called

`AllowPortNetNames` (Altium's default is off) and `AllowSheetEntryNetNames` (default on) decide
whether a port or an entry may name a net at all; a net named by neither takes a pin name.
`PowerPortNamesTakePriority` (default off) decides whether a power port outranks a net label on
the same net. When the nets of several sheets are folded into one, the strongest claim wins, in
the order Altium's connectivity guide gives: a labelled harness member, a net label, a power
port, a port, a sheet entry, a pin name, with the power port moved to the front when the project
gives it priority. Between two claims of one rank the first in sort order wins, so the result
does not depend on the order the documents were read in. The misko3 board bears out the label
against the port: `USART5_TX` (a label on the MCU sheet) beats `LIN_TXD` (the port on the
transceiver sheet), and `NRST` beats `T_NRST`, `NRST_MCU` and `NRST_DBG`. No fixture board has a
net that a label and a power port both name, so that order rests on the guide alone; the
q23-harness fixture, whose project leaves the option off, names its 5 V sensor supply after the
label `SEN_5V_A1` rather than the power port `VCC5V`.

A pinless net still names: a wire between two entries carries no pins, but under
`AllowSheetEntryNetNames` the entry names the net the child's pins end up in, and a pin-named
child net takes that name. A port or entry name under Hierarchical scope is the sheet's own, so
it is held under a provisional, sheet-unique name while the sheets are merged and settled
afterwards; a name two distinct nets still claim is numbered `_2`, `_3` for the later ones in
sort order.

`AppendSheetNumberToLocalNets` numbers a label wired into a sheet entry just as it numbers one
wired to nothing else: all 48 such labels on the solarcar-bms board carry their sheet number. A
label on a net that leaves through a port, or through a bus that reaches a range identifier, is
not numbered: the misko3 board calls the bus members `AD0` and `PWM8`, not `AD0_6`.

### Objects meet within half a unit

Objects drawn in Altium sit on the grid and meet exactly. Imported designs carry fractional
coordinates, and their objects meet only nearly: up to 0.315 units apart, from metric rounding.
Two objects touch within 0.5 units. Nothing is drawn that close deliberately: the grid is 10 units
and the finest imported pin pitch 2.5.

Two pins meet end to end or not at all. A pin's whole length is kept as a hotspot so that a wire
ending part way along it still joins, which imported designs also draw; but two pins lying along
one line do not join by overlapping. The LimeSDR-USB FPGA bank sheet stacks two resistors that
way, and the board keeps their nets apart.

### Results against the boards

Board nets split into more than one parser net, before and after:

| Fixture | Before #210 | After #210 | Now | What remains |
|---|---|---|---|---|
| Altium-STM32-PCB (one sheet) | 0 | 0 | 0 | |
| MIXR Power | 8 | 0 | 0 | |
| nRF52840 DK pca10056 | 3 | 0 | 0 | |
| misko3 | 83 | 55 | 0 | |
| LimeSDR-USB 1v4 (Global, imported) | 6 | 6 | 0 | |
| LimeSDR-USB 1v2 | 4 | 4 | 0 | |
| solarcar-bms | 129 | 101 | 68 | the board disagrees with its schematics on 71 pins |
| aberrant-sound-module | 1 | 1 | 0 | the board is out of date, and names overbar nets `A\D\0\` where the parser strips the bars |
| FMC-DIO 32ch LVDS (32 channels by `Repeat()`) | 160 | 160 | 0 | |

The comparison reads each component's physical designator from the board's `Texts6` stream
rather than the logical `SOURCEDESIGNATOR` that every channel of a repeated sheet shares, so a
multi-channel board compares every channel's pins: FMC-DIO shares 1877 pins with its schematics
rather than the 533 the logical designators reach, and all 1877 agree in net and in name.

No parser net spans two board nets on any but the last two. On misko3 the pins whose net name
matches the board's went from 644 to 780 of 816; the rest are harness members the board names
after a label drawn on another sheet than the member. On LimeSDR-USB the names that differ are
the board's upper-casing of the schematic's.

## Buses

**Confidence: VERIFIED** against the misko3 and LimeSDR-USB boards and the ld_harness project.

A `BUS` (`RECORD=26`) is a polyline written like a wire (`LocationCount`, `X1`, `Y1`, ...) that
carries several signals at once. It connects nothing by itself. A wire joins it through a
`BUS_ENTRY` (`RECORD=37`), a short diagonal from `Location.X/Y` to `Corner.X/Y`, and the wire's
net label says which of the bus's signals that wire is. On misko3 all 136 bus entries land on a
bus, 131 wires meet a bus entry, and 127 of those carry a label within a range the bus reaches.

The bus leaves the sheet through an identifier written in range notation, and those are the
only objects a bus connects to:

| Identifier | Example | Where it is placed |
|---|---|---|
| a port | `LED[0..7]` | by its own location, like any port |
| a sheet entry | `AD[0..11]` | on its symbol's edge, like any entry |
| a harness entry | `DAC[1..2]` | on its connector, like any harness entry |
| a `Repeat(NAME)` sheet entry | `Repeat(OP_OUT_P)` | on its symbol's edge; carries `NAME1`, `NAME2`, ... one per channel |

All 16 range identifiers on misko3 land exactly on a bus vertex. A net label in range notation on
the bus itself names the bus, and as with a wire the name joins every bus on the sheet that
carries it: the ld_harness top sheet draws `OP_OUT_P[1..9]` on one bus beside the channel symbol
and again on another beside the connector, and only the label says they are one.

The parser groups buses and bus entries into runs by geometry, joins runs that carry one label,
and for each run matches the labels of the nets whose wires end on it against every identifier
on it. A match is recorded on the net as a carrier, and the link code turns each carrier into
the claim the identifier would make for a plain wire: a port's `hier` and `port` keys under the
member's name, a sheet entry's `hier` key for the symbol (for `Repeat(NAME)`, for the channel the
member indexes), a harness entry's or harness-typed port's `harness` key under the bundle and
the member. A member no wire on the sheet labels still crosses the boundary, as a pinless net
carrying only its identifiers, so a bus drawn straight from one symbol's `A[0..7]` to another's
links the two.

Altium's multi-channel guide states the `Repeat(NAME)` rule this way: with the symbol
`Repeat(CIN,1,4)` and the entry `Repeat(Headphone)` on a bus `Headphone[1..4]`, "the net
Headphone1 will connect to the channel CIN1, Headphone2 will connect to channel CIN2, and so
on"; a bus wired to a plain entry reaches every channel. ld_harness does exactly this for nine
channels, and every one of its 437 pins now sits on a net with at least two.

The guide's example names the bus after the entry, but Altium does not require it. The
FMC-DIO top sheet wires a bus labelled `FMC1_P[32..1]` into the entry `Repeat(FMC_P)` of a
32-way buffer symbol, and its board carries `FMC1_P8` into channel 8 (`IC49H.6`) and `FMC1_P27`
into channel 27 (`IC49[.6`): member `n` of the bus reaches channel `n`, whatever the bus is
called, and a descending range changes nothing. So a `Repeat(NAME)` entry accepts `NAME<n>`
and, when every range on its run spells one prefix, that range's members as well. A run
carrying two prefixes (`IN1_P[2..1]` and `IN1_N[2..1]` on one bus) could hand one channel two
members, and there the entry keeps to its own name.

The same sheet shows that a bus member need not touch the bus. Its `FMC1_P8` is a wire from
the connector symbol's `LA07_P` entry to a net label, drawn nowhere near the bus, and the board
joins it all the same: a net label names the net wherever on the sheet it is drawn, and a bus
labelled `FMC1_P[32..1]` carries the nets `FMC1_P1` to `FMC1_P32`. A net is therefore on a run
when a wire of its ends there, or when it is labelled with a member of a range the run carries,
as a label on the bus or as a port or entry the bus reaches. Geometry alone decides which
identifiers are on the run, so a wire labelled `D3` into some other symbol's entry elsewhere on
the sheet does not drag that entry onto the bus. Before this, all 96 channel signals on FMC-DIO
(`FMC1_P`, `FMC1_N`, `EN1_RX` for 32 channels) stopped at the top sheet and every channel's port
was a single-pin net named after its pin, `NetIC49H_6` where the board says `FMC1_P8`.

## Multi-channel (repeated sheets)

**Confidence: VERIFIED** — implemented and tested against the designs named below.

A multi-channel design instantiates one sub-sheet several times. The repeat is declared on the
sheet symbols, not in the child document: either several sheet symbols name the same child, or
one symbol carries a `Repeat()` designator. See Multi-channel sheets are placements above for
how either is found and linked; this section covers the naming.

A `SHEET_SYMBOL` (`RECORD=15`) owns two children that matter:

| Record | Meaning | Example |
|---|---|---|
| `32` `SHEET_NAME` | the sheet symbol's designator | `Text=Repeat(AY,1,3)` |
| `33` `SHEET_FILE_NAME` | the child document instantiated | `Text=ay.SchDoc` |

Both carry the parent's index in `OWNERINDEX`. That index counts `RECORD=` objects only, so it
lines up with the record list after the `HEADER` record has been filtered out, not with the
raw segment order: in `aberrant-sound-module` the sheet symbol is segment 29 and its children
name owner 28. `buildHierarchy()` reindexes the filtered list from zero before resolving
owners, which is what makes the two agree.

A designator of the form
`Repeat(<name>,<start>,<end>)` means the child document is instantiated once per index, with
channel (room) names `<name><start>` … `<name><end>`.

Whitespace is inconsistent in real files and all of these occur:

```
Repeat(AY,1,3)              aberrant-sound-module
Repeat(ideal_diode, 1, 2)   Dominik-Workshop/cube-sat-eps
Repeat(CHAN, 1,9)           pulp-bio/HELIOS-R
```

A range yielding fewer than two instances is not treated as multi-channel, and the sheet is
parsed once like any other. A child placed by plain symbols takes each symbol's designator as
its room name; two symbols carrying one designator (cube-sat-eps places `buck_boost` twice under
that name) would give two channels one room, and so one designator for each part, which Altium
reports as a duplicate sheet symbol name; the later room is numbered `buck_boost_2` so nothing
is folded together.

Sheet entries may also be repeated, written as a bare `Repeat(<name>)` with no range. Those
hand one bus member to each channel (see Buses); entries without `Repeat()` are shared across
all channels. Across the fixture corpus only two record types ever carry a `Repeat(...)` name:
`SHEET_ENTRY` (17 occurrences) and `SHEET_NAME` (9). Ports do not, and the parser reads the
form only on sheet entries.

A sheet entry name is not always one signal. It may be bus notation, `AD[0..7]`, which is
expanded to `AD0` … `AD7` and classified signal by signal, descending ranges included. It may
also carry Altium's overbar escaping, where `C\S\` denotes an active-low `CS`; the
backslashes are stripped, so `Repeat(C\S\)` classifies as `CS`, and `aberrant-sound-module`
contains exactly that.

### Channel designator format

Expanded components are renamed using the project's `ChannelDesignatorFormatString`, a plain
text setting in the `.PrjPcb`, read by a line-wise regex and defaulting to
`$Component_$RoomName` when the project omits it. It sits alongside `ChannelRoomNamingStyle`
and `ChannelRoomLevelSeperator`, which the parser does not read: the separator a project
wants is already written into the format string itself, so `RoomNamingStyle=1` shows up as a
literal `.` in `$Component.$RoomName` rather than as a setting to interpret. The tokens:

| Token | Meaning | `R5`, room `MPPT2`, channel 2 |
|---|---|---|
| `$Component` | full designator | `R5` |
| `$ComponentPrefix` | leading non-numeric part | `R` |
| `$ComponentIndex` | trailing numeric part | `5` |
| `$RoomName` | channel room name | `MPPT2` |
| `$ChannelIndex` | 1-based channel number | `2` |
| `$ChannelAlpha` | alphabetic label: `A` for channel 1 through `Z` for channel 26, then the ASCII characters after `Z` (channel 27 is `[`, channel 32 is a backtick) | `B` |

`$ChannelAlpha` does not roll over to `AA`. Altium continues through the ASCII
table past `Z`, so a sheet repeated more than 26 times gets punctuation for its later
channels: `ohwr/FMC_DIO_32ch_lvds_a` names channels 27 through 32 `R1[` through
``R1` ``, and the parser reproduces those designators so variant rows and queries
match them.

Formats observed in the wild, with a design that uses each:

```
$Component_$RoomName                           aberrant-sound-module, PW-Sat2, HELIOS-R
$Component$ChannelAlpha                        cube-sat-eps, heron-hardware, utca-rtm-8-sfp
$Component.$ChannelIndex                       hildogjr/easyinverter (OnePhase)
$Component_$ChannelIndex                       PW-Sat2, sinara-hw/Thermostat_EEM
$Component.$RoomName  (RoomNamingStyle=1)      hildogjr/easyinverter (LogicsOnly)
$ComponentPrefix_$ChannelIndex_$ComponentIndex ohwr/vme-adc-250k-16b-36cha
```

Substitution must match the longest token first: a naive `replace("$Component", …)` rewrites
`$ComponentPrefix` into `R5Prefix`. A token outside the table above is left in the designator
as written, so a format the parser does not model yet produces one visibly wrong designator
per channel instead of collapsing every channel onto the same one.

### `.PrjPcbStructure` is not read

Altium writes `.PrjPcbStructure` when a project is compiled, and it is frequently not
committed: every multi-channel design surveyed outside our own fixtures ships only the
`.PrjPcb`. It records the same sheet symbols the schematics carry, so channel discovery reads
the sheet symbols and nothing else. The structure parser is kept for tooling that wants the
file's own view.

## Signal harnesses

**Confidence: VERIFIED** — implemented in `src/parsers/altium/harness.ts` and tested against
the designs named below. The record model was read out of `pulp-bio/HELIOS-R`.

A signal harness bundles several signals into one drawn connection, the schematic equivalent
of a cable loom. Four record types participate, all of them in the `Additional` stream:

| Record | Name | Key fields |
|---|---|---|
| `215` | Harness Connector | `Location.X/Y`, `XSize`, `YSize`, `PrimaryConnectionPosition`, `HarnessConnectorSide` |
| `216` | Harness Entry | `Name`, `DistanceFromTop`, optional `HarnessType`, sometimes `OwnerIndex` |
| `217` | Harness Type | `Text` — the type name, e.g. `Channel_interface` |
| `218` | Signal Harness | polyline: `LocationCount`, `X1/Y1` … `Xn/Yn` |

A harness connector (`215`) owns its entries (`216`), each naming one member signal. The
harness type (`217`) names the bundle. The signal harness (`218`) is the polyline that carries
the whole bundle between objects, and behaves like a bus for connectivity purposes.

### Entries inherit their position from the connector

An entry carries no coordinate of its own, only a `DistanceFromTop`, so nothing lands on it
until it is given one. `readHarnessConnectors()` places each entry at

```
x = Location.X + (entry on the right edge ? XSize : 0)
y = Location.Y - (DistanceFromTop + DistanceFromTop_Frac1 / 1e6) * 10
```

That pitch of 10 grid units comes from `HELIOS-R`'s main sheet: its connector sits at
`Location.Y=670` with entries at `DistanceFromTop` 1, 2, 9, 10 and 13, and the five wires that
land on it end at y = 660, 650, 580, 570 and 540 — exactly `Location.Y - n * 10`. The step
count is fixed-point: `channel.SchDoc` writes `DistanceFromTop=1 | DistanceFromTop_Frac1=500000`
for an entry whose wire ends 15 units below the top, so 500000 is half a step. An entry on the
top edge writes no whole part at all.

Which edge the entries sit on is written twice, from opposite ends, and never both at once:

| Written | Entries | Bundle leaves from |
|---|---|---|
| `HarnessConnectorSide=1` on the connector | left edge | right edge |
| `Side=1` on each entry | right edge | left edge |

The two forms split the fixture corpus almost evenly — 53 of 115 connectors declare
`HarnessConnectorSide`, the other 62 mark their entries instead — so reading only one of them
leaves half the harness entries of a design unplaced. Together the rules put 364 of the 365
entries in `qfsae/pcb` and `pulp-bio/HELIOS-R` exactly on the end of a wire.

Ownership is taken from stream order, an entry belonging to the connector that precedes it,
for two reasons. `OwnerIndex` is often simply absent: across the two harness fixtures 330 of
365 entries carry it and 35 do not, and all five entries of the `HELIOS-R` main sheet are in
the second group. And where it is present it numbers the `Additional` stream's own record
list, so it is rebased by the number of `FileHeader` records when the two lists are joined.
Positioning runs on the `Additional` records alone, before that join.

An entry whose connector has no coordinates at all is left unpositioned, and the net extractor
skips it: placed at the origin instead, every such entry in a document would appear to touch
every other.

The bundle leaves the connector from the opposite edge, at
`Location.Y - PrimaryConnectionPosition` — note the plain units here, not the entries' grid
steps. That point meets either a signal harness line or a harness-typed port; all 115
connectors in the corpus attach at one or the other.

### Harness type definitions live outside the `.SchDoc`

Each document has a sibling `<name>.Harness` file — plain text, one type per line:

```
AGND_Domain=PULSE_OUT,PULSE_IN,AGND,VDD5,STDN,TEMPOUT
Channel_interface=PGND,V_LASER_P,3V3_P,AGND,VDD5_A
PGND_Domain=3V3_P,OP_OUT,PGND,V_LASER
```

`TypeName=Member1,Member2,…`. The members are the signals the bundle carries. The file is
found by swapping the document's `.SchDoc` extension for `.Harness`; a document that uses no
harnesses has no such file, which is the ordinary case and not an error.

### Harness-typed ports and entries

Three record types carry `HarnessType=<type>` to mark an object as a bundle rather than a
single signal. Counted over the two harness fixtures: `SHEET_ENTRY` (`RECORD=16`) 44 times,
`PORT` (`RECORD=18`) 110 times, and harness entry (`RECORD=216`) twice.

```
RECORD=16 | Name=CHANNEL | HarnessType=Channel_interface
```

That is how a harness crosses a sheet boundary: the entry connects by name as usual, and the
signals it carries are the members of its type. `classifySheetEntries()` resolves the sheet
entry's type to its members and classifies every member the same way the entry itself is
classified, so a shared harness keeps its members shared instead of handing each channel a
private copy that connects to nothing.

A harness-typed sheet entry is also placed the way a harness entry is, inheriting position
from the sheet symbol (`RECORD=15`) that precedes it in the stream, taking the left edge
unless `Side=1` puts it on the right, and sitting `DistanceFromTop` grid steps below the
symbol's top. All 44 of them in the corpus land exactly on a harness line vertex.

### Which nets a harness carries, and what they are called

Altium is explicit that these objects resolve connectivity and do not name it: the harness
type and its entries are "names of the containers that carry the nets, not the names of the
nets themselves". Two consequences follow, and both matter.

A member name is unique only inside its own bundle. `qfsae/pcb` draws one `3WIRE_PSG_SENSOR`
harness per sensor, each with an entry called `SIGNAL`; naming nets after entries would put
every sensor's signal on one net. So a bundle is identified by what its connector's outgoing
connection reaches:

- a **harness-typed port** — the bundle takes that port's name, which is global, so the sheet
  on the other side arrives at the same identity;
- a **signal harness line** — everything meeting that line is one bundle, and connectors,
  ports and sheet entries on it share an identity;
- neither — the bundle is local to its sheet and identified by the sheet.

Entries of one bundle sharing a name are then one net, whatever the wires reaching them are
labelled, which is the whole point of the mechanism. Where the two ends are on different
sheets the nets are matched by the same identity after both sheets are parsed
(`mergeHarnessSignalNets()`), and the surviving name is the one the designer wrote, preferring
whichever is already on more pins.

One bundle is rarely called the same thing at both ends — a bulkhead sheet takes in
`TRANSPONDER_POWER_UL` and passes on `TRANSPONDER_POWER`. The parent sheet is where they are
shown to be one bundle, by a harness line drawn between the two sheet entries that name them;
`resolveBundleNames()` folds such names together across the project.

The exception to harness objects not naming nets is a **net label placed on the signal harness
line**. That names the harness, and every net it carries is then called
`<harness label>.<entry name>` in place of the wire's own label.

### Harness types nest

A harness entry may itself be harness-typed:

```
RECORD=216 | Name=PGND | HarnessType=PGND_Domain
```

Here the `PGND` member of `Channel_interface` is not a single signal but a nested bundle of
`PGND_Domain`'s members. Resolving a harness to its constituent signals is therefore
recursive, and an implementation that flattens only one level will silently drop the nested
members. `HELIOS-R` exercises exactly this case.

The nesting is declared on the entry record, not in the `.Harness` file, which lists member
names only. `collectNestedHarnessTypes()` builds the member-to-type map from the `216` records
of the parent schematic, which is another reason the `Additional` stream has to be read.

It reads that schematic's root-level records, so a nested type is picked up when its entry has
no `OwnerIndex` and stays at the root, as `HELIOS-R`'s `main.SchDoc` `PGND` entry does. An
entry that does carry an `OwnerIndex` is filed under an owner by the hierarchy builder and is
not seen: `channel.SchDoc` holds one such entry. It costs nothing there, because the type map
that matters for expansion is the parent's, but a design that declares its nesting only on
owned entries would resolve its bundles one level short.

A nested member is qualified with the entry that reached it (`PGND` carrying `PGND_Domain`'s
`OP_OUT` yields `PGND.OP_OUT`), so one signal name appearing in two branches stays two
distinct signals. Sheet-entry classification registers both the qualified name and its leaf,
since the leaf is what a net inside the child sheet is called. A type reachable from itself
stops at the repeat rather than recursing forever.

### Scope

Within a sheet, positioned harness entries join nets by geometry, and entries carrying one
signal of one bundle join whatever the wires are labelled.

Across a sheet boundary, a bundle is followed by matching signal identities between documents,
including through a harness line drawn on a parent sheet between two sheet entries. Bundle
names are matched project-wide, as ports already are elsewhere in this parser, so two sheets
that reuse a harness port name are read as sharing that bundle.

A repeated sheet's channels are documents like any other, so a harness signal collected on one
names the channel's net; `classifySheetEntries()` also carries a shared bundle's members across
so that the channel's nets keep the shared name.

The nesting relationship is read from the entry records, but a nested bundle is not yet given
its own identity: its members resolve as names, and its connectivity depends on the enclosing
bundle.

## Component instances

A component record (RECORD=1) is one drawn instance of one part of a library component, and not every pin written under it is a connection point. `src/parsers/altium/part-pins.ts` decides which are, and both the net extraction and the component extraction read it, so the two indices of the netlist are built from the same pins.

**Multi-part components.** A multi-part component (a dual op-amp, a resistor array, an FPGA split into banks) writes every part's pins under every instance, with `OwnerPartId` on the pin and `CURRENTPARTID` on the instance saying which part that instance draws. Only the drawn part's pins connect. The instances of one component, on one sheet or across sheets, are merged into one component: the union of their pins, the first instance's entry where both declare a pin, and the first instance's fields with gaps filled from the others. A part drawn on no sheet still has its pins declared, unconnected.

**Display modes.** A component with alternate display modes writes one pin set per mode, at the coordinates of that mode's graphic, with `OwnerPartDisplayMode` on the pin and `DISPLAYMODE` on the instance (both unwritten for the default mode, 0). Only the drawn mode's pins connect. The other modes' pins sit wherever their graphic would put them, which can be on another net's wire; a header drawn in its default mode used to have the alternate mode's pins land on the GND rail.

**Duplicate designators.** Two instances with the same designator and the same part are a duplicate designator, which Altium's compiler reports as an error. One physical part cannot have one pin on two nets, so the first instance in document order is the part, and later instances, on the same sheet or a later one, are ignored: their pins connect nothing and their fields are not read. A wire that reached only an ignored instance's pin keeps the rest of its members, or becomes a single-pin net that `run_erc` reports. Unannotated parts (designator `X?`) repeated across sheets fall under this rule.

After every document is merged, `reconcileNetlist` removes any net listing that the component map contradicts, so the output always passes the Universal Netlist reader's inverse check.

### Designs used for testing

Two of the surveyed designs are vendored into `test/fixtures/altium/`, with record counts as
they stand in the fixture:

| Fixture | Licence | Harness records (215/216/217/218) | Notes |
|---|---|---|---|
| `HELIOS-R/ld_harness` (`pulp-bio/HELIOS-R`) | Solderpad 0.51 / Apache-2.0 | main 1/5/1/1, channel 5/25/5/3 | nested types; also 9-way multi-channel |
| `qfsae-harness/q23-harness` (`qfsae/pcb`) | MIT | 109/335/109/60 | dedicated harness sub-project, 14 sheets, 12 of them with harness objects |

Further designs surveyed for the record model, not vendored:

| Design | Licence | Harness records (215/216/217/218) | Notes |
|---|---|---|---|
| `ohwr/utca-rtm-8-sfp` | CERN-OHL-1.1 | 51/168/45/119 | densest harness usage |
| `ohwr/amc-carrier-2-sl` | CERN-OHL-1.1 | 81/376/76/78 | harness at board scale |
| `memristor/electronics` | Apache-2.0 | 2/6/2/2 | smallest harness sheet, 13.8 KB |

The unit tests exercise this logic on record fixtures written inline, quoting the verbatim
contents of `HELIOS-R`'s `channel.Harness` and its connector geometry, rather than by opening
the `.SchDoc` files.
