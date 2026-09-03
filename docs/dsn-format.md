# OrCAD .DSN Binary Format Specification

This document describes the binary format of OrCAD Design (`.DSN`) files as understood by our parser. It is derived from reverse engineering, cross-referencing with [OpenOrCadParser](https://github.com/Werni2A/OpenOrCadParser), and validation against real-world designs.

Each section marks its confidence level:

- **VERIFIED**: Confirmed by parsing 10+ real designs with correct output
- **OBSERVED**: Consistent pattern across designs, but not independently documented
- **HEURISTIC**: Works in practice but the reasoning is inferred, not proven
- **UNKNOWN**: Bytes we skip or structures we don't parse

## Table of Contents

1. [Container Format (CFBF)](#1-container-format-cfbf)
2. [OLE Stream Layout](#2-ole-stream-layout)
3. [Primitive Encodings](#3-primitive-encodings)
4. [Record Framing: Prefix System](#4-record-framing-prefix-system)
5. [Structure Type IDs](#5-structure-type-ids)
6. [Library Stream](#6-library-stream)
7. [Page Stream](#7-page-stream)
8. [Hierarchy Stream](#8-hierarchy-stream)
9. [Package Streams](#9-package-streams)
10. [Cache Stream](#10-cache-stream)
11. [CIS Variant Store](#11-cis-variant-store)
12. [Netlist Assembly Logic](#12-netlist-assembly-logic)
13. [Known Gaps and Limitations](#13-known-gaps-and-limitations)

---

## 1. Container Format (CFBF)

**Confidence: VERIFIED**

A `.DSN` file is a CFBF (Compound File Binary Format) container, also known as OLE2 or Structured Storage. This is a Microsoft format (documented in [MS-CFB]) used by many legacy applications. Inside it are named **streams** (binary blobs) organized in a directory tree.

All multi-byte integers within streams are **little-endian**.

Our parser uses `OleReader` (in `src/parsers/ole-reader/`) to open the CFBF container and read individual streams by path.

---

## 2. OLE Stream Layout

**Confidence: VERIFIED**

The parts of the directory tree we read:

```
Root Entry/
  Library                          # String table, fonts, page settings
  Cache                            # Cached LibraryPart + Package for ALL components
  Views/
    {ViewName}/
      Pages/
        {PageName}                 # One stream per schematic page
      Hierarchy/
        Hierarchy                  # Canonical net name list + occurrence -> dbId
  Packages/
    {PackageName}                  # Per-package: PartCell + LibraryPart[] + Package
  CIS/
    VariantStore/
      Groups/
        {Group}/{Group}            # Occurrences a variant leaves off the board
```

| Stream | Purpose | Parser Status |
|--------|---------|---------------|
| `Library` | String table (`strLst`), fonts, page settings | Parsed (strLst only) |
| `Views/{name}/Pages/{page}` | Components, wires, nets, aliases per page | Fully parsed |
| `Views/{name}/Hierarchy/Hierarchy` | Canonical flat net name list | Partially parsed |
| `Packages/{name}` | Package + Device[] + LibraryPart[] | Fully parsed |
| `Cache` | LibraryPart + Package definitions for all components | Parsed (Packages + LibraryParts) |
| `CIS/VariantStore/Groups/{g}/{g}` | Do Not Stuff set a variant declares | Fully parsed (section 11) |

That is a small part of what a `.DSN` actually holds. Surveying the top-level entries of all 11 Cadence fixtures, these appear in **every** design and none of them is read:

`AdminData`, `Cells`, `Cells Directory`, `ExportBlocks`, `ExportBlocks Directory`, `Graphics`, `Graphics Directory`, `HSObjects`, `Packages Directory`, `Parts`, `Parts Directory`, `Symbols`, `Symbols Directory`, `Views Directory`

And these appear in some designs only: `DsnStream` and `NetBundleMapData` (10 of 11), `BundleMapData` and `CIS` (7 of 11). `CIS` in particular is not a fixed feature of the format, so a design without it is normal rather than damaged. Of the 7 that carry it, 3 declare an actual variant group; the variant store is read for the Do Not Stuff set it holds (section 11), and the rest of `CIS` is not.

### Stream discovery

We find streams by regex-matching paths from `ole.listAllEntries()`:
- Pages: `/^Views\/.*\/Pages\//` with `entry.type === 2` (stream)
- Hierarchy: `/^Views\/.*\/Hierarchy\/Hierarchy$/`
- Packages: `/^Packages\//`, excluding `_pDboPackage_Copy_` entries
- Library: path equals `"Library"` or ends with `"/Library"`
- Cache: path equals `"Cache"`

---

## 3. Primitive Encodings

### 3.1 Strings

**Confidence: VERIFIED**

Every string the DSN parsers read uses length-prefixed, null-terminated encoding:

```
uint16   length       # byte count of string content (not including null)
char[]   content      # ASCII (or Latin-1 in Library strLst)
uint8    0x00         # null terminator
```

Special case: if `length == 0`, only the null terminator byte (0x00) is present. The reader checks that byte really is 0 and throws if it is not.

The Library stream's `strLst` uses Latin-1 encoding. All other streams use ASCII.

`BinaryReader` also carries two other forms ported from the C++ reference, `readStringZeroTerm` (null-terminated, no length prefix, 3500-char cap) and `readStringLenTerm` (length-prefixed, no terminator, 400-char cap). Neither is called by any DSN parser today.

#### The 400-character cap is load-bearing

`readStringLenZeroTerm` throws when the length prefix exceeds 400. That bound is not decoration: it is the mechanism that stops a mis-framed read from consuming the rest of a stream as one absurd string, and it is what actually ends the Cache stream's sequential walk on three fixtures. CutiePi gives up with a length of 17152 and reServer J2032 with 65312, at which point the brute-force scanner of section 10.3 takes over. A missing null terminator throws for the same purpose.

### 3.2 Integers

**Confidence: VERIFIED**

All little-endian: `uint8`, `int16`, `uint16`, `int32`, `uint32`. No 64-bit integers observed.

### 3.3 Coordinates

**Confidence: VERIFIED**

Schematic coordinates are `int16` or `int32` depending on context, and the width is a property of the structure, not of the coordinate:

| Structure | Field | Width |
|---|---|---|
| PlacedInstance | `loc_x`, `loc_y` | `int16` |
| T0x10 (pin) | `point_x`, `point_y` | `int16` |
| GraphicInst (Global/Port/OPC) | `loc_x/y`, bbox `x1/y1/x2/y2` | `int16` |
| SymbolDisplayProp | `x`, `y` | `int16` |
| Wire | `start_x/y`, `end_x/y` | `int32` |
| Alias | `loc_x`, `loc_y` | `int32` |
| SymbolPin | `start_x/y`, `hotpt_x/y` | `int32` |

Wire endpoints are read as `int32` in the Wire body itself. Alias is a separate structure that also uses `int32`; the two are independent.

---

## 4. Record Framing: Prefix System

**Confidence: VERIFIED (structure), HEURISTIC (auto-detection)**

Every structure record in a DSN stream is wrapped in a **prefix chain**. This is the most important concept in the format: user properties (MPN, Value, etc.) are encoded in the prefix, not in the record body.

### 4.1 Long Prefix (9 bytes)

```
Offset  Size  Field
------  ----  -----
0x00    1     Structure type ID (uint8)
0x01    4     Byte offset to end of enclosed data (uint32)
0x05    4     Unknown (OBSERVED: always 0x00000000)
```

The byte offset is relative to the position after the 9-byte header. It defines a "checkpoint boundary" used to validate parsing progress.

The trailing four bytes are skipped, not read. They were zero in every one of the 242 `Packages/` streams across the fixture corpus, never a copy of the byte offset. OpenOrCadParser treats them the same way, as unknown data with a commented-out assertion that they are zero.

### 4.2 Short (Final) Prefix (3 + 8N bytes)

The last prefix in the chain uses a different format:

```
Offset  Size  Field
------  ----  -----
0x00    1     Structure type ID (uint8)
0x01    2     Count N of name/value pairs (int16)
              if N >= 0:
0x03    8*N     Per pair:
                  uint32  strLst name index
                  uint32  strLst value index
```

These `(name_idx, val_idx)` pairs are indices into the string table in the Library stream. This is where MPN, Value, PCB Footprint, CLASS, and all other user-defined part properties live.

### 4.3 Prefix Chain

A structure has 1..N prefixes. The first N-1 are long prefixes (9 bytes each). The last one is a short prefix. All must share the same type ID.

**HEURISTIC**: Our parser auto-detects the prefix count by trying counts from 10 down to 1, accepting the first count that parses without error. This works reliably but is brute-force. The actual rule governing how many prefixes a structure has is unknown. The OpenOrCadParser C++ reference uses the same approach.

### 4.4 Preamble (optional)

**Confidence: VERIFIED**

After prefixes, a 4-byte magic sequence may appear:

```
FF E4 5C 39  [uint32 payload_length]  [payload_length bytes]
```

This serves as a separator between prefix data and the structure body. Not all structures have a preamble. Our parser attempts to read it and silently skips if the magic bytes don't match.

### 4.5 Checkpoints

**Confidence: OBSERVED**

Each long prefix's byte offset defines a checkpoint boundary. As the parser reads through the structure body it calls `checkpoint()` at the points where a boundary is expected.

`checkpoint()` is advisory, not a validator. It looks for an unparsed boundary whose stop offset equals the current position, marks it parsed if it finds one, and returns silently if it does not. It never throws, so a body that has drifted off the true layout is not caught here. What the boundaries actually buy is navigation:

- `skipToNextBoundary()` jumps to the nearest unvisited boundary at or after the current position. This is a normal-path tool, not error recovery: it is how LibraryPart steps over the graphical primitives it cannot parse (section 9.3).
- `readRestOfStructure()` jumps to the furthest boundary, which is how `skipStructure()` steps over a structure whose body we never decode.

---

## 5. Structure Type IDs

**Confidence: VERIFIED (values from OpenOrCadParser, confirmed by parsing)**

The full list is `src/parsers/cadence/dsn/structure-types.ts`, ported from `Enums/Structure.hpp`. The `Body` column says whether we decode the structure's body and keep anything from it. A `no` means the prefix chain is read and the body jumped over by `skipStructure()`. T0x34 and T0x35 are marked `walk`: they carry no prefix chain at all, so their fields are stepped through purely to advance the read position and every value is discarded.

| ID (hex) | ID (dec) | Name | Purpose | Body |
|----------|----------|------|---------|------|
| `0x02` | 2 | SthInPages0 | Unknown sub-structure in pages | no |
| `0x06` | 6 | PartCell | Part cell in Package streams | no |
| `0x0A` | 10 | Page | Page-level wrapper | yes |
| `0x0B` | 11 | PartInstance | Part instance (unused by us) | no |
| `0x0C` | 12 | DrawnInstance | Hierarchical drawn page instance | no |
| `0x0D` | 13 | PlacedInstance | Component placed on schematic | yes |
| `0x10` | 16 | T0x10 | Pin instance on a placed component | yes |
| `0x14` | 20 | WireScalar | Single-signal wire | yes |
| `0x15` | 21 | WireBus | Bus wire | yes |
| `0x17` | 23 | Port | Port symbol | yes |
| `0x18` | 24 | LibraryPart | Library symbol definition | yes |
| `0x1A` | 26 | SymbolPinScalar | Individual symbol pin | yes |
| `0x1B` | 27 | SymbolPinBus | Bus-type symbol pin | yes |
| `0x1D` | 29 | BusEntry | Bus entry point | no |
| `0x1F` | 31 | Package | Package definition | yes |
| `0x20` | 32 | Device | Device within a package | yes |
| `0x21` | 33 | GlobalSymbol | Global power symbol definition | no |
| `0x22` | 34 | PortSymbol | Port symbol definition | no |
| `0x23` | 35 | OffPageSymbol | Off-page connector symbol definition | no |
| `0x25` | 37 | Global | Global power connector instance | yes |
| `0x26` | 38 | OffPageConnector | Off-page connector instance | yes |
| `0x27` | 39 | SymbolDisplayProp | Display property on a symbol | yes |
| `0x31` | 49 | Alias | Wire alias (net name label) | yes |
| `0x34` | 52 | T0x34 | Primitive graphics (line/shape) | walk |
| `0x35` | 53 | T0x35 | Primitive graphics (polyline/shape) | walk |
| `0x40` | 64 | TitleBlockSymbol | Title block symbol definition | no |
| `0x41` | 65 | TitleBlock | Title block instance | no |
| `0x4D` | 77 | ERCObject | Electrical rules check marker | no |
| `0x62` | 98 | PinShapeSymbol | Pin shape symbol definition | no |
| `0x67` | 103 | NetGroup | Net group | no |

---

## 6. Library Stream

**Confidence: VERIFIED (header layout), OBSERVED (`some_len` always = 24)**

The Library stream contains the global string table used by all prefix property pairs.

### Binary layout

```
Offset  Size        Field
------  ----------  -----
0x00    32          introduction       (null-term string in 32-byte buffer)
                                       e.g. "OrCAD Windows Design"
0x20    2           version_major      (uint16)
0x22    2           version_minor      (uint16)
0x24    4           create_date        (uint32, Unix timestamp)
0x28    4           modify_date        (uint32, Unix timestamp)
0x2C    4           0x00000000         (assumed padding)
0x30    2           text_font_len      (uint16)
...     (text_font_len - 1) * 60      LOGFONTA structures
...     2           some_len           (uint16, OBSERVED: 24 in all 11 fixtures)
...     some_len * 2                   some_data (uint16 each)
...     8           unknown
...     8 * string                     str_lst_part_field entries
...     156         PageSettings       (opaque block, see below)

====== STRING TABLE (strLst) ======
4 bytes  str_lst_len  (uint32, or uint16 in "version A" -- see note)
For each of str_lst_len entries:
    uint16   slen        # string length
    slen bytes  raw      # string content (Latin-1 encoded)
    uint8    0x00        # null terminator

====== ALIAS TABLE ======
uint16   alias_lst_len
For each alias:
    string   alias       (uint16 len + ASCII + 0x00)
    string   package     (uint16 len + ASCII + 0x00)

(Design files only:)
4 bytes  0x00000000
2 bytes  unknown
2 bytes  unknown
string   schematic_name  (uint16 len + ASCII + 0x00)
```

### What we parse

Only the `strLst` string table. Everything before it (header, fonts, some_data, part_field strings, PageSettings) is skipped by computing byte offsets. Everything after it (alias table, design footer) is ignored.

### UNKNOWN: PageSettings

We treat PageSettings as a fixed 156-byte opaque blob. The contents (page size, margins, grid settings, etc.) are not parsed.

### UNKNOWN: LOGFONTA size

We assume each LOGFONTA structure is exactly 60 bytes, matching the Windows LOGFONTA struct size. This is consistent with OpenOrCadParser. Not independently verified.

### UNKNOWN: str_lst_len width

The OpenOrCadParser mentions that "version A" files use `uint16` for `str_lst_len` instead of `uint32`. Our parser always reads `uint32`. We haven't encountered a version A file: every fixture reads `introduction` = `"OrCAD Windows Design"` at version 3.2 or 3.3.

---

## 7. Page Stream

**Confidence: VERIFIED**

Each schematic page is a separate OLE stream under `Views/{name}/Pages/{pageName}`.

### Top-level layout

```
PREFIXES + PREAMBLE (Page-level, type 0x0A)
string    page_name                (uint16 len + 0x00)
string    page_size                (uint16 len + 0x00)     # e.g. "A", "B"
156 bytes PageSettings             (opaque)
uint16    len_title_blocks
          TitleBlock[] sub-records (skipped)
uint16    len_t0x34s
          T0x34[] primitive structures (see 7.3)
uint16    len_t0x35s
          T0x35[] primitive structures (see 7.4)
uint16    len_net_table
          NetTableEntry[] (see 7.5)
uint16    len_wires
          Wire[] sub-records (see 7.6)
uint16    len_placed_instances
          DrawnInstance or PlacedInstance sub-records (see 7.7)
uint16    len_ports
          Port[] sub-records (see 7.8)
uint16    len_globals
          Global[] sub-records + 5 unknown bytes each (see 7.8)
uint16    len_off_page_connectors
          OffPageConnector[] sub-records + 5 unknown bytes each (see 7.8)
... remaining sections (ERC, bus entries, graphics) NOT PARSED
```

### 7.1 TitleBlock

**Confidence: OBSERVED**

Parsed via `skipStructure()` (prefix chain read, then jump to end). Contents not extracted.

### 7.2 PageSettings

See Library stream section. Same 156-byte opaque block.

### 7.3 T0x34 (Primitive Structure)

**Confidence: OBSERVED**

Simple graphical primitive. Does NOT use the prefix/preamble system.

```
1 byte    type (0x34)
4 bytes   struct_len     (uint32)
4 bytes   zeros
4 bytes   id             (uint32)
string    unknown_str    (uint16 len + 0x00)
4 bytes   unknown_int    (uint32)
4 bytes   color          (uint32)
4 bytes   line_style     (uint32)
4 bytes   line_width     (uint32)
```

### 7.4 T0x35 (Primitive Structure)

**Confidence: OBSERVED**

Like T0x34, plus a variable-length point array:

```
[same as T0x34]
uint16    point_count
point_count * 4 bytes   (coordinate data)
```

### 7.5 Net Name Table

**Confidence: VERIFIED**

Maps net names to Cadence database net object IDs (wire IDs). This is the link between wires on the schematic and their assigned net names.

```
For each of len_net_table entries:
    string    net_name    (uint16 len + 0x00)
    uint32    net_id      (Cadence DB object ID, same as Wire.id)
```

Multiple net names can map to the same `net_id` (aliases). Our parser stores all names per ID and resolves the canonical one later.

Net names are uppercased to match Cadence Allegro export convention.

### 7.6 Wire

**Confidence: VERIFIED**

```
PREFIXES (type 0x14 WireScalar or 0x15 WireBus)
PREAMBLE (optional)
BODY:
    uint32    segment_id     # unique per wire segment, used for unnamed net naming
    uint32    id             # net/DB object ID, links to net table
    4 bytes   color          (uint32)
    int32     start_x
    int32     start_y
    int32     end_x
    int32     end_y
    1 byte    unknown
    uint16    len_aliases
              Alias[] sub-records
    uint16    len_symbol_display_props
              SymbolDisplayProp[] sub-records (read but discarded)
    4 bytes   line_width     (uint32)
    4 bytes   line_style     (uint32)
```

**VERIFIED**: `Wire.id` is the net identifier that connects to the page's net name table. All wire segments sharing the same `id` belong to the same logical net.

**VERIFIED**: `Wire.segment_id` is unique per wire segment and is what names an unnamed net, matching Cadence DAT export behavior. A net is a group of segments, so the name is built from the smallest `segment_id` in the group, `N{minSegmentId}`, not from any one segment's own id (section 12.4).

### 7.6.1 Alias (type 0x31)

**Confidence: VERIFIED**

A net name label placed on a wire.

```
PREFIXES (type 0x31)
PREAMBLE (optional)
BODY:
    int32     loc_x
    int32     loc_y
    4 bytes   color          (uint32)
    4 bytes   rotation       (uint32)
    4 bytes   text_font_idx  (uint32)
    string    name           (uint16 len + 0x00)
```

### 7.7 PlacedInstance (type 0x0D)

**Confidence: VERIFIED**

A component placed on the schematic. This is the central structure for netlist extraction.

```
PREFIXES (1..N, type 0x0D)
    Final prefix contains (name_idx, val_idx) pairs
    -> These are the user properties (MPN, Value, etc.)
PREAMBLE (optional)
BODY:
    8 bytes   unknown
    string    pkg_name         # e.g. "RES.Normal", "TPS65950_1AA.Normal"
    uint32    db_id            # Cadence database object ID
    8 bytes   unknown
    int16     loc_x
    int16     loc_y
    4 bytes   unknown          # rotation (uint8) + mirror (uint8) + 2 unknown; parser skips all 4
    uint16    len_symbol_display_props
              SymbolDisplayProp[] sub-records
    1 byte    unknown
    -- checkpoint --
    string    reference        # refdes, e.g. "R1", "U5"
    uint32    part_value_idx   # strLst index for component value (fallback)
    10 bytes  unknown
    uint16    len_t0x10s
              T0x10[] sub-records (pin instances)
    -- checkpoint --
    string    source_package   # package name for pin map lookup
    uint16    section_index    # 0-based section within a multi-section package
    -- checkpoint --
```

**VERIFIED** fields: `pkg_name`, `db_id`, `loc_x`, `loc_y`, `reference`, `part_value_idx`, `source_package`, `section_index`, `t0x10s`, prefix properties.

**UNKNOWN**: The 8 bytes at offset +0x00, the 8 bytes after `db_id` (a symbol bounding box: four int16 as x1, y1, x2, y2), the 4 bytes before `len_symbol_display_props` (includes rotation/mirror per the reference photos, but we don't extract them), the 1 byte after SDPs, and the 10 bytes after `part_value_idx`.

##### section_index

The `uint16` following `source_package` is the instance's 0-based section within a
multi-section package. A single-section part carries `0`; the eight sections of a
`RPAK_10_8RES` resistor pack carry `0`–`7`; a dual transistor carries `0` and `1`.

The OpenOrCadParser reference treats these two bytes as unknown padding
(`printUnknownData(2, ...)` at the end of `StructPlacedInstance::read`). The field was
identified here by dumping every discarded byte block for the eight `RP3` instances of
`BeagleBoard-xM_ORCAD` and correlating against the section order derived independently
from that design's `pstxnet.dat` export: the field reads `0,1,2,...,7` in exactly that
order. Verified across the Cadence fixture corpus — see section 12.3.

#### User property resolution (MPN, Value)

**Confidence: VERIFIED**

User properties are the prefix `(name_idx, val_idx)` pairs (section 4.2). Resolution happens in `component-builder.ts`:

- **Part numbers**: a record stores its pairs in whatever order Cadence wrote them, and
  `read_single_prefix_short` in the C++ reference keeps that order verbatim, so it carries
  no precedence. Precedence is therefore applied by the consumer, which scans the key list
  as the outer loop and the record's pairs as the inner one. Three lists, each in
  precedence order:
  - **`mpn`** — the manufacturer's part number, from `MANUFACTURER_PN_KEYS`:
    `"Manufacturer PN"`, `"MANUFACTURER_PN"`, `"Manufacturer Part Number"`,
    `"Vendor Part Number"`, `"Vendor P/N"`, `"MF_PART_NUMBER"`, `"MPN"`.
  - **`internal_pn`** — the design owner's own number, from `PART_NUMBER_KEYS`:
    `"PART_NUMBER"`, `"Part Number"`, `"PART NUMBER"`, `"PN"`.
  - **`manufacturer`** — from `MANUFACTURER_KEYS`: `"Manufacturer"`, `"MANUFACTURER"`,
    `"Manufacture"`. An MPN identifies a part only within a manufacturer, so this is what
    makes `mpn` a key rather than a string.

  `"MPN"` is in the first list but last within it. It names the field exactly, and is for
  that reason the spelling libraries most often populate by hand with whatever was nearby,
  commonly the library symbol's own name; every more specific spelling is tried first. A
  pair whose value is the empty string is skipped rather than treated as a match, because
  a library may leave a property in place with nothing in it beside a populated one.

  There is no fallback between the three, and none to `source_package`. Each is omitted
  when the record does not carry it. The two part numbers are different namespaces and
  neither can be derived from the other, and a package name in `mpn` would be a footprint
  claiming to be an orderable part.

  Distributor part numbers (`"Mouser Part Number"`, `"Arrow Part Number"`,
  `"Supplier Part Number"`) are read into none of these. A distributor SKU is a third
  namespace again.

  **Divergence from the reference:** the C++ parser does not resolve part numbers at all;
  it stores `nameValueMapping` and stops. This precedence is ours.
- **Value**: three sources, tried in priority order:
  1. Prefix pair with name `"Value"` (primary)
  2. `part_value_idx` in the body (fallback; the `uint32` above)
  3. `part_value` in the LibraryPart's GeneralProperties (library default, section 9.3)

  DNS markers embedded in the resolved value string are then stripped (section 13.7).

### 7.7.1 T0x10 - Pin Instance (type 0x10)

**Confidence: VERIFIED (layout), HEURISTIC (sth encoding)**

Each PlacedInstance contains an array of T0x10 records, one per pin on the schematic symbol.

```
PREFIXES (type 0x10)
PREAMBLE (optional)
BODY:
    uint16    sth              # encodes pin index (see below)
    int16     point_x          # pin X coordinate on schematic
    int16     point_y          # pin Y coordinate on schematic
    uint32    net_id           # Cadence DB net object ID (labeled "maybe_id" historically)
    uint32    unknown_int
    uint16    len_symbol_display_props
              SymbolDisplayProp[] sub-records
    -- checkpoint --
```

#### sth encoding (HEURISTIC)

The `sth` field encodes both a 1-based logical pin index and a no-connect flag:
- If `sth < 32768`: `pin_index = sth`
- If `sth >= 32768`: bit 15 is set (no-connect flag), `pin_index = 65536 - sth`

This encoding is from the OpenOrCadParser reference and confirmed to produce correct pin mappings in all tested designs. Both branches are treated identically for pin map lookup, and the parser keeps only `pin_index`; bit 15 is folded away by the subtraction and never surfaces as a flag.

No-connect is therefore inferred, not read: a pin is called NC when `net_id == 0` and no wire, symbol or overlapping pin claims its coordinate. That is a proxy for bit 15 rather than the mechanism itself, but it reproduces the DAT export's pin sets exactly across the fixture corpus (section 13.5), so nothing currently distinguishes the two rules in practice.

#### net_id semantics (REVISED)

- `net_id > 0 && net_id < 0xFFFFFFFF`: Normal net. Groups pins belonging to the same electrical net across a page. Maps to the page net table.
- `net_id == 0`: Pin has no Cadence DB net object assigned. This does NOT by itself mean no-connect; the pin may still be connected via wire geometry (coordinate overlap), and such a pin is treated as connected. In the format proper the no-connect marker is `sth` bit 15; the parser instead calls a pin NC when `net_id == 0` and geometry claims nothing, as described above.
- `net_id == 0xFFFFFFFF`: Sentinel value. The pin's net is determined by its physical coordinate overlapping a wire endpoint, a wire body segment, a Global/Port symbol bbox, or one of an OffPageConnector's five match points (section 12.4).

**IMPORTANT**: `net_id` values are NOT the same as `Wire.id` values. They are in different Cadence DB object ID spaces. The correspondence between pin netId and wire id is established indirectly through the net name table (both reference the same logical net, but via different IDs).

### 7.8 GraphicInst (Global, Port, OffPageConnector)

**Confidence: VERIFIED (layout), OBSERVED (5 trailing bytes on Global/OPC)**

Global (type 0x25), Port (type 0x17), and OffPageConnector (type 0x26) share a common base structure:

```
PREFIXES (type varies)
PREAMBLE (optional)
BODY:
    uint32    name_str_idx     # strLst index for net name (e.g., "LOL", "VCC_3V3")
    uint32    lib_str_idx      # strLst index for source library path (e.g., "CAPSYM.OLB")
    string    name             # symbol type name (NOT the net name), e.g. "VCC_BAR", "GND_SIGNAL"
    uint32    db_id
    int16     loc_y            # NOTE: Y before X!
    int16     loc_x
    int16     y2               # bounding box upper-right Y
    int16     x2               # bounding box upper-right X
    int16     x1               # bounding box lower-left X
    int16     y1               # bounding box lower-left Y
    uint8     color
    1 byte    unknown
    1 byte    unknown          # possibly structure sub-ID
    1 byte    unknown
    uint16    len_symbol_display_props
              SymbolDisplayProp[] sub-records
    uint8     unknown_flag
              if flag == 0x02: skip one sub-structure (SthInPages0)
    -- checkpoint --
```

`unknown_flag` also takes the values 0x21, 0x22, 0x23, 0x40 and 0x4b, which are structure type IDs. Only 0x02 is acted on; the rest are consumed and ignored.

A **Port** carries **9 further unknown bytes** after that checkpoint, which Global and OffPageConnector do not. Those bytes are inside the structure, unlike the five described next.

After each Global or OffPageConnector record, there are **5 unknown bytes** that are not part of the structure itself. These are read separately in the page parser. Ports do not carry this outer five-byte trailer; their only trailing unknown data is the nine bytes inside the Port structure.

**VERIFIED**: OPCs sharing the same `name_str_idx` represent the same net across pages. For Globals/Ports, `name_str_idx` resolves to the power/ground net name (e.g., "VCC_3V3", "GND"). The parser calls this field `pairingId`, the name it goes by in section 12.4.

### 7.9 SymbolDisplayProp (type 0x27)

**Confidence: VERIFIED**

Display property attached to a symbol (refdes label, value label, etc.).

```
PREFIXES (type 0x27)
PREAMBLE (optional)
BODY:
    uint32    name_idx         # strLst index for property name
    int16     x
    int16     y
    uint16    rot_font_bitfield:
                bits 0-13:  text_font_idx
                bits 14-15: rotation (0=0, 1=90, 2=180, 3=270)
    uint8     prop_color
    2 bytes   visibility       (unknown exact encoding)
    1 byte    assumed 0x00
    -- checkpoint --
```

---

## 8. Hierarchy Stream

**Confidence: HEURISTIC**

The Hierarchy stream at `Views/{name}/Hierarchy/Hierarchy` contains the authoritative flat list of net names for the design. This is used to:
- Resolve cross-page net name aliases (prefer hierarchy name over local alias)
- Disambiguate nets that appear on multiple pages with the same name
- Provide names for pin-to-pin connections (no wire, just overlapping pins)

### Binary layout (partially understood)

```
HEADER:
    1 byte    type
    4 bytes   struct_length    (uint32)
    4 bytes   zeros
    uint16    view_name_length
    view_name_length bytes + 0x00   view_name

SCAN FORWARD to the first 0x43 byte, then REWIND 2 bytes

    uint16    net_count        # the two bytes immediately BEFORE the 0x43

For each net:
    24 bytes  fixed metadata   (UNKNOWN contents)
    uint16    name_length
    name_length bytes + 0x00   net_name
```

Net names are uppercased on read, matching the page net table.

**HEURISTIC**: The "scan for 0x43" approach is fragile. We don't fully understand the header structure between the view name and the net records. The 0x43 byte happens to sit two bytes after the net count in all tested designs, but this is pattern-matching, not spec-based parsing. The whole stream is best-effort: a throw anywhere in it leaves `canonicalNetNames` empty and the rest of the parse continues without hierarchy preference.

**The 24 bytes of "fixed metadata" per net record** are the record's own framing.
Each is a structure in the ordinary sense of section 4: a type byte, its prefix, then
the preamble `FF E4 5C 39` and the uint32 length of its trailing data (zero here),
then the record body. For a net record the body opens with a uint32 dbId, which is
what OpenOrCadParser's `StreamHierarchy` documents for `NetDbIdMapping` (type 67),
and the name follows it. The sequential parser above skips the framing rather than
reading it; the variant store reads it directly, anchoring on the preamble:

```
    1 byte    type              # 66 SthInHierarchy1, 67 NetDbIdMapping
    2 bytes   zeros
    4 bytes   FF E4 5C 39       # preamble magic
    uint32    trailing_length   # 0 in every Hierarchy record observed
    uint32    body[0]
    uint32    body[1]           # type 66 only
```

**Type 66 (`SthInHierarchy1`) is the part occurrence**, which OpenOrCadParser leaves
unidentified. Its body is `{occurrence id, dbId}`, pairing a CIS variant occurrence
with the `PlacedInstance` it stands for. On all 11 Cadence fixtures the count of
type 66 records equals the design's placed-instance count exactly, and every dbId
they name belongs to that design. Section 11.2 is what uses this.

---

## 9. Package Streams

**Confidence: VERIFIED**

Each `Packages/{name}` OLE stream contains package data for one component type.

### Stream layout

```
uint16    len_part_cells
For each part cell:
    PartCell structure (skipped via skipStructure)
    uint16    len_library_parts
    For each library part:
        LibraryPart structure (type 0x18, parsed)

Package structure (type 0x1F, parsed)
```

A LibraryPart that fails to parse is not fatal: the reader rewinds to where the structure began and steps over it with `skipStructure()`, so one unreadable symbol costs its pin names rather than the whole stream. The trailing Package is parsed without that guard, because losing it would lose the pin map the stream exists to provide.

### 9.1 Package (type 0x1F)

**Confidence: VERIFIED**

```
PREFIXES (type 0x1F)
PREAMBLE (optional)
BODY:
    string    name             # e.g. "RES", "OMAP3530"
    string    source_library   # (discarded)
    -- checkpoint --
    string    ref_des          # e.g. "U", "R"
    string    unknown_str1     # (discarded)
    string    pcb_footprint    # e.g. "0402", "BGA-423"
    uint16    len_devices
              Device[] sub-records
    -- checkpoint --
```

### 9.2 Device (type 0x20)

**Confidence: VERIFIED**

Each Device represents one unit of a (possibly multi-unit) component. Contains the physical pin number map.

```
PREFIXES (type 0x20)
PREAMBLE (optional)
BODY:
    string    unit_ref         # e.g. "A", "B", "" (single-unit)
    string    ref_des          # e.g. "U", "R"
    uint16    pin_count
    For each pin:
        Peek int16 at current position:
        if == -1 (0xFFFF):
            read 2 bytes, emit a null placeholder
        else:
            string    pin_name     # e.g. "1", "A5", "GND"
            uint8     pin_config   (bitfield):
                        bit 7:     pin_ignore (1 = ignore this pin)
                        bits 6-0:  pin_group (swap group, 127 = no group)
    -- checkpoint --
```

The `pin_map` array maps logical pin index to physical pin designator. Index 0 corresponds to logical pin 1 (T0x10.pinIndex = 1).

**Divergence from the C++ reference**: `StructDevice.cpp` `continue`s past a `-1` entry without appending to its vector, producing a dense array. We push `null` instead, so `pin_map` always has exactly `pin_count` entries and index `pinIndex - 1` keeps meaning logical pin `pinIndex`. Dropping the entry would shift every pin after it by one. The parallel `pin_ignore` array is filled with `false` at the same position to stay aligned, and `resolvePinNumber` treats a `null` as "this map has no entry here" and tries the other stream.

**Important**: The `Packages/` stream and the Cache stream may contain **different** Device definitions for the same component. See [section 12.1](#121-pin-number-resolution) for Cache fallback when pin counts differ.

### 9.3 LibraryPart (type 0x18)

**Confidence: VERIFIED (layout), HEURISTIC (primitive skipping)**

Contains the schematic symbol definition with functional pin names.

```
PREFIXES (type 0x18)
PREAMBLE (optional)
BODY:
    string    name             # e.g. "RES.Normal", "OMAP3530_1.Normal"
    string    source_library
    -- checkpoint --
    4 bytes   unknown
    uint16    len_primitives   # count of graphical shapes
    ... graphical primitives (Line, Rect, Arc, etc.)
    -- checkpoint --           # <-- we skip to here via futureData.skipToNextBoundary()
    uint16    len_symbol_pins
              SymbolPin[] sub-records, or a bare 0x00 placeholder
    uint16    len_symbol_display_props
              SymbolDisplayProp[] sub-records
    -- checkpoint --
    (optional) GeneralProperties:
        string    implementation_path
        string    implementation
        string    ref_des
        string    part_value      # default component value, e.g. "10K"
        uint8     properties       (bitfield):
                    bit 0: pin_name_visible
                    bit 1: pin_name_rotate
                    bit 2: pin_number_visible (INVERTED: 0 = visible)
        uint8     0x00 (padding)
    -- checkpoint --
```

**HEURISTIC**: The graphical primitives inside LibraryPart use a non-standard format that we cannot parse reliably. We skip them by reading `len_primitives` and then calling `futureData.skipToNextBoundary()` to jump to the checkpoint after the primitives section. This works because the long prefix's byte offset defines where the primitives end.

#### The 0x00 pin placeholder

A slot in the SymbolPin array may hold a single `0x00` byte instead of a structure. Per the C++ reference this marks a "convert view" pin. The byte is consumed and an empty string pushed in that slot, because `pinNames[pinIndex - 1]` has to keep pointing at logical pin `pinIndex`; skipping the slot would shift every later pin name onto the wrong pin.

The `GeneralProperties` block that follows is optional in the literal sense that the parser attempts it inside a `try` and keeps the LibraryPart it has already built if the read throws.

### 9.4 SymbolPin (type 0x1A / 0x1B)

**Confidence: VERIFIED**

```
PREFIXES (type 0x1A SymbolPinScalar or 0x1B SymbolPinBus)
PREAMBLE (optional)
BODY:
    string    name             # functional pin name, e.g. "VIN", "GND", "1"
    int32     start_x          # pin line start X
    int32     start_y          # pin line start Y
    int32     hotpt_x          # connection point X
    int32     hotpt_y          # connection point Y
    uint16    pin_shape        (bitfield):
                bit 0: is_long
                bit 1: is_clock
                bit 2: is_dot
                bit 3: is_left_pointing
                bit 4: is_right_pointing
                bit 5: is_global
                bit 6: is_net_style
                bit 7: is_no_connect
    2 bytes   unknown
    uint32    port_type        (enum):
                0=Input, 1=Bidirectional, 2=Output,
                3=OpenCollector, 4=Passive, 5=ThreeState,
                6=OpenEmitter, 7=Power
    4 bytes   unknown
    uint16    len_symbol_display_props
              SymbolDisplayProp[] sub-records
    -- checkpoint --
```

Only `name` is kept. Everything from `start_x` through the second unknown block is stepped over as one 28-byte skip, so the field breakdown above is the reference layout rather than a description of what the parser decodes. The `pin_shape` bit meanings and the `port_type` enum come from OpenOrCadParser and are not independently confirmed here; nothing in the netlist path depends on them.

---

## 10. Cache Stream

**Confidence: VERIFIED**

The Cache stream contains ALL component definitions for the design: symbol definitions, LibraryParts (pin names), and Packages (pin maps). It is parsed sequentially from the end of the 4-byte header to EOF, or until the walk throws and the scanner of section 10.3 takes over.

Reference: `OpenOrCadParser/src/Streams/StreamCache.cpp`

### 10.1 Cache Header

```
uint16    0x0000           (2 zero bytes)
uint16    unknown          (2 unknown bytes)
```

A Cache of 10 bytes or fewer is treated as empty and skipped without reading the header.

### 10.2 Cache Entry Format

Entries follow sequentially until EOF. Each entry has variable-length metadata followed by a standard structure.

**Variable metadata** (3 format variants, detected via try-based probing):

| Variant | Condition | Layout |
|---------|-----------|--------|
| 1 | Valid string at offset+0 | `string name` directly |
| 2 | Valid string at offset+8 | `uint16 unknown` + `string refDes` + `uint16 unknown` + `string name` |
| 3 | Neither | `uint16 unknown` + `string name` |

The refDes-like descriptors in variant 2 are typically 3-letter codes: "LED", "VDC", "POT", "USB", "BUF".

**Twin ID check:**

```
peek 8 bytes → id0 (uint32LE), id1 (uint32LE)
```

If `id0 != id1`, a sub-loop follows containing package names and source library paths:

```
do {
  uint16    someVal          // 0 = package name, 1/2/3 = source library
  [uint16   mystery_bytes]   // only if no valid string follows directly
  string    someStr          // package name or library path
} while (someVal == 0)
```

**Structure header:**

```
uint32    some_id0          // twin IDs (should be equal)
uint32    some_id1
uint16    structure_type    // matches prefix chain type byte
[PREFIX CHAIN + BODY]       // standard structure (autoReadPrefixes + body)
```

Counting the `structure_type` of every entry the sequential walk reaches, across all 11 fixtures:

| Type | Count | Name |
|---|---|---|
| `0x18` | 640 | LibraryPart |
| `0x06` | 615 | PartCell |
| `0x1F` | 521 | Package |
| `0x4b` | 342 | **unidentified** — not in `structure-types.ts`, and the third most common thing in the stream |
| `0x21` | 74 | GlobalSymbol |
| `0x23` | 62 | OffPageSymbol |
| `0x40` | 12 | TitleBlockSymbol |
| `0x00`, `0x14` | 1 each | almost certainly the walk desynchronising just before it throws, not real entries |

Only `0x18` and `0x1F` are decoded; everything else goes to `skipStructure()`, which is why `0x4b` costs nothing despite its frequency. The counts stop where the sequential walk stops, so on the five designs that fall back to the scanner they describe the head of the stream rather than all of it.

### 10.3 Parsing Strategy

We use a **hybrid sequential + recovery** approach:

1. **Sequential parsing** from the end of the 4-byte header, navigating variable-length metadata per entry. This is the primary strategy and handles the majority of entries.

2. **Brute-force preamble recovery** when sequential parsing throws. The scanner finds each 4-byte preamble magic (`FF E4 5C 39`) in the remaining buffer and works backwards to the start of the record that owns it.

We extract two structure types:
- **Package** (0x1F): Device pinMap arrays for pin number resolution
- **LibraryPart** (0x18): SymbolPin names for pin name enrichment

All other structure types are skipped via `skipStructure()`.

#### Walking back from the magic

The short prefix does not sit at a fixed distance before the preamble. It is `type(1) + int16 pairCount` followed by 8 bytes per (nameIdx, valIdx) pair, and it may be preceded by long prefixes of 9 bytes each. Assuming a fixed 3 bytes only holds for a record with no pairs and no long prefixes.

So the scanner searches two nested distances. For each candidate pair count from 0 up to 64, it checks whether the byte at `magic - 3 - 8 * pairs` is `0x1F` or `0x18` and whether the `int16` after it equals that pair count. When both hold, it steps back in 9-byte strides for up to 10 long prefixes, requiring each stride to repeat the same type byte, and tries to parse from there. The prefix reader validates the chain, so a wrong guess throws and the next candidate is tried.

Section 12.2 explains why this matters: a fixed 3-byte assumption finds every Package but only a minority of LibraryParts, which is how designs once ended up with pin numbers everywhere and pin names nowhere.

#### Measured behaviour per design

`seq entries` is how many entries the sequential walk completed before the scanner took over.

| Design | Cache bytes | seq entries | scan ran | LibraryParts | Packages |
|---|---|---|---|---|---|
| BeagleBoard-xM | 315514 | 307 | no | 85 | 79 |
| BB-Black | 282889 | 263 | no | 75 | 72 |
| BB-Black (BeagleBoard) | 282889 | 263 | no | 75 | 72 |
| CutiePi | 111506 | 11 | yes, at 4848 | 56 | 57 |
| CC13xx | 32827 | 50 | no | 14 | 12 |
| LAUNCHXL-CC1310 | 141722 | 12 | yes, at 43997 | 46 | 41 |
| reComputer J201 | 588002 | 375 | no | 95 | 86 |
| reComputer J202 | 491152 | 217 | no | 65 | 56 |
| reComputer J401 | 500164 | 238 | yes, at 500162 | 65 | 57 |
| reServer J401 | 787193 | 385 | yes, at 787191 | 96 | 87 |
| reServer J2032 | 639194 | 151 | yes, at 616594 | 70 | 59 |

Six designs walk the whole stream sequentially. Of the five that do not, two (`reComputer J401`, `reServer J401`) fail on the last two bytes, which is an end-of-stream artefact rather than a metadata variant. Only CutiePi, LAUNCHXL-CC1310 and reServer J2032 break genuinely mid-stream, and on those the scanner recovers the remainder.

Every design now yields LibraryParts, including CutiePi and LAUNCHXL-CC1310, which is what carries pin function names to 100% in section 13.5.

### 10.4 Priority

When both `Packages/` streams and Cache provide data for the same component, `Packages/` streams take priority for pin map resolution. The Cache is used as fallback for components not covered by dedicated streams.

**"Fallback" undersells it.** A design need not ship `Packages/` streams at all, and the count bears no fixed relation to how many packages the design uses. Counting streams (after excluding `_pDboPackage_Copy_`) against `Packages Directory` entries:

| Design | `Packages/` streams | Directory entries |
|---|---|---|
| BeagleBoard-xM | 161 | 161 |
| BB-Black | **0** | 88 |
| BB-Black (BeagleBoard) | **0** | 88 |
| CutiePi | 67 | 67 |
| CC13xx | 5 | 5 |
| LAUNCHXL-CC1310 | 14 | 16 |
| reComputer J201 / J202 / J401 | 11 | 99 |
| reServer J401 | 11 | 99 |
| reServer J2032 | 29 | 29 |

Both BeagleBone-Black designs have a `Packages` storage with no streams inside it, so every pin number they report comes from the Cache, and the four Jetson carriers get roughly nine tenths of theirs from it. That is why the Cache recovery of section 10.3 matters as much as it does: on those designs it is not a fallback, it is the source.

**Exception**: when the `Packages/` map's length disagrees with the instance's T0x10 count, the Cache map may win instead. A Cache map whose length equals the T0x10 count settles it; failing that, only a `Packages/` map longer than the symbol prefers the Cache. See [section 12.1](#121-pin-number-resolution) for details and an example.

### 10.5 Packages Directory Stream

**Confidence: OBSERVED**

A separate OLE stream named `Packages Directory` contains a list of all package names in the design:

```
6 bytes   stream header    (unknown; entries begin at offset 6)

For each entry:
string    package_name     (uint16 len + ASCII + 0x00)
uint8     0x1F             (Package type marker)
uint8     0x00
8 bytes   timestamp_1      (FILETIME, likely creation date)
8 bytes   timestamp_2      (FILETIME, likely modification date)
uint16    unknown_1        (observed: 0x0003)
uint16    unknown_2        (observed: 0x0002)
```

Starting the walk at offset 6 and requiring the `0x1F` marker after each name consumes every entry cleanly in all 11 fixtures, which is what confirms the entry layout. BB-Black lists 88 packages this way.

The directory contains **no offsets** into the Cache stream. It confirms what packages should exist, but doesn't help find them, which is why section 10.3 has to scan for preamble magic instead of consulting it.

Similarly, `Cells Directory`, `ExportBlocks Directory`, `Graphics Directory`, `Parts Directory`, `Symbols Directory` and `Views Directory` streams exist with analogous structures for their respective object types. All 11 fixtures carry all six, and none is read.

---

## 11. CIS Variant Store

**Confidence: VERIFIED**

OrCAD Capture CIS records design variants under `CIS/VariantStore`. This is where a
variant's Do Not Stuff set lives, and it is the only place it lives: a part an
alternate BOM leaves off the board keeps an ordinary `VALUE` in `pstchip.dat` and
both of its `NODE_NAME`s in `pstxnet.dat`, so neither the DAT path's marker
detection (section 13.7) nor anything on the schematic distinguishes it from a
part that is stuffed.

> This section is the byte layout. For how Cadence records Do Not Install overall,
> which of the two mechanisms a design is using, and why a netlist handed on its own
> cannot carry this one, see [How Cadence Records Do Not Install](cadence-dni.md).

The storage is present in 7 of the 11 Cadence fixtures and holds an actual group in
3 of them; the other 4 carry an empty store, which is what a design that has never
declared a variant writes.

```
CIS/
  VariantStore/
    VariantNames                          # variant, group and bom-<variant> names
    Groups/
      GroupsDataStream                    # index of group names
      {Group}/
        {Group}                           # the group's occurrence list
        UpdateStorageGroupDataStream      # edit log, not the member list
    BOM/
      BOMDataStream
      {Variant}/
        BOMPartData                       # per-variant part data (not read, see below)
        BOMAmbugity                       # Cadence's spelling
```

| Stream | Purpose | Parser Status |
|--------|---------|---------------|
| `CIS/VariantStore/Groups/{g}/{g}` | Occurrences the group names, and their stuff state | Fully parsed |
| `CIS/VariantStore/VariantNames` | Variant and group names | Parsed (not yet surfaced) |
| `CIS/VariantStore/BOM/{v}/BOMPartData` | Per-variant part data | Not read |

### 11.1 Group stream

```
    uint32    payload_length     # the payload's own byte count, not a magic
    payload_length bytes         # latin1 text, fields separated by 0xB0
```

Every occurrence is written `{id}~{state}`:

| Token | Meaning |
|-------|---------|
| leading token, no `~` | A flag (`0` or `1`); not an occurrence |
| `{id}~0` | The group leaves this occurrence off the board |
| `{id}~1` | The group puts it on |
| empty | Section separator; occurrences continue after it |

A group either unstuffs its members or stuffs them, and the name says which:
`DNP` and `DNM` write `~0` throughout, while the feature groups a design switches
between (`RF`, `XDS`, `DebuggerIF`, `Peripherals`) write `~1` throughout. No part
is named by two groups in any fixture. The state is what the parser reads rather
than the group name, so a `BOM_IGNORE` or `DNI` group is handled without being
enumerated; a state other than `0` or `1` has never been observed and is ignored
rather than guessed at.

`reServer J2032` writes its `DNP` group in two sections, so the empty token is
read through rather than treated as the end of the list.

### 11.2 Occurrence ids and the join to a refdes

The ids are a numbering of their own. They are **not** the `dbId` a
`PlacedInstance` carries (section 7.7) and **not** the `INSnnn` of a PST
`C_PATH`; searching a `.DSN` for a PST `INSnnn` value as a uint32 finds nothing.

They resolve through the Hierarchy stream (section 8), whose part occurrence
records pair one with the `dbId` of the instance it stands for. The refdes then
comes from that instance:

```
occurrence id  --Hierarchy type 66-->  dbId  --PlacedInstance-->  refdes
```

Reading it costs parsing the page streams, which is the schematic's whole cost.
The DAT path therefore holds the resolved set for the `.DSN` that produced it and
recomputes it when that file changes, so a query pays it once rather than per call.

### 11.3 What BOMPartData is not

`BOMPartData` is `uint32 payload_length`, then latin1 text split on `0xF9`, whose
first token is an entry count and whose remainder are ids. It is **not** the
variant's stuffed list and is not read:

| Design | Ids | Resolve to an occurrence | Includes parts the DNP/DNM group unstuffs |
|--------|-----|--------------------------|-------------------------------------------|
| LAUNCHXL-CC1310 | 140 | 139 | yes (`MH5`, `R46`–`R49`, `R51`) |
| reServer J401 | 1541 | 1434 | — |
| reServer J2032 | 30 | 0 | — |

Its ids are not always in the occurrence numbering at all, and where they do
resolve they include parts the design does not stuff, so reading it as a stuffed
list would contradict the group that says otherwise.

### 11.4 Measured against a board's own BOM

`LAUNCHXL-CC1310` ships `LAUNCHXL-CC1310_1_3_0_BOM.xlsx`, generated by CIS from
these variants. Twenty-five of its part references carry Part Number `DNM` and
Quantity 0, and the `DNM` group resolves to exactly those twenty-five, with
nothing missing and nothing extra:

`A1 C24 C58 FIDU1`–`FIDU6 MH1`–`MH5 P8 R13 R19 R21 R46`–`R49 R51 R59 R60`

Eleven of them also carry a marker in their value and are found without the store
(section 13.6); the other fourteen are generic parts whose value says nothing, and
those the store alone accounts for. What each design's groups resolve to:

| Design | Resolved by the store | Of those, found by a marker too | Store alone |
|--------|-----------------------|---------------------------------|-------------|
| LAUNCHXL-CC1310 | 25 | 11 | 14 |
| reServer J2032 | 77 | 0 | 77 |
| reServer J401 | 291 | 0 | 291 |

The eight designs that declare no variant are unchanged by it. On `reServer J401`
the netlist path reports 289 of the 291: `J2_TB2` and `J17_TB1` are drawn on the
schematic but absent from the DAT export, so that path has no component to flag.

---

## 12. Netlist Assembly Logic

This section describes how the parser combines data from all streams into a netlist. This is application logic, not file format, but it's tightly coupled to format understanding.

### 12.1 Pin Number Resolution

**Confidence: VERIFIED**

```
T0x10.pinIndex  -->  Device.pinMap[pinIndex - 1]  -->  physical pin number
```

For example, if T0x10.sth = 5 and Device.pinMap[4] = "A5", the physical pin is "A5".

When the selected map has no entry at that index, whether because no map matched or because the slot holds a `null` placeholder (section 9.2), the other stream's map is tried before giving up. Only if both come up empty is `pinIndex` itself used as the pin number string. That last value is the symbol's pin record order, which equals the physical pin number only for parts whose symbol order matches their package numbering, so it is a last resort and not a peer of the two maps.

**Cache fallback for physical-vs-schematic mismatch**: The `Packages/` `pin_map` describes the physical package, whose pad count need not equal the symbol's pin count, and one package may serve symbols exposing different subsets of it. When the `Packages/` map length differs from the instance's T0x10 count, the parser consults the Cache stream's Device for that component, which stores the schematic-level pins. A Cache map whose length equals the T0x10 count settles the choice in either direction; otherwise only the longer-package case prefers the Cache.

Selecting on length matters because a mismatched map is not merely short, it can be transposed. CutiePi's `CON_HDMI_RA` is a 23-pin symbol whose `Packages/` map has 20 entries with the 17th and 18th swapped (`..."16","18","17","19","20"`), so resolving through it reported HDMI SCL and SDA on each other's pins. The Cache map for the same part has exactly 23 entries in order.

Example: XTAL-CM200S (4-pad crystal, 2 schematic pins):
- `Packages/` pin_map: `["1", "3", "2", "4"]` (4 entries, all physical pads)
- Cache pin_map: `["1", "2"]` (2 entries, schematic pins only)
- T0x10 records: 2 (pinIndex 1 and 2)
- Resolution uses Cache: pinIndex 1 -> "1", pinIndex 2 -> "2"

#### Pin Ignore

**Confidence: VERIFIED**

Each pin name in a Device's `pin_map` is followed by one byte, `bitMapPinGrpCfg`: bit 7 is OrCAD's "Pin Ignore" property (Pin Properties -> Ignore) and bits 6..0 are the pin group.

A section of a multi-section package that has no pad for one of the part's logical pins marks that pin ignored, and Cadence's netlist writer leaves it out. Such a pin must not appear in the netlist: reporting it invents a connection on a pad the part does not have.

Example: `RJ45_1x4_LPJE104-0BENL`, a quad RJ45 whose fourth section has a second shield tab the other three lack.

| Section | pin 13 | pin 14 | ignore(14) |
|---|---|---|---|
| 1 | `S1` | `SS1` | true |
| 2 | `S2` | `SS2` | true |
| 3 | `S3` | `SS3` | true |
| 4 | `S4` | `S5` | false |

The design's own `pstchip.dat` agrees, writing the second shield pin as `SHD2` with `PIN_NUMBER='(0,0,0,S5)'`: present only on the fourth section, `0` on the rest.

### 12.2 Pin Name Resolution

**Confidence: VERIFIED**

```
T0x10.pinIndex  -->  LibraryPart.symbolPins[pinIndex - 1].name  -->  pin name
```

LibraryParts are looked up by `PlacedInstance.pkgName` using dedicated matching logic (`findCachedPart`):

1. **Direct match**: `pkgName` equals a cached LibraryPart key
2. **sourcePackage + variant**: `sourcePackage` + variant suffix from `pkgName` (e.g., `.Normal`)
3. **Stripped sourcePackage + variant**: strip trailing `_\d+` from `sourcePackage`, then add variant

Cache LibraryPart names include a numeric suffix from the Package stream they originated in (e.g., `RES_0.Normal` for `RES.Normal`). The indexer strips this `/_\d+(?=\.)/ ` pattern when building the lookup map.

**Post-processing:**

1. **Uppercasing**: All pin names are uppercased to match Cadence DAT export convention (DSN stores mixed case, DAT is all-uppercase).

2. **Duplicate disambiguation**: When multiple pins on the same component share the same name (e.g., multiple GND pins), the DAT export appends `#pinNum` to disambiguate. Our parser replicates this: if pin names within a component are not unique, each duplicate gets `#` appended (e.g., `GND#10`, `GND#11`). Pins with unique names are left unchanged.

3. **Name-equals-number stripping**: When a pin's functional name equals its pin number (common for passives like resistors and capacitors), the name is treated as absent. This matches DAT behavior where such pins have no separate name field.


#### Recovering LibraryParts from the Cache

**Confidence: VERIFIED**

Pin function names come from LibraryPart records, which the Cache stream carries alongside the Package records that give pin numbers. Two things decide whether a design gets names at all.

**Finding the record.** The Cache is walked sequentially, and on some designs that walk gives up after a handful of entries; a brute-force scan for the preamble magic (`FF E4 5C 39`) then recovers the rest. Stepping back from the magic to the start of the record is the hard part, because a record is a prefix chain: zero or more long prefixes of 9 bytes, then a short prefix of `type(1) + int16 pairCount` followed by 8 bytes per (nameIdx, valIdx) pair.

Assuming the short prefix sits exactly 3 bytes before the magic holds only when it carries no pairs and nothing precedes it. Across the fixture corpus that is true for **every** Package, and for a minority of LibraryParts:

| Design | LibraryParts surveyed | with pairCount = 0 |
|---|---|---|
| LAUNCHXL-CC1310 | 45 | 13 |
| CutiePi V2.3 | 57 | 17 |
| reComputer Industrial J201 | 96 | 1 |
| BeagleBoard-xM | 85 | 49 |

These are counts from the survey that motivated the fix, and sit within one or two of the recovery counts in [section 10.3](#103-parsing-strategy), which are what the current parser actually extracts.

So a design whose sequential walk failed early came out with pin numbers for every component and pin names for none: LAUNCHXL-CC1310 and CutiePi both yielded 0 LibraryParts while yielding 41 and 57 Packages. The scan now searches for the pair count and then for the chain start, letting the prefix reader validate each candidate.

**Choosing between variants.** Instances refer to a part by a suffix-stripped name, so each part is registered under its own name and under `name.replace(/_\d+(?=\.)/, "")`. Two variants of one base part then compete for the stripped key, and a part's own name must outrank an alias derived from a different variant. CutiePi carries both `RES_0.Normal`, whose pins are named `1` and `2`, and `RES.Normal`, whose pins are named `A` and `B`; `RES_0.Normal` strips to `RES.Normal`, so first-writer-wins gave every plain resistor the other variant's numbering. Since a pin name equal to the pin number is dropped as carrying no information, those 75 components reported no pin names at all.

With both fixed, pin function names match the DAT export on 8105 of 8105 pins across all 11 fixtures.

### 12.3 Package Key Matching

**Confidence: VERIFIED**

`PlacedInstance.sourcePackage` identifies which Package provides the pin map, but the name doesn't always match directly. The search is two nested loops, not one flat list.

The **outer loop** walks three spellings of the base name, in order, stopping at the first that yields a key:

1. `sourcePackage` as written
2. **Normalized**: expand `_N_` to `_N.0_` (version-like suffixes)
3. **Stripped**: remove a trailing `_\d+`

The **inner loop** tries four ways to turn a base name into a key, in order:

1. **Direct match**: the base name is itself a Package key
2. **Multi-unit**: base + unit letter extracted from the `pkgName` suffix; if that letter is a doubled pair such as `AA`, its first character is tried as well
3. **Positional device assignment**: for multi-section components with no unit suffix, base + the unit letter at `sectionIndex` (see below)
4. **Unit "A" fallback**: base + `"A"`, for a package whose devices are not enumerated in `deviceUnitRefs`

For multi-unit matching, `pkgName` format is `{sourcePackage}{unitLetter}.Normal` (e.g., `OMAP_CBP_1AA.Normal`). Cadence sometimes doubles the unit letter ("AA"), but the Device `unitRef` uses a single letter ("A").

Steps 3 and 4 apply only when no unit letter was extracted: an instance carrying a unit suffix resolves by that suffix or not at all.

#### Section-based device assignment

Multi-section components like resistor packs (e.g., RP1 with package `RPAK_10_8RES`, 8 sections, 16 physical pins) have multiple PlacedInstances sharing the same `(refdes, pkgName)` with no unit suffix in `pkgName`. Each such instance names its own Device through `PlacedInstance.section_index` (section 7.7).

The parser builds a `deviceIndexMap` (`Map<dbId, sectionIndex>`) over every instance whose `extractUnitRef()` returns `undefined`; instances with a unit suffix resolve by that suffix instead. A parallel `deviceUnitRefs` map (`Map<pkgBaseName, unitRef[]>`) stores the ordered Device unit reference letters from Package structures, and `findPinMap` selects the Device with `pinMaps.get(base + unitRefs[sectionIndex])`.

This replaced an earlier heuristic that sorted each `(refdes, pkgName)` group by `dbId` and assigned positional indices. `dbId` order is *not* section order: on `BeagleBoard-xM_ORCAD` the eight `RP3` sections are allocated with adjacent pairs transposed, so six of its sixteen pins attached to the wrong nets. Because the nets and the pin numbers were each individually valid, net and component coverage stayed at 100% and `verify-pin-numbers.ts` reported 100% — only a per-net `{refdes.pin}` comparison against the DAT export exposed it.

Measured over the Cadence fixture corpus, nets whose pin set disagrees with the DAT reference fell from **79 to 24** (98.4% → 99.5%), with no design regressing. Geometric orderings were tested as alternatives to `dbId` and every one was worse (`locY` 81, `locX` 103, descending variants 131 and 139).

### 12.4 Net Name Resolution

**Confidence: VERIFIED**

1. Wire endpoints are grouped by coordinate using Union-Find
2. Wire segments sharing the same `Wire.id` are unioned (same logical net)
3. Net names come from: wire aliases (labels) and the page net table
4. When a group has multiple candidate names, hierarchy-canonical names take priority, and the alphabetically first name wins within whichever set applies. Cadence's CIS export breaks the same tie the same way
5. Unnamed wire groups get `N{minSegmentId}` names
6. Cross-page nets connected via OffPageConnectors are resolved by `strLst[name_str_idx]` (OPCs with the same index share the same net). A pin is matched to an OPC by testing its coordinate against five specific points: the four bbox edge midpoints (`maxX,midY`, `minX,midY`, `midX,maxY`, `midX,minY`) and the OPC's own `locX,locY`. Testing only those, rather than every point on the edges, is what stops OPC boxes that overlap vertically on a dense sheet from fusing unrelated nets. A pin matching any of them takes the OPC's net name even when the OPC has no wire connection on that page
7. Duplicate net names across pages are disambiguated using hierarchy suffixed names
8. Global/Port symbols take their net name from `strLst[name_str_idx]`, the same field OPCs use. The symbol's own `name` field is the symbol *type* and must not be used: a symbol drawn as `VDD_1v8` may carry `CAM_CORE`, and two symbols both drawn as `VCC_BAR` carry `VDD_PLL1` and `VDD_PLL2`. The name is used for two things: steering the symbol to the one wire it belongs to (below), and naming a sentinel pin (`net_id == 0xFFFFFFFF`) that overlaps the symbol's bbox and that no wire coordinate resolved. Where the symbol does reach a wire, that wire group's resolved name wins, because `strLst[name_str_idx]` is occasionally a symbol type too: `pairingId` 17700 reads `GND_SIGNAL` on three Jetson carrier designs, a name absent from their DAT exports
9. Wire body point-on-segment matching: a pin whose coordinate falls on a horizontal/vertical wire segment (not just the endpoints) is unioned with that wire

#### Global/Port symbol attachment

**Confidence: VERIFIED**

A power symbol has one pin, so it touches exactly one wire, but its drawn box is
larger than that wire and its `locX/locY` is a placement origin rather than the
electrical connection point. On a rail fan-out the rails sit one grid step apart
while the boxes are two steps tall, so a symbol's box covers the rails above and
below it, and its origin routinely lands on a *neighbouring* rail's endpoint.

Two rules keep that geometry from fusing unrelated nets:

- A symbol is keyed in the Union-Find by `sym:{name_str_idx}:{dbId}`, never by
  its origin coordinate. Keying by origin made the symbol and whichever wire
  ended there the same graph node.
- A symbol performs at most one union, choosing the wire coordinate inside its
  box that already carries its own `strLst[name_str_idx]` name. Failing that,
  only coordinates with no name of their own are eligible, nearest first.

The attachment is ranked by distance to the centre of the bounding box, not to
`locX/locY`: that origin lies outside the symbol's own box for 1405 of the 3971
symbols in the fixture corpus (35.4%), so it cannot anchor a ranking. A symbol
whose own name is unknown, which is every symbol in a design whose Library stream
failed to parse, keeps all in-box coordinates eligible rather than none.

Measured over the Cadence fixture corpus, this rule plus the two pin-numbering
rules in §11.1 took nets whose pin set disagrees with the DAT reference from
**24 to 0**, with no design regressing. All 4936 nets across all 11 designs match
the DAT export exactly, with no net missing and none invented.

### 12.5 Multi-Unit Component Merging

**Confidence: VERIFIED**

Multi-unit components (e.g., quad op-amps) appear as multiple PlacedInstance records sharing the same `reference` (refdes). Each instance has its own T0x10 pins representing one unit. The parser merges all instances with the same refdes into a single component, combining their pin sets.

---

## 13. Known Gaps and Limitations

### 13.1 Coverage impact analysis

Each unknown area in the format is mapped to its impact on parser coverage. PinNum, PinName and Value all read 100% against the DAT export (section 13.5), so none of these gaps costs anything measurable today; the table records what would be at stake if a design exercised them differently.

| Unknown area | Size per occurrence | Impact on PinNum | Impact on PinName | Impact on Value |
|---|---|---|---|---|
| **PlacedInstance 10 unknown bytes** (section 7.7) | 10 per component | None | None | None observed; may encode a secondary value reference or CIS link |
| **Port 9 trailing bytes** (section 7.8) | 9 per port | None | None | None |
| **Global/OPC 5 trailing bytes** (section 7.8) | 5 per symbol | None | None | None |
| **Hierarchy 24-byte metadata** (section 8) | 24 per net | None | None | None |
| **T0x10 unknown_int** (section 7.7.1) | 4 per pin | None | None | None |
| **Page tail after OPCs** (section 7) | Variable | None | None | None |

### 13.2 What we don't parse at all

| Area | Description |
|------|-------------|
| ERC objects | Electrical rules check markers on the schematic |
| Bus entries | Bus connection points |
| Bus wires | Wire type 0x15 is accepted but buses aren't traced |
| CIS streams | CIS database link information |
| DrawnInstance bodies | Hierarchical page instances are skipped via their prefix boundaries |
| Graphical primitives | Shapes inside LibraryPart (lines, rects, arcs) |
| Title block contents | Skipped entirely |
| Page sections after OPCs | Everything after OffPageConnectors in the page stream |
| Directory streams | All seven: `Packages`, `Cells`, `ExportBlocks`, `Graphics`, `Parts`, `Symbols`, `Views` Directory (section 10.5) |
| Other top-level streams | `AdminData`, `Cells`, `ExportBlocks`, `Graphics`, `HSObjects`, `Parts`, `Symbols`, present in every fixture; `DsnStream`, `NetBundleMapData`, `BundleMapData` in some (section 2) |
| Wire `color`, `line_width`, `line_style` | Read to advance position, discarded |
| SymbolPin geometry and `port_type` | 28 bytes skipped; only `name` is kept (section 9.4) |
| SymbolDisplayProp contents | Decoded field by field and attached to their parent structure, but nothing downstream of the parsers ever reads them; they exist only to advance the position correctly |

### 13.3 Unknown bytes in parsed structures

| Structure | Location | Bytes | Notes |
|-----------|----------|-------|-------|
| PlacedInstance | After prefixes | 8 | Before pkg_name |
| PlacedInstance | After db_id | 8 | Unknown purpose |
| PlacedInstance | Before SDPs | 4 | Includes rotation + mirror per reference |
| PlacedInstance | After SDPs | 1 | Unknown |
| PlacedInstance | After reference + part_value_idx | **10** | Between value and pins; possible value/CIS data |
| PlacedInstance | After source_package | 2 | Unknown |
| T0x10 | After net_id | 4 | `unknown_int` |
| GraphicInst | Second uint32 | 4 | Constant per design, purpose unknown |
| GraphicInst | After bbox | 4 | color + 3 unknown bytes |
| Port | End of structure | **9** | Port-specific; Global and OPC have no equivalent |
| Global/OPC | After each record | **5** | Not part of the structure; could contain net reference |
| LibraryPart | After checkpoint 1 | 4 | Before len_primitives |
| SymbolPin | After pin_shape | 2 | Unknown |
| SymbolPin | After port_type | 4 | Unknown |
| Hierarchy net record | Per record | **24** | Fixed metadata; may contain DB object IDs |

### 13.4 Heuristics that could break

| Heuristic | Risk | Impact if wrong |
|-----------|------|-----------------|
| Prefix count auto-detection (try 10..1) | Low | Parse failure on individual structure |
| T0x10.sth encoding (< 32768 vs >= 32768) | Low | Wrong pin index, wrong pin number |
| Cache entry metadata probing (tryRead heuristic) | Medium | Could misparse entry boundary; mitigated by brute-force preamble recovery (section 10.3) |
| Hierarchy 0x43 scan | Medium | Wrong net count, corrupt net names |
| PageSettings = 156 bytes | Low | Parse offset error for everything after it |
| LOGFONTA = 60 bytes | Low | Wrong strLst offset, corrupt string table |
| 5 unknown bytes after Global/OPC | Medium | Parse offset error for subsequent records |
| 9 unknown bytes at the end of a Port | Medium | Parse offset error for subsequent records |
| some_len = 24 (Library stream) | Low | Wrong strLst offset |
| Cache scan bounds (64 pairs, 10 long prefixes) | Low | A wider prefix chain goes unrecovered; the parse throws rather than misreads |
| Wireless sentinel nets matched to hierarchy `N{n}` names by sort order | Medium | Pin-to-pin nets named after the wrong hierarchy entry |

### 13.5 Coverage vs DAT golden

Reproduce with `node --import tsx scripts/dsn-coverage-report.ts`. Aggregate over the 11 Cadence fixtures:

| Metric | Coverage | Notes |
|--------|----------|-------|
| Nets | 4936/4936 (100.0%) | every expected net present, none invented |
| Conn | 4936/4936 (100.0%) | 0 nets with a differing `{refdes.pin}` set |
| Components | 6774/6774 (100.0%) | |
| Value | 6774/6774 (100.0%) | 4 case-transformed |
| PinNum | 24001/24001 (100.0%) | |
| PinName | 8105/8105 (100.0%) | |
| MPN | 5870/6774 (86.7%) | 5456 substring; see below |
| DNS | 456/456 (100.0%) | both sources read; section 13.6 |

`Nets` and `Comps` match on names alone, so a net that survives with the wrong pins on it still scores as covered. `Conn` is the column that catches that: for every net present in both netlists it compares the actual `{refdes.pin}` set. Both being at 100% is what makes the net numbers meaningful.

Per design, every one of the 11 fixtures reads 100.0% on Nets, Conn, Comps, Value, PinNum and PinName. The two columns that vary are MPN and DNS:

| Design | MPN | DNS |
|--------|--------|--------|
| BeagleBoard-xM | 98.6% | 100.0% |
| BB-Black | 100.0% | n/a |
| BB-Black (BeagleBoard) | 100.0% | n/a |
| CutiePi | 96.6% | 100.0% |
| CC13xx | 2.1% | 100.0% |
| LAUNCHXL-CC1310 | 9.8% | 100.0% |
| reComputer J201 | 100.0% | n/a |
| reComputer J202 | 100.0% | n/a |
| reComputer J401 | 100.0% | n/a |
| reServer J401 | 95.6% | 100.0% |
| reServer J2032 | 23.2% | 100.0% |

MPN is the only column that varies. DNS reads 100.0% on every design that has one,
from both of its sources: the marker a part's value carries, and the variant store
(section 11).

**MPN is not a defect measure.** DSN extracts a real manufacturer part number from the prefix property pairs, while the DAT golden carries a composite string, so an exact match is not the goal and the low numbers on CC13xx and reServer J2032 reflect that difference in kind. The report counts a substring hit separately for this reason.

**BEAGLEBONEBLK_C3_BEAGLEBOARD is not measured against Cadence.** It ships no `pstxnet.dat`, so its golden is a snapshot of this parser's own output. Its 100% says the parser is self-consistent on that design, not that it is correct, and it should not be read as an eleventh independent confirmation.

### 13.6 DNS (Do Not Stuff) detection

**Confidence: VERIFIED**

Implemented, from both of the sources a Cadence design records it in:

- the marker a part's own value carries (`DNI`, `10K,DNI`, `DNM_0402`, `10K_NC`), read
  with the same shared matcher the DAT and Altium paths use, before section 13.7 cleans
  it out of the value
- the CIS variant store (section 11), for the parts a variant leaves off the board,
  which carry no marker anywhere

Reading the marker closed a divergence between the two paths. The value was being
stripped of its marker without the flag ever being set, so the same board answered
differently depending on whether a query named the `.DSN` or the `pstxnet.dat` beside
it: 65 parts across BeagleBoard-xM (38), CutiePi (22) and CC13xx (5) were flagged by
one path and not the other. `test/integration/golden.test.ts` now compares the two on
every oracle design and asserts they agree, over 6360 components.

What no binary parser can see is a marker that was never written into the design:
graphical text placed near a component on the schematic, with no property behind it.

The two mechanisms, what each leaves on disk, and what a design should ship so a
reader can see its Do Not Install are described in
[How Cadence Records Do Not Install](cadence-dni.md).

### 13.7 DNS markers in value strings

**Confidence: OBSERVED**

Some Cadence designs embed DNS/NC markers directly in component value strings (e.g., `100nF,DNI`, `10K_NC`). The parser strips these markers to produce clean values. Recognized patterns:

- Comma-separated: `,DNI`, `,DNP`, `,DNM`, `,DNS`, `,NC`
- Prefix comma: `DNI,`, `DNP,`, `DNM,`, `DNS,`
- Suffix: `_NC`

Matching is case-insensitive. This is a DSN-specific regex in `component-builder.ts`, distinct from the shared `stripDnsMarkers()` that the Altium and KiCad paths use, which recognises a wider set (`DNF`, `NF`, and phrases such as "DO NOT POPULATE").

The cleanup took BBxM value coverage from 90.9% to 99.1% when it landed; value now reads 100% on every fixture.

### 13.8 Reference material

- [OpenOrCadParser](https://github.com/Werni2A/OpenOrCadParser) - C++ reference implementation (local copy at `references/OpenOrCadParser/`, gitignored)


Key C++ source files for cross-referencing unknown bytes or new structure types:

| C++ Source | Our Port | Purpose |
|---|---|---|
| `src/GenericParser.cpp` | `dsn/generic-parser.ts` | Prefix chain, preamble, checkpoint system |
| `src/Streams/StreamPage.cpp` | `dsn/page-parser.ts` (`parsePage`) | Page stream top-level layout |
| `src/Streams/StreamCache.cpp` | `dsn/cache-parser.ts` (`parseCacheStream`) | Cache entry metadata format |
| `src/Streams/StreamPackage.cpp` | `dsn/page-parser.ts` (`parsePackageStream`) | Package stream layout |
| `src/Streams/StreamLibrary.cpp` | `dsn/library-parser.ts` | Library stream / strLst |
| `src/Structures/` | `dsn/structures.ts` | All structure parsers |

`dsn/dsn-parser.ts` is the orchestrator that opens the container, discovers the streams and calls the above; `dsn/net-builder.ts`, `dsn/pin-resolver.ts` and `dsn/component-builder.ts` implement section 12 and have no C++ counterpart.
