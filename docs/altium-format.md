# Altium Designer Schematic Format

Reference for the two parts of the `.SchDoc` / `.PrjPcb` format that carry enough hidden
structure to be worth writing down: multi-channel sheet repetition, and signal harnesses.
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

## Multi-channel (repeated sheets)

**Confidence: VERIFIED** — implemented and tested against the designs named below.

A multi-channel design instantiates one sub-sheet several times. The repeat is declared on the
sheet symbol, not in the child document.

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
parsed once like any other.

Sheet entries may also be repeated, written as a bare `Repeat(<name>)` with no range. Those
produce one net per channel; entries without `Repeat()` are shared across all channels. Across
the fixture corpus only two record types ever carry a `Repeat(...)` name: `SHEET_ENTRY` (17
occurrences) and `SHEET_NAME` (9). Ports do not, and the parser reads the form only on sheet
entries.

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
| `$ChannelAlpha` | alphabetic label, rolling past Z to `AA` | `B` |

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

### `.PrjPcbStructure` is optional

Altium writes `.PrjPcbStructure` when a project is compiled, and it is frequently not
committed. It is a convenience, not the source of truth: every multi-channel design surveyed
outside our own fixtures ships only the `.PrjPcb`. Channel discovery therefore reads the sheet
symbols directly, and uses the structure file only when present.

**Filename casing is not consistent, and the lookup assumes one spelling.**
`findStructureFile()` builds exactly `<project>.PrjPCBStructure`, with `PCB` capitalised. Both
spellings occur in the fixtures: `aberrant-sound-module` writes `.PrjPCBStructure` and matches
either way, while LimeSDR-USB writes `.PrjPcbStructure` and matches only because macOS
filesystems are case-insensitive by default. On a case-sensitive filesystem the LimeSDR
spelling would not be found, and the project would silently fall back to reading sheet
symbols. That fallback is correct, so the effect is a slower path rather than a wrong answer.

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
until it is given one. `positionHarnessEntries()` places each entry at the connector's
`Location.X`, and at `Location.Y - DistanceFromTop * 10`.

That pitch of 10 grid units comes from `HELIOS-R`'s main sheet: its connector sits at
`Location.Y=670` with entries at `DistanceFromTop` 1, 2, 9, 10 and 13, and the five wires that
land on it end at y = 660, 650, 580, 570 and 540 — exactly `Location.Y - n * 10`.

Ownership is taken from stream order, an entry belonging to the connector that precedes it,
for two reasons. `OwnerIndex` is often simply absent: across the two harness fixtures 330 of
365 entries carry it and 35 do not, and all five entries of the `HELIOS-R` main sheet are in
the second group. And where it is present it numbers the `Additional` stream's own record
list, which stops meaning anything once those records are appended to `FileHeader`'s. So
positioning runs on the `Additional` records alone, before the two lists are joined.

Only `HarnessConnectorSide=1` is positioned, that being the arrangement confirmed against a
real design; 53 of the 115 connectors in the fixture corpus declare it and the remaining 62
omit the field. An entry on an unconfirmed side is left without coordinates, so it takes no
part in connectivity rather than inventing a connection that may not exist.

Once positioned, an entry is a connectable device like a wire or a pin, and also a naming
device: a net reaching an entry takes that entry's `Name`, ranked alongside power ports, net
labels and ports in `assignNetName()`.

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

The `PORT` side of the same boundary is read as a plain named port; its `HarnessType` is
recorded in the file but not yet consulted.

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

Within a sheet, positioned harness entries join nets by geometry on every design.

Across a sheet boundary, member resolution runs only where a repeated sheet is expanded into
channels. A single-instance sheet reached through a harness-typed sheet entry is parsed and
merged like any other sheet, without its bundle being expanded into member signals.

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
