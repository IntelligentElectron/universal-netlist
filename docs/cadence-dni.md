# How Cadence Records Do Not Install

A Cadence design records Do Not Install three different ways, and they do not
behave alike. One travels with the part into every file the design exports. The
other two stay in the schematic: a property on the part reaches the BOM and
nothing else, and the CIS variant store is the schematic's own database. A tool
that reads only the exported netlist sees the first and cannot see the other
two, no matter how carefully it looks, because they were never written there.

This page describes all three, what each leaves on disk, and what that means for
a design whose netlist is the thing you hand to somebody else. For the byte-level
layout of the streams involved, see
[section 11 of the DSN format specification](dsn-format.md#11-cis-variant-store).

MCP queries read the `.DSN` schematic directly. DAT examples below explain the
reference exports that developer coverage scripts and regression tests compare
against; DAT parsing is dormant in MCP.

## The three mechanisms

| | A. Marker in the part's value | B. Assembly property on the part | C. CIS variant |
|---|---|---|---|
| Where the designer sets it | The component's **Value** property, typed as text | A part property the library provides (`ASSY`, `INSTALL`, ...) | **Tools → Variant** / Alternate BOM, as a group |
| Where it lives on disk | The value string itself | The part's property list in the page stream | `CIS/VariantStore` inside the `.DSN` |
| Reaches the `.DSN` | Yes | Yes | Yes |
| Reaches `pstchip` / `pstxprt` / `pstxnet` | **Yes** | **No** | **No** |
| Reaches the CIS BOM | Yes | As a column, where the BOM template asks for it | Yes |
| Recoverable from the `.dat` triad alone | Yes | **No** | **No** |

All three are read for the selected build, and a component flagged by any of them
reports `dns: true`. A design may use one, two, or all of them at once. A variant
that explicitly puts a part on the board overrides that part's own value or
property: the group is the instruction for the build being read, and the property
is the base state it overrides.

## A. A marker in the part's value

The designer writes the marker into the component's Value, so it becomes part of
the identity Cadence carries everywhere:

```
R11    value "10K,DNI"        ->  pstxprt part name  RESISTOR_..._DNI
C24    value "DNM"            ->  pstxprt part name  CAPACITOR_CAPC1005X60B2N_DNM
R118   value "10K_NC"         ->  pstxprt part name  RES_..._NC
C16    value "DNM_0402"       ->  pstxprt part name  CAPACITOR_..._DNM_0402
```

Because the value propagates, so does the marker. This is the mechanism the
`.dat` triad can express, and the recognised markers and phrases are listed under
[DNS Detection](schemas/shared-types.md#dns-detection).

The marker is stripped out of the reported value (`"10K,DNI"` reads back as
`"10K"`), but the flag is set first, so cleaning the value does not lose the fact.

## B. An assembly property on the part

Many libraries give every part a property that holds its assembly option, and
the designer sets it per part. The property's name is the library's choice, and
the fixtures alone spell it five ways:

```
reComputer J201     ASSY=DNP          174 parts, ASSY blank on the fitted ones
BeagleBone Black    ASSY=DNI           37 parts
CutiePi             ASSY_OPT=DNP       39 parts, beside 22 whose value carries a marker
OpenCellular SDR    Assembly=DNP      158 parts, Assembly=MOUNT on the fitted ones
Parallella          BuildOptions=DNI, INSTALL=DNI
```

The parser reads every property on the part other than its value and flags the
part when one carries a marker on its own, so the property's name never has to
be known in advance. Two spellings are deliberately left out here: `NC` alone
names a normally-closed contact and `NF` alone is nanofarads, and neither takes a
part off the board when it stands in a property. A property left blank shows as
its own name in angle brackets (`<DNP>`) and is not a marker either.

Nothing about the property reaches the exported netlist. On the three Jetson
carrier boards that use it exclusively, every part it marks keeps an ordinary
part name in `pstxprt.dat` and both of its pins in `pstxnet.dat`, and the DAT
reference reports all of them fitted. The schematic is the only place the answer
exists.

## C. A CIS variant

Variants are a database feature. Groups collect occurrence-level stuffed or
unstuffed states, and each named BOM variant records exactly which groups make up
that assembly. The alternate BOM CIS generates writes the resulting unstuffed
parts with Quantity 0. Nothing is written into the part's value, its name, or its
properties.

**A part unstuffed this way is indistinguishable from a stuffed one in the
exported netlist.** It keeps an ordinary `VALUE` in `pstchip.dat`, an ordinary
part name in `pstxprt.dat`, and both of its `NODE_NAME`s in `pstxnet.dat`. It is
not omitted, not annotated, and not marked. Measured on the two fixture designs
that use variants exclusively:

| | reServer J2032 | reServer J401 |
|---|---|---|
| Parts the design's variant leaves off the board | 77 | 291 |
| Present in `pstxprt.dat` | 77/77 | 289/291 |
| Present in `pstxnet.dat` | 77/77 | 289/291 |
| Carrying any marker in the `.dat` triad | **0/77** | **0/291** |

Their exported part names read `R_R0402_DISCRETE_10K` and `CC_C0402_0.7PF`. There
is nothing in them to find.

MCP queries read the flag from the `.DSN` schematic. The retained DAT parser also
reads the nearby schematic for variant flags when building regression references;
that internal path is not exposed to MCP clients.

## One design, several mechanisms

`LAUNCHXL-CC1310` uses a value marker, `MPN=DNM` and `Manufacturer=DO NOT MOUNT`
on the part, and a CIS variant, which is what makes it a useful reference. Its
CIS-generated BOM writes 25 part references with Quantity 0. Eleven of them carry
a marker; fourteen do not:

```
C24     CAPACITOR_CAPC1005X60B2N_DNM       marker  -> visible in the .dat triad
R19     RESISTOR_RESC1005X40B2N_DNM        marker  -> visible in the .dat triad
R13     RESISTOR_RESC1005X40B2N_0          value "0"           -> variant only
A1      ANTENNA_PCB_ANTENNA_DN024N_...     value "868MHz/..."  -> variant only
MH1     HOLE_NPL_MTG320_HOLE_3.2MM_NPL     value "HOLE_3.2mm"  -> variant only
```

`R13` is the case worth remembering: a zero-ohm resistor whose value is `0`.
Nothing about it is unusual, and nothing in the exported netlist could ever tell
you it is not fitted.

Selecting the `Standard` BOM variant and reading both mechanisms returns exactly
those 25, with nothing missing and nothing invented, through the schematic parser
and the retained DAT regression path.

## What this means in practice

**Query the `.DSN` schematic.** The variant store is in the schematic. Where
a design's Do Not Install is set through variants, a directory holding only
`pstxnet.dat`, `pstxprt.dat` and `pstchip.dat` does not contain that information
in any form, and no tool can recover it from those files. Cadence exports the
triad into a subdirectory of the schematic's own
(`<design>/allegro/pstxnet.dat`), which the retained regression helper recognizes.

**A netlist you hand to somebody else carries mechanism A only.** If your
downstream consumer needs to know what is not fitted, either send the `.DSN` too,
or use the alternate BOM as the statement of what gets built.

**Which mechanism is yours** is worth knowing before you trust a count. If the
DNI parts in a design are generic R/C/U with ordinary values, it is mechanism B
or C and the netlist alone has never been able to answer.

## Selecting a build

Call `list_designs` first. Each `.DSN` lists its `design_variants`, which are the
builds it has:

- A design that declares no CIS variant lists `<Default>` alone. That is its one
  build: the schematic with every part's own value marker and assembly property
  honoured. `design_variant` is optional for it, and `<Default>` (alias
  `default`) names it explicitly.
- A design that declares CIS variants lists those and nothing else, each with
  `fabrication: true`, because every Cadence BOM variant is a build assembly by
  definition. Every query on it requires `design_variant` as one of those names.
  A native variant reads that variant's exact group-membership stream, applies
  only those groups, and combines the result with the parts' own markers and
  properties, the groups winning where they name a part explicitly.

`<Default>` is refused on a design that declares variants. A CIS variant is the
assembly a BOM is generated for, and nothing in the schematic marks the bare
design as one, so reading it as a build would describe a board with every
variant's parts fitted that is never built. The refusal names the variants to
choose from.

Variant names match case-insensitively but retain their native spelling in
results, which echo it in a top-level `design_variant` field. A declared variant
named `default` takes the plain alias, and the literal `<Default>` always names
the base build. An omitted or unknown selector is an error; the server never
guesses which assembly the caller meant.

The DSN variant store carries group stuffing only. The `BOMPartData` stream beside
each variant is a list of occurrence ids and carries no part substitutions, and
alternate parts in OrCAD CIS live in the CIS database rather than in the
schematic. A Cadence variant therefore changes which parts are fitted and nothing
else, and no Cadence part is ever flagged `alternate_part`.

## Limits

- **Graphical text is invisible.** A `DNP` drawn on the sheet as free-floating
  text, with no property behind it, exists in no file as anything but a drawing.
  Put the marker in the Value, or use a variant.
- **`BOMPartData` is not a stuffed list.** Each `CIS/VariantStore/BOM/<variant>/BOMPartData`
  is decoded but deliberately unused: on `reServer J2032` none of its 30 ids are
  occurrence ids at all, and on `LAUNCHXL-CC1310` the ids that do resolve include
  parts the design does not stuff. It carries no part substitutions either.
  Section 11.4 of the format specification has the measurements.
- **Alternate parts are not in the schematic.** OrCAD CIS records a variant's
  alternate parts in the CIS database, which the `.DSN` does not contain, so the
  parser cannot substitute them and never sets `alternate_part` on a Cadence part.

## See also

- [DSN format specification, section 11](dsn-format.md#11-cis-variant-store) - byte layout of the variant store, the occurrence numbering, and its join to a refdes
- [DNS Detection](schemas/shared-types.md#dns-detection) - the markers and phrases recognised across all formats
- [Net Naming Conventions](net-naming-conventions.md#dns-do-not-stuff-markers) - how to mark parts so every reader agrees
