# Altium Designer Schematic Format

Reference for the parts of the `.SchDoc` / `.PrjPcb` format this parser reads. Companion to
[`dsn-format.md`](dsn-format.md), which covers Cadence.

A `.SchDoc` is an OLE compound document. Its `FileHeader` stream holds pipe-delimited ASCII
records, one per object:

```
|RECORD=27|OWNERINDEX=12|LOCATION.X=410|LOCATION.Y=670|...
```

Because the records are plain ASCII inside the binary container, `grep -a` works directly on
a `.SchDoc` and is the fastest way to survey a design:

```bash
LC_ALL=C grep -aoE "RECORD=[0-9]+" file.SchDoc | sort -n | uniq -c
```

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

Both carry the parent's index in `OWNERINDEX`. A designator of the form
`Repeat(<name>,<start>,<end>)` means the child document is instantiated once per index, with
channel (room) names `<name><start>` … `<name><end>`.

Whitespace is inconsistent in real files and all of these occur:

```
Repeat(AY,1,3)              aberrant-sound-module
Repeat(ideal_diode, 1, 2)   Dominik-Workshop/cube-sat-eps
Repeat(CHAN, 1,9)           pulp-bio/HELIOS-R
```

Sheet entries and ports may also be repeated, written as a bare `Repeat(<name>)` with no
range. Those produce one net per channel; entries without `Repeat()` are shared across all
channels.

### Channel designator format

Expanded components are renamed using the project's `ChannelDesignatorFormatString`, a plain
text setting in the `.PrjPcb`, alongside `ChannelRoomNamingStyle` and
`ChannelRoomLevelSeperator`. The tokens:

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
`$ComponentPrefix` into `R5Prefix`.

### `.PrjPcbStructure` is optional

Altium writes `.PrjPcbStructure` when a project is compiled, and it is frequently not
committed. It is a convenience, not the source of truth: every multi-channel design surveyed
outside our own fixtures ships only the `.PrjPcb`. Channel discovery therefore reads the sheet
symbols directly, and uses the structure file only when present.

## Signal harnesses

**Confidence: VERIFIED format, NOT YET IMPLEMENTED** — see issue #43. The record model below
was read out of `pulp-bio/HELIOS-R`; the parser does not yet trace nets through harnesses.

A signal harness bundles several signals into one drawn connection, the schematic equivalent
of a cable loom. Four record types participate:

| Record | Name | Key fields |
|---|---|---|
| `215` | Harness Connector | `Location.X/Y`, `XSize`, `YSize`, `PrimaryConnectionPosition`, `HarnessConnectorSide` |
| `216` | Harness Entry | `OwnerIndex` (the 215), `Name`, `DistanceFromTop`, optional `HarnessType` |
| `217` | Harness Type | `Text` — the type name, e.g. `Channel_interface` |
| `218` | Signal Harness | polyline: `LocationCount`, `X1/Y1` … `Xn/Yn` |

A harness connector (`215`) owns its entries (`216`), each naming one member signal. The
harness type (`217`) names the bundle. The signal harness (`218`) is the polyline that carries
the whole bundle between objects, and behaves like a bus for connectivity purposes.

### Harness type definitions live outside the `.SchDoc`

Each document has a sibling `<name>.Harness` file — plain text, one type per line:

```
AGND_Domain=PULSE_OUT,PULSE_IN,AGND,VDD5,STDN,TEMPOUT
Channel_interface=PGND,V_LASER_P,3V3_P,AGND,VDD5_A
PGND_Domain=3V3_P,OP_OUT,PGND,V_LASER
```

`TypeName=Member1,Member2,…`. The members are the signals the bundle carries.

### Harness-typed ports and entries

A `PORT` (`RECORD=18`) carries `HarnessType=<type>` when the port is a harness rather than a
single signal:

```
RECORD=18 | Name=CHANNEL | HarnessType=Channel_interface
```

That is how a harness crosses a sheet boundary: the port connects by name as usual, and the
signals it carries are the members of its type.

### Harness types nest

A harness entry may itself be harness-typed:

```
RECORD=216 | OwnerIndex=28 | Name=PGND | HarnessType=PGND_Domain
```

Here the `PGND` member of `Channel_interface` is not a single signal but a nested bundle of
`PGND_Domain`'s members. Resolving a harness to its constituent signals is therefore
recursive, and an implementation that flattens only one level will silently drop the nested
members. `HELIOS-R` exercises exactly this case.

### Designs available for testing

| Design | Licence | Harness records (215/216/217/218) | Notes |
|---|---|---|---|
| `pulp-bio/HELIOS-R` | Solderpad 0.51 / Apache-2.0 | main 1/5/1/1, channel 5/25/5/3 | 5 files, 277 KB; nested types; also 9-way multi-channel |
| `ohwr/utca-rtm-8-sfp` | CERN-OHL-1.1 | 51/168/45/119 | densest harness usage |
| `ohwr/amc-carrier-2-sl` | CERN-OHL-1.1 | 81/376/76/78 | harness at board scale |
| `qfsae/pcb` | MIT | 115/359/115/66 | dedicated harness sub-project |
| `memristor/electronics` | Apache-2.0 | 2/6/2/2 | smallest harness sheet, 13.8 KB |
