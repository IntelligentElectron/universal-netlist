# Altium Designer Schematic Format

How Altium Designer schematics are written and how Altium connects and names what they draw:
files and records, geometry, cross-sheet connectivity, net naming, buses, multi-channel sheets,
signal harnesses, components and design variants. Companion to [`dsn-format.md`](dsn-format.md),
which covers Cadence.

## Files

| File | Holds |
|---|---|
| `.PrjPcb` | the project: an INI-like text file listing its documents (`DocumentPath=`), its options, and its design variants |
| `.SchDoc` | one schematic sheet, an OLE compound document of records |
| `.Harness` | the harness types a sheet uses, beside the sheet under the same name |
| `.PrjPcbStructure` | the sheet symbol tree, written when the project is compiled |
| `.PrjPcbVariants` | the alternate parts' symbol data |

A `DocumentPath` is relative to the project, its folders separated by `\`, and may carry further
fields after a `|`.

## Records and streams

A `.SchDoc`'s `FileHeader` stream is a run of records, one per object. Each record is a
four-byte length followed by pipe-delimited key-value pairs and a NUL:

```
|RECORD=27|OWNERINDEX=12|LOCATION.X=410|LOCATION.Y=670|...
```

The first record is the `HEADER`; every other record carries `RECORD=`, its object type. Keys are
written in mixed or upper case depending on the file: `Location.X` and `LOCATION.X` are one key.
Values are Windows-1252 in older files and UTF-8 in newer ones. A value the code page cannot hold
is written a second time under `%UTF8%<key>` in UTF-8, and that copy is the text: `Text=220O` beside
`%UTF8%Text=220Ω`.

`OwnerIndex` names the record that owns this one, counting records from zero after the `HEADER`:
a pin names its component, a sheet entry its sheet symbol, a parameter its component or sheet.

Signal harness records (`215` to `218`) live in a second stream, `Additional`, in the same format.
Its `OwnerIndex` counts its own records. The stream is optional, and a sheet without harnesses may
carry it empty.

| Record | Object |
|---|---|
| `1` | component |
| `2` | pin |
| `15` | sheet symbol |
| `16` | sheet entry |
| `17` | power port |
| `18` | port |
| `25` | net label |
| `26` | bus |
| `27` | wire |
| `29` | junction: a drawn dot; wires connect where they touch, dot or not |
| `31` | sheet: the document's own settings |
| `32` | sheet symbol designator |
| `33` | sheet symbol file name |
| `34` | component designator |
| `37` | bus entry |
| `41` | parameter |
| `215` | harness connector |
| `216` | harness entry |
| `217` | harness type |
| `218` | signal harness |

## Geometry

### Coordinates

A coordinate or size is a whole number of units (1 unit = 10 mil) plus an optional `_Frac` field
in hundred-thousandths of a unit: `Width=44 | Width_Frac=35626` is 44.35626. Locations
(`Location.X_Frac`), polyline vertices (`X1_Frac`) and sizes (`Width_Frac`, `XSize_Frac`,
`PinLength_Frac`, `PrimaryConnectionPosition_Frac`) all carry one. `DistanceFromTop_Frac1` is the
exception: millionths of a 10-unit step.

A wire, bus or signal harness is a polyline: `LocationCount`, then `X1`, `Y1` to `Xn`, `Yn`.

### Objects meet within half a unit

Objects drawn in Altium sit on the grid and meet exactly. Imported designs carry fractional
coordinates, and their objects meet only nearly: up to 0.315 units apart, from metric rounding.
Two objects touch within 0.5 units. Nothing is drawn that close deliberately: the grid is 10 units
and the finest imported pin pitch 2.5.

### Pins

A pin (`RECORD=2`) writes its number as `Designator` and its function as `Name`. It runs
`PinLength` from `Location`, turned by the low two bits of `PinConglomerate` in quarter turns. A
wire joins a pin anywhere along it. Two pins meet only tip to tip, the tip being the end `PinLength`
from `Location`: pins drawn from one point, or overlapping along one line, stay apart.

### Ports

A `PORT` (`RECORD=18`) is a bar `Width` long starting at `Location`, rightward for a horizontal
style and upward for a vertical one (`Style` 4 and above). A wire may land on either end.

### Sheet entries

A `SHEET_ENTRY` (`RECORD=16`) has no location of its own. It is a child of its `SHEET_SYMBOL`
(`RECORD=15`), whose `Location` is its top-left corner and whose `XSize` and `YSize` are its
extent, and is placed by:

| Field | Meaning |
|---|---|
| `Side` | `0` left (the default, usually unwritten), `1` right, `2` top, `3` bottom |
| `DistanceFromTop` | steps of 10 units along that edge from the top-left corner: downward on a vertical edge, rightward on a horizontal one |
| `DistanceFromTop_Frac1` | the fraction of a step in millionths; `500000` is half a step |

A plain entry is a connection point like a pin. An entry in range notation (`AD[0..7]`) or
written `Repeat(NAME)` meets a bus (see Buses); a harness-typed entry meets a signal harness (see
Signal harnesses).

## Connectivity

### Names

Names match ignoring ASCII case: the entry `DC_LINK` meets the port `DC_link`, and net labels,
power ports and harness members match the same way.

Within a sheet, net labels and power ports of one name are one net, and ports of one name are one
net. A port never joins a net label by name: Altium's connectivity guide states that a port called
`Inta` does not connect to a net label called `Inta`; the two must be wired. Sheet entries never
join by name: entries of one name on different symbols lead to different nets.

### Net identifier scope

`HierarchyMode` in the `.PrjPcb` sets how identifiers reach across sheets:

| Scope | `HierarchyMode` | Ports | Net labels | Power ports |
|---|---|---|---|---|
| Automatic | `0` (default) | resolved from the design, below | | |
| Global | `3` | join by name project-wide | join by name project-wide | global |
| Flat | | join by name project-wide | sheet-local | global |
| Hierarchical | `2`, `4` | join only their sheet entry | sheet-local | global |
| Strict Hierarchical | | join only their sheet entry | sheet-local | sheet-local |

Automatic reads the design: sheet entries make it Hierarchical, ports without sheet entries make
it Flat, and neither makes it Global. Under every scope a port meets the sheet entry of its name on
the symbol that placed its sheet ("ports only connect vertically to their corresponding sheet
entries").

A net with no pins, such as a wire between two sheet entries, still carries its links and still
offers its name. A power port links the nets it sits on across sheets whatever those nets are
called.

### How the sheets are joined

Each link a net makes across sheets is an identity:

| Identity | Made by | Joins |
|---|---|---|
| `<instance>` and `<name>` | a port on a document instance; a plain entry, for every channel its symbol instantiates; a `Repeat(NAME)` entry's member `NAME<n>`, for channel `n` | under every scope |
| `<name>` of a port | a port | under Flat and Global scope |
| `<name>` of a power port | a power port | under every scope but Strict Hierarchical |
| bundle and member | a bus member reaching a harness entry or a harness-typed port | under every scope |

An instance is the document no symbol places, then the symbol and channel of each placement on the
way down (see Multi-channel sheets).

### What a net is called

`AllowPortNetNames` (default off) and `AllowSheetEntryNetNames` (default on) decide whether a port
or an entry may name a net. When one net carries several names the strongest wins:

1. a labelled harness member
2. a net label
3. a power port
4. a port
5. a sheet entry
6. a pin name

`PowerPortNamesTakePriority=1` moves the power port to the front. Between two names of one rank
the first in sort order wins.

A net nothing names is called after a pin, `Net<designator>_<pin>`: the lowest designator, ordered
by prefix, then number, then suffix (`R9` before `R11`), and its lowest pin, numbers before names.

A pinless net still names: under `AllowSheetEntryNetNames` an entry on a wire between two entries
names the net the child sheet's pins end up in.

### Sheet numbers on local nets

`AppendSheetNumberToLocalNets=1` suffixes a sheet's own nets with its `SheetNumber`, a parameter
record on the document itself or on its sheet record; an unnumbered sheet writes `*`. A label
`VBAT` on sheet 8 names `VBAT_8`, whether or not another sheet reuses the name. A net is the
sheet's own when no port, harness or scope-global identifier carries it off the sheet; a label
wired into a sheet entry is still the sheet's own. Only designer names are numbered: a label, or a
power port under a scope that makes it local. Pin names (`NetC3_1`) are unique already and stay
bare. A label on a net that leaves through a port, or through a bus reaching a range identifier, is
not numbered. The number follows the net onto another sheet that carries it onward through a port
or harness. A harness member is numbered after the sheet that labels its bundle.

## Buses

A `BUS` (`RECORD=26`) is a polyline that carries several signals at once and connects nothing by
itself. A wire joins it through a `BUS_ENTRY` (`RECORD=37`), a short diagonal from `Location` to
`Corner`, and the wire's net label says which signal that wire is.

A bus leaves the sheet through an identifier in range notation:

| Identifier | Example | Placed |
|---|---|---|
| a port | `LED[0..7]` | by its own location |
| a sheet entry | `AD[0..11]` | on its symbol's edge |
| a harness entry | `DAC[1..2]` | on its connector |
| a `Repeat(NAME)` sheet entry | `Repeat(OUT)` | on its symbol's edge; carries `OUT1`, `OUT2`, ... one per channel |

`AD[0..11]` carries `AD0` to `AD11`; a descending range carries the same members. A net label in
range notation on the bus names the bus, and joins every bus on the sheet carrying that label.

A net is on a bus when a wire of its ends on it, or when it is labelled with a member of a range
the bus carries, as a label on the bus or as an identifier the bus reaches: a net label names its
net wherever on the sheet it is drawn. Geometry alone decides which identifiers are on the bus.
Each member net links through the identifiers on its bus, as it would through a plain port or
entry of the member's name. A member no wire labels still crosses: a bus drawn from one symbol's
`A[0..7]` to another's joins the two.

Altium's multi-channel guide states the `Repeat(NAME)` rule: with the symbol `Repeat(CIN,1,4)` and
the entry `Repeat(Headphone)` on a bus `Headphone[1..4]`, "the net Headphone1 will connect to the
channel CIN1, Headphone2 will connect to channel CIN2, and so on". A bus wired to a plain entry
reaches every channel. The bus need not be named after the entry: member `n` of any range reaches
channel `n` when every range on the bus spells one prefix, so `P[8..1]` into `Repeat(IN)` hands
`P3` to channel 3. On a bus carrying two prefixes the entry takes only `NAME<n>`.

A `Repeat(NAME)` entry wired to no bus takes the wire's net label as the bus name: under the label
`L`, channel `n` carries `L<n>`, the sheet's net of that name. Entries `Repeat(VBAT)` and
`Repeat(VIN)` on one wire labelled `VBAT` join channel `n` of both to the net `VBAT<n>`.

Names may carry Altium's overbar escaping: `C\S\` is an active-low `CS`, and `Repeat(C\S\)`
carries `CS1`, `CS2`, ...

## Multi-channel sheets

### Placements and instances

A `SHEET_SYMBOL` (`RECORD=15`) owns two children:

| Record | Meaning | Example |
|---|---|---|
| `32` `SHEET_NAME` | the symbol's designator | `Text=Repeat(AY,1,3)` |
| `33` `SHEET_FILE_NAME` | the child document | `Text=ay.SchDoc` |

A symbol places its child once per channel: once for a plain designator, once per index for
`Repeat(<name>,<start>,<end>)`. Whitespace inside the parentheses varies (`Repeat(AY, 1, 3)`,
`Repeat(AY, 1,3)`). A range of fewer than two indices is a single placement.

A document exists once for every path of channels from a document no symbol places, so a sheet
inside a repeated sheet repeats with it: a sheet placed by two symbols that places a sheet of its
own gives that sheet two instances. A document placed by several plain symbols is multi-channel
exactly as a `Repeat()` one is. Each instance's ports meet the entries of the channel that placed
it, and its entries reach the instances below it.

A plain entry is shared by every channel its symbol places. A `Repeat(<name>)` entry, with no
range, hands one member to each channel (see Buses). `Repeat(...)` appears only on sheet symbol
designators and sheet entries.

`.PrjPcbStructure` records the same sheet symbols. Altium writes it when a project is compiled,
and it is often absent.

### Instance order and rooms

A document's instances are numbered by path, compared level by level: by channel designator in
natural order (case ignored, digit runs compared as numbers, other characters by code), then,
between symbols of one designator, the one later in the project first (a later document, or later
on one sheet). The number is `$ChannelIndex` and `$ChannelAlpha`.

An instance's room is its last level's channel: the symbol's designator for a plain symbol,
`<name><index>` for `Repeat(<name>,...)`. Rooms that repeat are numbered in instance order, so two
symbols designated `buck_boost` give `buck_boost1` and `buck_boost2`. `ChannelRoomNamingStyle=1`
writes those numbers, and `Repeat()` indices, as letters.

### Channel designator format

`ChannelDesignatorFormatString` in the `.PrjPcb` names each channel's components, defaulting to
`$Component_$RoomName`. The format string writes its own separators. Its tokens:

| Token | Meaning | `R5`, room `MPPT2`, channel 2 |
|---|---|---|
| `$Component` | full designator | `R5` |
| `$ComponentPrefix` | leading non-numeric part | `R` |
| `$ComponentIndex` | trailing numeric part | `5` |
| `$RoomName` | room | `MPPT2` |
| `$ChannelIndex` | 1-based channel number | `2` |
| `$ChannelAlpha` | channel letter | `B` |

`$ChannelAlpha` runs `A` to `Z` for channels 1 to 26, then continues through the ASCII characters
after `Z` rather than rolling over to `AA`: channel 27 is `[`, channel 32 a backtick, so `R1[`
through ``R1` ``. Tokens substitute longest first: `$ComponentPrefix` is not `$Component` followed
by `Prefix`.

Formats in use:

```
$Component_$RoomName
$Component$ChannelAlpha
$Component.$ChannelIndex
$Component_$ChannelIndex
$Component.$RoomName
$ComponentPrefix_$ChannelIndex_$ComponentIndex
```

### Net names in a channel

A net that stays inside one channel is named the way the channel's designators are, by the
channel designator format applied to its name: under `$Component$ChannelAlpha` the label `BIAS`
names `BIASB` in channel 2, and under `$ComponentPrefix_$ChannelIndex_$ComponentIndex` the label
`V_OUT` names `V_OUT_1_` in channel 1. A net named after a pin is rebuilt around the channel's
designator: `NetDD12_5` becomes `NetDD12_AY1_5`. A supply keeps its name, and so does a signal a
single placement's parent wires to every channel.

## Signal harnesses

A signal harness bundles several signals into one drawn connection. Four records in the
`Additional` stream participate:

| Record | Name | Key fields |
|---|---|---|
| `215` | Harness Connector | `Location.X/Y`, `XSize`, `YSize`, `PrimaryConnectionPosition`, `HarnessConnectorSide` |
| `216` | Harness Entry | `Name`, `DistanceFromTop`, `DistanceFromTop_Frac1`, `Side`, optional `HarnessType` |
| `217` | Harness Type | `Text`: the type name, e.g. `Channel_interface` |
| `218` | Signal Harness | polyline |

A connector (`215`) owns the entries (`216`) that follow it in the stream, each naming one member.
`OwnerIndex` on an entry is often unwritten. The harness type (`217`) names the bundle. The signal
harness (`218`) carries the whole bundle between objects. A sheet entry that meets a harness is a
`FileHeader` record, placed on the symbol its `OwnerIndex` names.

### Placement

A connector is a box drawn down and right from its `Location`, `XSize` wide and `YSize` tall.
`HarnessConnectorSide` names the edge its bundle leaves from, and the entries sit on the opposite
edge unless an entry's own `Side` names one:

| Value | Edge | Bundle leaves at | Entries, by default |
|---|---|---|---|
| `0` or unwritten | left | `PrimaryConnectionPosition` units below the top | right edge |
| `1` | right | `PrimaryConnectionPosition` units below the top | left edge |
| `2` | top | `PrimaryConnectionPosition` units right of the left | bottom edge |
| `3` | bottom | `PrimaryConnectionPosition` units right of the left | top edge |

An entry sits `DistanceFromTop` steps of 10 units along its edge, plus `DistanceFromTop_Frac1`
millionths of a step, down a vertical edge or right along a horizontal one, as a sheet entry does.

The bundle's point meets a signal harness line, a port, a sheet entry, or an entry of another
connector. Harness lines join where a vertex of one touches any point of another.

### Harness type definitions

Each document has a sibling `<name>.Harness` text file, one type per line:

```
AGND_Domain=PULSE_OUT,PULSE_IN,AGND,VDD5
Channel_interface=PGND,V_LASER_P,3V3_P,AGND
PGND_Domain=3V3_P,OP_OUT,PGND,V_LASER
```

`TypeName=Member1,Member2,...`: the members are the signals the bundle carries. A document
without harnesses has no such file.

### Harness-typed ports and entries

`HarnessType=<type>` marks a sheet entry, a port or a harness entry as a bundle rather than a
single signal:

```
RECORD=16 | Name=CHANNEL | HarnessType=Channel_interface
```

A harness-typed sheet entry is placed as any sheet entry is. It carries its type's members across
the boundary, and a member shared by every channel stays shared.

### Bundles and their nets

The harness type and its entries are, in Altium's words, "names of the containers that carry the
nets, not the names of the nets themselves". A member name is unique only inside its bundle: two
harnesses of one type, each with an entry `SIGNAL`, carry two signals. A bundle is identified by
what it reaches:

- a **harness-typed port**: the sheet entry of that name on the channel that placed the sheet, and
  under Flat and Global scope the ports of that name anywhere;
- a **harness-typed sheet entry**: the port of that name in every instance the symbol places;
- an **entry of another connector**: the bundle is that member of the other connector's bundle
  (see Harness connectors nest);
- a **signal harness line**: everything meeting the line is one bundle;
- none: the bundle is local to its sheet instance.

Entries of one bundle sharing a name are one net, whatever the wires reaching them are labelled.
A bundle may go by different names at its two ends (`POWER_UL` into a sheet, `POWER` out of it); a
harness line drawn between the two sheet entries makes them one bundle.

A **net label on the signal harness line** names the harness: every net it carries is called
`<harness label>.<entry name>`.

Within a sheet, entries carrying one signal of one bundle join whatever the wires are labelled.
Across sheets a bundle follows the identities above, per document instance.

### Harness connectors nest

A connector's primary may meet an entry of another connector, directly or through a harness line.
Its bundle is then that member of the other connector's bundle: a connector reached from the entry
`PHASE_A` of a connector leaving through the port `BRIDGE` carries the bundle `PHASE_A` of
`BRIDGE`, and its entries are that bundle's signals. An entry meeting a harness-typed port or sheet
entry carries a bundle the same way; an entry meeting a plain port is one signal. Wherever two
bundles join, their members of one name join too, so nesting resolves at any depth.

### Harness types nest

A harness entry may itself be harness-typed:

```
RECORD=216 | Name=PGND | HarnessType=PGND_Domain
```

The `PGND` member of `Channel_interface` is then a nested bundle of `PGND_Domain`'s members, so a
harness resolves to its signals recursively. The nesting is declared on the entry record, not in
the `.Harness` file, which lists member names only. A nested member is qualified by the entry that
reaches it (`PGND.OP_OUT`), so one signal name in two branches is two signals.

## Components

A component record (`RECORD=1`) is one drawn instance of one part of a library component. It owns:

| Record | Field | Holds |
|---|---|---|
| `34` designator | `Text` | the designator, `R5` |
| `41` parameter | `Name`, `Text` | a parameter: `Value`, `Manufacturer`, `Manufacturer Part Number`, `Comment`, and any other |
| `2` pin | `Designator`, `Name` | a pin's number and function |

The component record itself carries `ComponentDescription`. A `Comment` written `=<parameter>`
shows that parameter's value: `=Value` is the part's value.

**Multi-part components.** A multi-part component (a dual op-amp, a resistor array, an FPGA split
into banks) writes every part's pins under every instance, with `OwnerPartId` on the pin and
`CURRENTPARTID` on the instance saying which part that instance draws. Only the drawn part's pins
connect. The instances of one component, on one sheet or across sheets, are one component, and a
part drawn on no sheet still has its pins, unconnected.

**Display modes.** A component with alternate display modes writes one pin set per mode, at that
mode's graphic, with `OwnerPartDisplayMode` on the pin and `DISPLAYMODE` on the instance (both
unwritten for the default mode, 0). Only the drawn mode's pins connect; the other modes' pins sit
wherever their graphic would put them, possibly on another net's wire.

**Duplicate designators.** Two instances with the same designator and the same part are a
duplicate designator, which Altium's compiler reports as an error: one physical part cannot put one
pin on two nets. Unannotated parts (designator `X?`) repeated across sheets are duplicates too.

## Design variants

A variant is an overlay on the core project. The fitted state, alternate parts and per-part
parameter overrides live in numbered, INI-like sections of the `.PrjPcb`:

```ini
[ProjectVariant2]
Description=ASSEMBLY_B
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

`Description` is the variant's name and `AllowFabrication` its fabrication flag. Each
`VariationN` row is pipe-delimited, and `Kind` says what the variant does to the part:

| `Kind` | Meaning |
|---|---|
| `0` | Fitted, written explicitly |
| `1` | Not Fitted |
| `2` | Alternate Part; `AltLibLink_DesignItemID` names the substituted library item |

A parameter override is a `ParamVariationN=ParameterName=<name>|VariantValue=<value>` row, paired
to its part by the `ParamDesignatorN=<designator>` row of the same number. A field without an
override keeps its base value. A `Comment` of `=Value` is Altium's expression for "show the Value
parameter".

Rows name parts by designator, ignoring case. A repeated sheet's rows carry the channel's
designator (`D1_CH1` above), and a designator repeated in several rows receives every parameter
row paired to it.

The binary `.PrjPcbVariants` sidecar stores the alternate parts' symbol data; which part a variant
fits, and with which parameters, is in the project file.
