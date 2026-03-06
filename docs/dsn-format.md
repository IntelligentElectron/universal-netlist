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
11. [Netlist Assembly Logic](#11-netlist-assembly-logic)
12. [Known Gaps and Limitations](#12-known-gaps-and-limitations)

---

## 1. Container Format (CFBF)

**Confidence: VERIFIED**

A `.DSN` file is a CFBF (Compound File Binary Format) container, also known as OLE2 or Structured Storage. This is a Microsoft format (documented in [MS-CFB]) used by many legacy applications. Inside it are named **streams** (binary blobs) organized in a directory tree.

All multi-byte integers within streams are **little-endian**.

Our parser uses `OleReader` (in `src/parsers/ole-reader/`) to open the CFBF container and read individual streams by path.

---

## 2. OLE Stream Layout

**Confidence: VERIFIED**

The directory tree of a typical DSN file:

```
Root Entry/
  Library                          # String table, fonts, page settings
  Cache                            # Cached LibraryPart + Package for ALL components
  Views/
    {ViewName}/
      Pages/
        {PageName}                 # One stream per schematic page
      Hierarchy/
        Hierarchy                  # Canonical net name list
  Packages/
    {PackageName}                  # Per-package: PartCell + LibraryPart[] + Package
  CIS/                             # CIS database link info (not parsed)
```

| Stream | Purpose | Parser Status |
|--------|---------|---------------|
| `Library` | String table (`strLst`), fonts, page settings | Parsed (strLst only) |
| `Views/{name}/Pages/{page}` | Components, wires, nets, aliases per page | Fully parsed |
| `Views/{name}/Hierarchy/Hierarchy` | Canonical flat net name list | Partially parsed |
| `Packages/{name}` | Package + Device[] + LibraryPart[] | Fully parsed |
| `Cache` | LibraryPart + Package definitions for all components | Scanned for Packages only |
| `CIS/` | CIS database connection info | Not parsed |

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

Most strings use length-prefixed, null-terminated encoding:

```
uint16   length       # byte count of string content (not including null)
char[]   content      # ASCII (or Latin-1 in Library strLst)
uint8    0x00         # null terminator
```

Special case: if `length == 0`, only the null terminator byte (0x00) is present.

The Library stream's `strLst` uses Latin-1 encoding. All other streams use ASCII.

### 3.2 Integers

**Confidence: VERIFIED**

All little-endian: `uint8`, `int16`, `uint16`, `int32`, `uint32`. No 64-bit integers observed.

### 3.3 Coordinates

**Confidence: VERIFIED**

Schematic coordinates are `int16` or `int32` depending on context. Pin and component locations use `int16`. Wire endpoints use `int32` (via Alias parsing).

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
0x05    4     Mirrors the byte offset (validation pair)
```

The byte offset is relative to the position after the 9-byte header. It defines a "checkpoint boundary" used to validate parsing progress.

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

Each long prefix's byte offset defines a checkpoint boundary. As the parser reads through the structure body, it periodically calls `checkpoint()` to verify the current file position matches an expected boundary. This enables:
- Validation that parsing is on track
- Error recovery via `skipToNextBoundary()` or `readRestOfStructure()`

---

## 5. Structure Type IDs

**Confidence: VERIFIED (values from OpenOrCadParser, confirmed by parsing)**

| ID (hex) | ID (dec) | Name | Purpose |
|----------|----------|------|---------|
| `0x02` | 2 | SthInPages0 | Unknown sub-structure in pages |
| `0x06` | 6 | PartCell | Part cell in Package streams |
| `0x0A` | 10 | Page | Page-level wrapper |
| `0x0B` | 11 | PartInstance | Part instance (unused by us) |
| `0x0D` | 13 | PlacedInstance | Component placed on schematic |
| `0x10` | 16 | T0x10 | Pin instance on a placed component |
| `0x14` | 20 | WireScalar | Single-signal wire |
| `0x15` | 21 | WireBus | Bus wire |
| `0x17` | 23 | Port | Port symbol |
| `0x18` | 24 | LibraryPart | Library symbol definition |
| `0x1A` | 26 | SymbolPinScalar | Individual symbol pin |
| `0x1B` | 27 | SymbolPinBus | Bus-type symbol pin |
| `0x1D` | 29 | BusEntry | Bus entry point |
| `0x1F` | 31 | Package | Package definition |
| `0x20` | 32 | Device | Device within a package |
| `0x21` | 33 | GlobalSymbol | Global power symbol definition |
| `0x22` | 34 | PortSymbol | Port symbol definition |
| `0x23` | 35 | OffPageSymbol | Off-page connector symbol definition |
| `0x25` | 37 | Global | Global power connector instance |
| `0x26` | 38 | OffPageConnector | Off-page connector instance |
| `0x27` | 39 | SymbolDisplayProp | Display property on a symbol |
| `0x31` | 49 | Alias | Wire alias (net name label) |
| `0x34` | 52 | T0x34 | Primitive graphics (line/shape) |
| `0x35` | 53 | T0x35 | Primitive graphics (polyline/shape) |
| `0x40` | 64 | TitleBlockSymbol | Title block symbol definition |
| `0x41` | 65 | TitleBlock | Title block instance |
| `0x4D` | 77 | ERCObject | Electrical rules check marker |
| `0x62` | 98 | PinShapeSymbol | Pin shape symbol definition |
| `0x67` | 103 | NetGroup | Net group |

We only parse the **bolded** types in the table above (PlacedInstance, T0x10, Wire, Package, Device, LibraryPart, SymbolPin, Global, Port, OffPageConnector, SymbolDisplayProp, Alias). All others are skipped via `skipStructure()`.

---

## 6. Library Stream

**Confidence: VERIFIED (header layout), OBSERVED (some_len always = 24)**

The Library stream contains the global string table used by all prefix property pairs.

### Binary layout

```
Offset  Size        Field
------  ----------  -----
0x00    32          introduction       (null-term string in 32-byte buffer)
                                       e.g. "OrCad Windows Design"
0x20    2           version_major      (uint16)
0x22    2           version_minor      (uint16)
0x24    4           create_date        (uint32, Unix timestamp)
0x28    4           modify_date        (uint32, Unix timestamp)
0x2C    4           0x00000000         (assumed padding)
0x30    2           text_font_len      (uint16)
...     (text_font_len - 1) * 60      LOGFONTA structures
...     2           some_len           (uint16, OBSERVED: always 24)
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

The OpenOrCadParser mentions that "version A" files use `uint16` for `str_lst_len` instead of `uint32`. Our parser always reads `uint32`. We haven't encountered a version A file.

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
          PlacedInstance[] sub-records (see 7.7)
uint16    len_ports
          Port[] sub-records + 5 unknown bytes each (see 7.8)
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

**VERIFIED**: `Wire.segment_id` is unique per wire segment and is used to generate unnamed net names (`N{segment_id}`), matching Cadence DAT export behavior.

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
    4 bytes   unknown          # includes rotation (uint8) and mirror (uint8)
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
    2 bytes   unknown
    -- checkpoint --
```

**VERIFIED** fields: `pkg_name`, `db_id`, `loc_x`, `loc_y`, `reference`, `part_value_idx`, `source_package`, `t0x10s`, prefix properties.

**UNKNOWN**: The 8 bytes at offset +0x00, the 8 bytes after `db_id`, the 4 bytes before `len_symbol_display_props` (includes rotation/mirror per the reference photos, but we don't extract them), the 1 byte after SDPs, and the 10 bytes after `part_value_idx`.

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

The `sth` field encodes a 1-based logical pin index:
- If `sth < 32768`: `pin_index = sth`
- If `sth >= 32768`: `pin_index = 65536 - sth` (pin is marked NC in some contexts)

This encoding is from the OpenOrCadParser reference and confirmed to produce correct pin mappings in all tested designs. However, the semantic meaning of the high-bit flag is not fully understood. Our parser treats both cases identically for pin map lookup.

#### net_id semantics (VERIFIED)

- `net_id > 0 && net_id < 0xFFFFFFFF`: Normal net. Groups pins belonging to the same electrical net across a page. Maps to the page net table.
- `net_id == 0`: No-connect pin (pin is not wired to anything).
- `net_id == 0xFFFFFFFF`: Sentinel value. The pin's net is determined by its physical coordinate overlapping a wire endpoint or another pin.

**IMPORTANT**: `net_id` values are NOT the same as `Wire.id` values. They are in different Cadence DB object ID spaces. The correspondence between pin netId and wire id is established indirectly through the net name table (both reference the same logical net, but via different IDs).

### 7.8 GraphicInst (Global, Port, OffPageConnector)

**Confidence: VERIFIED (layout), OBSERVED (5 trailing bytes)**

Global (type 0x25), Port (type 0x17), and OffPageConnector (type 0x26) share a common base structure:

```
PREFIXES (type varies)
PREAMBLE (optional)
BODY:
    uint32    pairing_id       # first of "8 unknown bytes"; used for OPC cross-page matching
    4 bytes   unknown          # second uint32 (constant per design)
    string    name             # symbol type name, e.g. "VCC_BAR", "GND_SIGNAL"
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

After each Port, Global, or OffPageConnector record, there are **5 unknown bytes** that are not part of the structure itself. These are read separately in the page parser.

**VERIFIED**: The `pairing_id` field (first uint32 of the "8 unknown bytes") is used to match OffPageConnector pairs across pages. OPCs sharing the same `pairing_id` are electrically connected.

**VERIFIED**: Y coordinates are read before X in this structure (confirmed by matching pin coordinates to wire endpoints in real designs).

**OBSERVED**: The `name` field is the schematic symbol type (e.g., "VCC_BAR"), NOT the net name. Net names come from wire connectivity, not from Global/Port/OPC name fields.

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

SCAN FORWARD to find 0x43 marker byte

    uint16    net_count

For each net:
    24 bytes  fixed metadata   (UNKNOWN contents)
    uint16    name_length
    name_length bytes + 0x00   net_name
```

**HEURISTIC**: The "scan for 0x43" approach is fragile. We don't fully understand the header structure between the view name and the net records. The 0x43 byte happens to precede the net count in all tested designs, but this is pattern-matching, not spec-based parsing.

**UNKNOWN**: The 24 bytes of "fixed metadata" per net record. These likely contain Cadence DB object IDs, net attributes, or cross-references, but we skip them entirely.

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
            read 2 bytes, push null (empty/unused pin slot)
        else:
            string    pin_name     # e.g. "1", "A5", "GND"
            uint8     pin_config   (bitfield):
                        bit 7:     pin_ignore (1 = ignore this pin)
                        bits 6-0:  pin_group (swap group, 127 = no group)
    -- checkpoint --
```

The `pin_map` array maps logical pin index to physical pin designator. Index 0 corresponds to logical pin 1 (T0x10.pinIndex = 1).

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
              SymbolPin[] sub-records
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

---

## 10. Cache Stream

**Confidence: VERIFIED**

The Cache stream contains ALL component definitions for the design: symbol definitions, LibraryParts (pin names), and Packages (pin maps). It is parsed sequentially from byte 0 to EOF.

Reference: `OpenOrCadParser/src/Streams/StreamCache.cpp`

### 10.1 Cache Header

```
uint16    0x0000           (2 zero bytes)
uint16    unknown          (2 unknown bytes)
```

Empty caches are exactly 10 zero bytes.

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

Structure types found in Cache: symbols (0x21, 0x23, 0x40, 0x4b), PartCell (0x06), LibraryPart (0x18), Package (0x1F).

### 10.3 Parsing Strategy

The Cache MUST be parsed sequentially. Brute-force byte scanning fails because entries have variable-length metadata that can only be navigated by reading from the beginning.

We extract two structure types:
- **Package** (0x1F): Device pinMap arrays for pin number resolution
- **LibraryPart** (0x18): SymbolPin names for pin name enrichment

All other structure types are skipped via `skipStructure()`.

### 10.4 Priority

When both `Packages/` streams and Cache provide data for the same component, `Packages/` streams take priority. The Cache is only used as a fallback for components not covered by dedicated streams.

### 10.5 Packages Directory Stream

**Confidence: OBSERVED**

A separate OLE stream named `Packages Directory` contains a list of all package names in the design. Each entry is:

```
string    package_name     (uint16 len + ASCII + 0x00)
uint8     0x1F             (Package type marker)
uint8     0x00
8 bytes   timestamp_1      (FILETIME, likely creation date)
8 bytes   timestamp_2      (FILETIME, likely modification date)
uint16    unknown_1        (observed: 0x0003)
uint16    unknown_2        (observed: 0x0002)
```

This directory lists all ~90 package types in BB-Black, but contains **no offsets** into the Cache stream. It confirms what packages should exist, but doesn't help find them.

Similarly, `Cells Directory`, `Parts Directory`, `Views Directory`, and `Symbols Directory` streams exist with analogous structures for their respective object types.

---

## 11. Netlist Assembly Logic

This section describes how the parser combines data from all streams into a netlist. This is application logic, not file format, but it's tightly coupled to format understanding.

### 11.1 Pin Number Resolution

**Confidence: VERIFIED**

```
T0x10.pinIndex  -->  Device.pinMap[pinIndex - 1]  -->  physical pin number
```

For example, if T0x10.sth = 5 and Device.pinMap[4] = "A5", the physical pin is "A5".

If no pin map is found, `pinIndex` itself is used as the pin number string (fallback).

### 11.2 Pin Name Resolution

**Confidence: VERIFIED (mechanism), LOW (coverage)**

```
T0x10.pinIndex  -->  LibraryPart.symbolPins[pinIndex - 1].name  -->  pin name
```

LibraryParts are looked up by `PlacedInstance.pkgName`. Coverage is low because passive components (resistors, capacitors) typically have pin names that equal their pin numbers ("1", "2"), which doesn't match the DAT export's functional names.

### 11.3 Package Key Matching

**Confidence: VERIFIED**

`PlacedInstance.sourcePackage` identifies which Package provides the pin map, but the name doesn't always match directly. We try four strategies in order:

1. **Direct match**: `sourcePackage` equals a Package name
2. **Multi-unit**: `sourcePackage` + unit letter (extracted from `pkgName` suffix)
3. **Normalized**: expand `_N_` to `_N.0_` in sourcePackage (version-like suffixes)
4. **Stripped**: remove trailing `_\d+` from sourcePackage

For multi-unit matching, `pkgName` format is `{sourcePackage}{unitLetter}.Normal` (e.g., `OMAP_CBP_1AA.Normal`). Cadence sometimes doubles the unit letter ("AA"), but the Device `unitRef` uses a single letter ("A").

### 11.4 Net Name Resolution

**Confidence: VERIFIED**

1. Wire endpoints are grouped by coordinate using Union-Find
2. Wire segments sharing the same `Wire.id` are unioned (same logical net)
3. Net names come from: wire aliases (labels) and the page net table
4. When a group has multiple candidate names, hierarchy-canonical names take priority
5. Unnamed wire groups get `N{minSegmentId}` names
6. Cross-page nets connected via OffPageConnectors are resolved by pairing ID
7. Duplicate net names across pages are disambiguated using hierarchy suffixed names

### 11.5 Multi-Unit Component Merging

**Confidence: VERIFIED**

Multi-unit components (e.g., quad op-amps) appear as multiple PlacedInstance records sharing the same `reference` (refdes). Each instance has its own T0x10 pins representing one unit. The parser merges all instances with the same refdes into a single component, combining their pin sets.

---

## 12. Known Gaps and Limitations

### 12.1 Coverage impact analysis

Each unknown area in the format is mapped to its impact on parser coverage:

| Unknown area | Size per occurrence | Impact on PinNum | Impact on PinName | Impact on Value |
|---|---|---|---|---|
| **PlacedInstance 10 unknown bytes** (section 7.7) | 10 per component | None | None | **POSSIBLE** (BB-xM 62 missing) |
| **Port/Global/OPC 5 trailing bytes** (section 7.8) | 5 per symbol | None | None | None |
| **Hierarchy 24-byte metadata** (section 8) | 24 per net | None | None | None |
| **T0x10 unknown_int** (section 7.7.1) | 4 per pin | None | None | None |
| **Page tail after OPCs** (section 7) | Variable | None | None | None |

**PlacedInstance 10 unknown bytes** are the only area with possible coverage impact. BeagleBoard-xM is missing 62 values; these bytes sit between `part_value_idx` and `len_t0x10s` and could encode a secondary value reference or CIS database link.

### 12.2 What we don't parse at all

| Area | Description |
|------|-------------|
| ERC objects | Electrical rules check markers on the schematic |
| Bus entries | Bus connection points |
| Bus wires | Wire type 0x15 is accepted but buses aren't traced |
| CIS streams | CIS database link information |
| Graphical primitives | Shapes inside LibraryPart (lines, rects, arcs) |
| Title block contents | Skipped entirely |
| Page sections after OPCs | Everything after OffPageConnectors in the page stream |
| Directory streams | `Packages Directory`, `Cells Directory`, etc. (section 10.5) |

### 12.3 Unknown bytes in parsed structures

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
| Port/Global/OPC | After each record | **5** | Not part of the structure; could contain net reference |
| LibraryPart | After checkpoint 1 | 4 | Before len_primitives |
| SymbolPin | After pin_shape | 2 | Unknown |
| SymbolPin | After port_type | 4 | Unknown |
| Hierarchy net record | Per record | **24** | Fixed metadata; may contain DB object IDs |

### 12.4 Heuristics that could break

| Heuristic | Risk | Impact if wrong |
|-----------|------|-----------------|
| Prefix count auto-detection (try 10..1) | Low | Parse failure on individual structure |
| T0x10.sth encoding (< 32768 vs >= 32768) | Low | Wrong pin index, wrong pin number |
| Cache entry metadata probing (tryRead heuristic) | Medium | Could misparse entry boundary, losing remaining entries |
| Hierarchy 0x43 scan | Medium | Wrong net count, corrupt net names |
| PageSettings = 156 bytes | Low | Parse offset error for everything after it |
| LOGFONTA = 60 bytes | Low | Wrong strLst offset, corrupt string table |
| 5 unknown bytes after Port/Global/OPC | Medium | Parse offset error for subsequent records |
| some_len = 24 (Library stream) | Low | Wrong strLst offset |

### 12.5 Coverage gaps vs DAT golden

Current aggregate coverage (10 designs):

| Metric | Coverage | Main gap |
|--------|----------|----------|
| Nets | 100.0% | None |
| Components | 100.0% | None |
| Value | 99.0% | BeagleBoard-xM missing 62 values |
| PinNum | 98.3% | Minor gaps in LAUNCHXL-CC1310, reServer designs |
| PinName | 85.9% | Passives have name=number (not a mismatch); LAUNCHXL/CutiePi gaps |

Per-design breakdown:

| Design | PinNum | PinName | Value | Bottleneck |
|--------|--------|---------|-------|------------|
| BeagleBoard-xM | 94.7% | 91.7% | 90.9% | Value encoding |
| BB-Black | 99.3% | 98.4% | 100.0% | Minor residual |
| CutiePi | 97.9% | 55.4% | 92.6% | Pin name gaps |
| CC13xx | 100.0% | 94.1% | 100.0% | Near-complete |
| LAUNCHXL-CC1310 | 89.6% | 31.6% | 100.0% | Pin number + name gaps |
| reComputer J201 | 100.0% | 93.0% | 100.0% | Near-complete |
| reComputer J202 | 100.0% | 90.5% | 100.0% | Near-complete |
| reComputer J401 | 100.0% | 90.6% | 100.0% | Near-complete |
| reServer J401 | 99.0% | 94.2% | 100.0% | Near-complete |
| reServer J2032 | 95.8% | 61.8% | 100.0% | Pin number + name gaps |

### 12.6 DNS (Do Not Stuff) detection

Not implemented in the DSN parser. Some designs mark DNS via:
- Structured property in prefix (detectable but not checked)
- Graphical text on schematic only (invisible to any binary parser)

### 12.7 Reference material

- [OpenOrCadParser](https://github.com/Werni2A/OpenOrCadParser) - C++ reference implementation
- `.plans/DSN-binary-structure/` - 19 annotated reference photos of the format documentation
- `.plans/DSN-binary-structure/DSN_Binary_Structure.md` - Older working notes (superseded by this document)
