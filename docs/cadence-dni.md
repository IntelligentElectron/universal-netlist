# How Cadence Records Do Not Install

A Cadence design records Do Not Install two different ways, and they do not
behave alike. One travels with the part into every file the design exports. The
other is held in the schematic's own database and reaches the BOM alone. A tool
that reads only the exported netlist sees the first and cannot see the second, no
matter how carefully it looks, because the second was never written there.

This page describes both, what each leaves on disk, and what that means for a
design whose netlist is the thing you hand to somebody else. For the byte-level
layout of the streams involved, see
[section 11 of the DSN format specification](dsn-format.md#11-cis-variant-store).

MCP queries read the `.DSN` schematic directly. DAT examples below explain the
reference exports used by CLI coverage and regression tests; DAT parsing is
dormant in MCP.

## The two mechanisms

| | A. Marker in the part's value | B. CIS variant |
|---|---|---|
| Where the designer sets it | The component's **Value** property, typed as text | **Tools → Variant** / Alternate BOM, as a group |
| Where it lives on disk | The value string itself | `CIS/VariantStore` inside the `.DSN` |
| Reaches the `.DSN` | Yes | Yes |
| Reaches `pstchip` / `pstxprt` / `pstxnet` | **Yes** | **No** |
| Reaches the CIS BOM | Yes | Yes |
| Recoverable from the `.dat` triad alone | Yes | **No** |

Both are read for the selected assembly, and a component flagged by either reports
`dns: true`. A design may use one, the other, or both at once.

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

## B. A CIS variant

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
| Parts the design leaves off the board | 77 | 291 |
| Present in `pstxprt.dat` | 77/77 | 289/291 |
| Present in `pstxnet.dat` | 77/77 | 289/291 |
| Carrying any marker in the `.dat` triad | **0/77** | **0/291** |

Their exported part names read `R_R0402_DISCRETE_10K` and `CC_C0402_0.7PF`. There
is nothing in them to find.

MCP queries read the flag from the `.DSN` schematic. The retained DAT parser also
reads the nearby schematic for variant flags when building regression references;
that internal path is not exposed to MCP clients.

## One design, both mechanisms

`LAUNCHXL-CC1310` uses both, which is what makes it a useful reference. Its
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
and the netlist alone has never been able to answer.

## Selecting an assembly

Call `list_variants` with the `.DSN` path first. It returns `<Default>` and every
native BOM variant found under `CIS/VariantStore/BOM`. When native variants exist,
every design query requires one explicit selector:

- `<Default>` reads the core schematic and only its intrinsic value/property DNS
  markers.
- A native variant reads that variant's exact group-membership stream, applies
  only those groups, and then combines the result with intrinsic markers.

Variant names match case-insensitively but retain their native spelling in
results. An omitted or unknown selector is an error; the server never guesses
which assembly the caller meant.

## Limits

- **Graphical text is invisible.** A `DNP` drawn on the sheet as free-floating
  text, with no property behind it, exists in no file as anything but a drawing.
  Put the marker in the Value, or use a variant.
- **`BOMPartData` is not a stuffed list.** Each `CIS/VariantStore/BOM/<variant>/BOMPartData`
  is decoded but deliberately unused: on `reServer J2032` none of its 30 ids are
  occurrence ids at all, and on `LAUNCHXL-CC1310` the ids that do resolve include
  parts the design does not stuff. Section 11.4 of the format specification has
  the measurements.

## See also

- [DSN format specification, section 11](dsn-format.md#11-cis-variant-store) - byte layout of the variant store, the occurrence numbering, and its join to a refdes
- [DNS Detection](schemas/shared-types.md#dns-detection) - the markers and phrases recognised across all formats
- [Net Naming Conventions](net-naming-conventions.md#dns-do-not-stuff-markers) - how to mark parts so every reader agrees
