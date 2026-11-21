# Cadence OrCAD Capture `.DSN` Format Specification

This is universal-netlist's specification of the OrCAD Capture design file (`.DSN`), and the golden reference for the parser. It states only what we verified on real files, says plainly what is unverified or unknown, and records every disproved claim with the evidence against it.

It is merged from two source specifications that are not published:

| Name | Status |
| --- | --- |
| INTERNAL spec | Ours, built with the parser. Frozen 2026-11-19. |
| EXTERNAL spec | Third-party, received 2026-11-19. Frozen. |

Every claim of both sources (5,160 in all) was inventoried in a claim ledger and checked against the parser and the files. Each fact here carries the ids of the claims it settles in an HTML comment, such as `<!-- EXT-<section>-<n> INT-<section>-<n> -->`; a check confirms that every ledger id appears in this document, so nothing was dropped. Section references to the sources are written `INT §n` and `EXT §n`. Facts that neither source states are marked **(new)**.

## Evidence levels

| Code | Meaning |
| --- | --- |
| **E** | **Export.** Reproduces Capture's own output (`pstxnet.dat`, `pstchip.dat`, `pstxprt.dat`, a BOM, or an Allegro netlist) on the designs that ship one. |
| **S** | **Structural.** An independent reader built only from the stated layout consumed every stream of the kind to its exact last byte on every file in scope, with every field check passing. Proves the layout, not the meaning of a field. |
| **T** | **Test.** A unit or integration test in universal-netlist reproduces it. A test on synthetic data proves our implementation, not Capture's behaviour; such facts stay unverified until a real file confirms them. |
| **O** | **Observed.** Holds on every case in our data, with a stated count, but is not tied to an export or a full-stream read. |

Checks cited as `checks/<area>/<script>` belong to our private verification harness, which runs on the corpus below. They are named so each fact can be traced to the check that produced it.

## Corpus

Counts are over these files unless a fact says otherwise (checked 2026-11-20):

- **Paths.** 191 `.dsn` paths in `test-fixtures/cadence` (18 designs) and `designs-dataset/cadence-corpus`. 71 are not OrCAD files (Proteus ISIS, Specctra, Allegro text and others) and are excluded.
- **OrCAD files.** 120 compound files: 105 with Library version 3.x (98 at 3.2, 7 at 3.3) and 15 below 3 (14 at 2.0, 1 at 1.1). 27 more `.OLB` part libraries are read where a chapter says so.
- **Version-3 scope** (the default for layout facts): 105 files, 451 page streams, 105 Cache streams, 109 Hierarchy streams, 595,686 framed records. 17 of the 18 fixtures are version 3.
- **Distinct files.** Some corpus files are byte copies of fixtures. Counts that deduplicate by content say so (the version-3 scope has 89 distinct files).
- **Exports.** 16 fixtures and 89 corpus designs ship `pstxnet.dat`; 42 designs ship `pstchip.dat`. Exports older than their design are reported apart.

## Reading a chapter

Each chapter opens with the structures it describes, verified facts first. Then, as needed:

- **Refuted:** claims the files disprove, with what the files show instead.
- **Unresolved conflicts:** where the sources disagree and the evidence does not decide, both readings and what would settle it.
- **Parser divergences:** where universal-netlist's parser does something the files contradict, with the impact.
- **Unverified:** claims we could not check, kept in full with the reason (usually that no real file has the feature).
- **Open questions:** what is unknown, and what our data shows about it.
- **Parser coverage:** one line on which parts the parser reads.

## Contents

1. Container and streams
2. Primitive encodings
3. Record framing and structure types
4. The Library stream
5. Cache, symbols, packages and parts
6. Page stream
7. Page objects
8. Graphic primitives
9. Text, fonts, colours and display
10. Schematics, hierarchy and occurrences
11. Connectivity and net naming
12. Directory and auxiliary streams
13. Constraint storage
14. CIS storages and Do Not Install
15. HSObjects, coverage and remaining notes
16. Password-protected designs (SYENCRYPT01)
17. Versions
18. Worked example: a blank design

## 1. Container and streams

A `.DSN` file is a Compound File Binary (CFB, also called OLE2 or structured storage, MS-CFB) container of major version 3. Every byte of schematic data lives in named streams inside its directory tree; storages only group streams. **S** (120/120 OrCAD files open as CFB major version 3 with an independent reader, every stream reachable from the root). <!-- EXT-0.3-001 EXT-1-001 INT-1-001 -->

The parser opens the container with `OleReader` (`src/parsers/ole-reader/`) and reads streams by path. **O** (`checks/base/code_check.ts` reads Library and pages by path from MULTIO.DSN). <!-- INT-1-003 -->

Counts in this chapter cover the 120 OrCAD files of the check set (the version-3 fixtures and corpus designs plus the 15 designs below Library version 3, §17). Where a count says "3.x files" it covers the 105 files at Library version 3.2 or 3.3.

### 1.1 CFB header

The header is the general CFB header with these fixed values. Every structure not named here (FAT, mini FAT, DIFAT chains, directory sectors) follows the general CFB rules. **S** (120/120). <!-- EXT-1.1.1-001 -->

| Offset | Type | Name | Value | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `u8[8]` | signature | `D0 CF 11 E0 A1 B1 1A E1` | **S** (120/120) | <!-- EXT-1.1.1-002 --> |
| +0x08 | `u8[16]` | clsid | all zero | **S** (120/120) | <!-- EXT-1.1.1-003 --> |
| +0x18 | `u16` | minor_version | `0x003E` | **S** (120/120) | <!-- EXT-1.1.1-004 --> |
| +0x1A | `u16` | major_version | 3 | **S** (120/120) | <!-- EXT-1.1.1-005 --> |
| +0x1C | `u16` | byte_order | `0xFFFE` | **S** (120/120) | <!-- EXT-1.1.1-006 --> |
| +0x1E | `u16` | sector_shift | 9 (512-byte sectors) | **S** (120/120) | <!-- EXT-1.1.1-007 --> |
| +0x20 | `u16` | mini_sector_shift | 6 (64-byte mini sectors) | **S** (120/120) | <!-- EXT-1.1.1-008 --> |
| +0x22 | `u8[6]` | reserved | all zero | **S** (120/120) | <!-- EXT-1.1.1-009 --> |
| +0x28 | `u32` | num_directory_sectors | 0 | **S** (120/120) | <!-- EXT-1.1.1-010 --> |
| +0x2C | `u32` | num_fat_sectors | CFB rule: equals the DIFAT length, and every listed FAT sector is marked FATSECT | **S** (120/120) | <!-- EXT-1.1.1-011 --> |
| +0x30 | `u32` | first_directory_sector | CFB rule: the directory chain starts here (5,830 allocated entries reached) | **S** (120/120) | <!-- EXT-1.1.1-012 --> |
| +0x34 | `u32` | transaction_signature | 0 | **S** (120/120) | <!-- EXT-1.1.1-013 --> |
| +0x38 | `u32` | mini_stream_cutoff | 4096 | **S** (120/120) | <!-- EXT-1.1.1-014 --> |
| +0x3C | `u32` | first_minifat_sector | CFB rule (every small stream decodes) | **S** (120/120) | <!-- EXT-1.1.1-015 --> |
| +0x40 | `u32` | num_minifat_sectors | CFB rule | **S** (120/120) | <!-- EXT-1.1.1-016 --> |
| +0x44 | `u32` | first_difat_sector | CFB rule; the chain yields num_fat_sectors entries | **S** (120/120) | <!-- EXT-1.1.1-017 --> |
| +0x48 | `u32` | num_difat_sectors | 0 exactly when num_fat_sectors ≤ 109; non-zero above (1 file) | **S** (120/120) | <!-- EXT-1.1.1-018 --> |
| +0x4C | `u32[109]` | difat | the first min(109, num_fat_sectors) FAT sector numbers, then FREESECT | **S** (120/120) | <!-- EXT-1.1.1-019 --> |

The file length is a whole number of 512-byte sectors. **S** (120/120). <!-- EXT-1.1.1-020 -->

A general CFB reader reads every file: a 150-line reader (`checks/base/cfb.py`) decodes all 120. Nothing in the decoded streams depends on the sector size, but every file uses 512-byte sectors, so a different sector size is untested. **S** (120/120). <!-- EXT-1.1.1-021 -->

### 1.2 Directory entries

A directory entry has a CFB object type:

| Type | Meaning | Evidence | Ids |
| --- | --- | --- | --- |
| 0 | Unused entry: empty name, unreachable from the tree. Unused entries do occur. | **S** (222 entries) | <!-- EXT-16.9.1-002 EXT-1.1.2-007 --> |
| 1 | Storage, with children or empty | **S** (1,457 entries) | <!-- EXT-16.9.1-003 --> |
| 2 | Stream | **S** (4,253 entries) | <!-- EXT-16.9.1-004 --> |
| 5 | Root, named `Root Entry`; always entry 0 | **S** (120/120) | <!-- EXT-16.9.1-005 --> |

Fixed field values per entry type:

| Entry | CLSID | State bits | Creation FILETIME | Modification FILETIME | Evidence | Ids |
| --- | --- | --- | --- | --- | --- | --- |
| Root (`Root Entry`, type 5) | 0 | 0 | 0 | time of last save, UTC, non-zero | **S** (120/120) | <!-- EXT-1.1.2-001 --> |
| Storage (type 1) | 0 | 0 | non-zero | non-zero | **S** (1,457 entries, 0 exceptions) | <!-- EXT-1.1.2-002 --> |
| Stream (type 2) | 0 | 0 | 0 | 0 | **S** (4,253 entries, 0 exceptions) | <!-- EXT-1.1.2-003 --> |

- The name buffer is zero-filled after the terminating NUL. **S** (5,830/5,830 allocated entries). <!-- EXT-1.1.2-006 -->
- Every allocated entry is reachable from the root; there are no orphans. **S** (5,830/5,830). <!-- EXT-1.1.2-008 -->

**Container time stamps.** The CFB FILETIMEs are UTC and carry no schematic data; the format's own time stamps are in §2.7. Only storages and the root carry non-zero FILETIMEs (streams: 4,253 all zero; storages: 1,457 non-zero). **O** (120 files). <!-- EXT-1.1.2-010 EXT-2.6.2-006 -->

- The root's modification time is never earlier than `Library.modified` (§2.7): it lies 0 to 2 s later on 101 of 105 3.x files and 2 to 10 s later on the other 4 (2.5 s on HB1A-AAFM, 8.3 s on BeagleBoard-xM, the maximum). **O** (105 files). <!-- EXT-1.1.2-004 EXT-4.4-005 -->
- The `* Directory` save times and `Library.modified` agree with the root modification time within 2 s, which places those Unix times in UTC. **O** (105/105). <!-- EXT-2.6.1-005 -->
- The modification time of each `Views/<s>` storage lies within 60 s of the save time in the `* Directory` headers. **O** (162/162 storages in 105 3.x files; 161 listed in Views Directory, 1 unlisted). <!-- EXT-1.1.2-005 -->

### 1.3 Entry names and paths

A stream is identified by its path: the names of its ancestor storages and its own name joined by `/`, with no leading separator. Storages hold no data of their own, and an empty storage is legal and carries no information (`Cells`, `Parts` and `ExportBlocks` are empty in every file). **S** (every stream of 120 files resolves). <!-- EXT-1.1.3-001 -->

- An entry name is UTF-16LE, NUL-terminated, at most 31 code units before the NUL. **S** (5,830 names). <!-- EXT-1.1.3-002 EXT-2.3.1-007 -->
- Every code unit is at most U+007F. **S** (5,830/5,830). <!-- EXT-1.1.3-003 -->
- The only control characters are U+0002 (87 occurrences) and U+0003 (47 occurrences). **S** (5,830 names). <!-- EXT-1.1.3-010 -->
- Names compare exactly and case-sensitively, and fixed names occur in one spelling. The fixed name of the type streams under `Symbols` and `Graphics` is `$Types$` in all 120 files; no stream is named plain `Types`. **O** (120/120). <!-- EXT-1.1.3-004 -->

**Escapes.** A design-chosen name holding `/` or `:` is stored in the container with each character replaced by a control code unit:

| Logical character | Stored code unit | Evidence | Ids |
| --- | --- | --- | --- |
| `/` | U+0002 | **O** (89/89 escaped page names) | <!-- EXT-1.1.3-005 EXT-16.9.2-002 --> |
| `:` | U+0003 | **O** (89/89 escaped page names) | <!-- EXT-1.1.3-006 EXT-16.9.2-003 --> |

- Replacing U+0002 with `/` and U+0003 with `:` in a page-stream name recovers the logical page name, the one stored in the page record. Compare a container name with a name stored inside a stream only after this replacement. **O** (89/89). <!-- EXT-0.4-001 EXT-1.1.3-014 -->
- The escape applies to `Views/<s>/Pages/<p>` page streams. **O** (89 escaped page names). It is untested for the `Views/<s>` storage and the CIS per-page stream (*unverified*, see Unverified below). <!-- EXT-1.1.3-009 -->
- Inside streams a name keeps its logical form with `/` and `:` unescaped: the page record holds the logical page name. **O** (89/89 escaped pages). The Views Directory and Schematic stream forms, and the exception for the page-name list of `SchematicInfoStream`, are untested because no escaped folder name occurs. <!-- EXT-1.1.3-011 EXT-16.9.2-004 -->

**Name clashes.** A design-chosen name can equal a fixed name at the same level: a schematic folder named `Schematic` (storage `Views/Schematic`, holding the stream `Views/Schematic/Schematic`) occurs in 3 files (BeagleBoard-xM twice, ONYXPSU). No page named `Schematic` or `Library` and no CIS name clash occurs. **O** (3 files). <!-- EXT-1.1.3-017 -->

Classify a stream by its position in the path, never by its leaf name alone: a stream directly under `Views/<s>/Pages/` is a page whatever its name, and the root `Library` is matched by its full path. **O** (the `Views/Schematic` folder in 3 files reads correctly). <!-- EXT-1.1.3-018 -->

The root schematic name stored in the Library suffix names one `Views/<s>` storage after the escape mapping. **O** (105/105; no root name needs escaping). <!-- EXT-4.12-010 -->

### 1.4 Stream inventory

The root of the container holds these entries. Presence counts are over the 120 files.

| Entry | Kind | Presence | Content | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| `Library` | stream | always (120/120) | Database header, version, fonts, defaults, design string table (§4). Decodes alone to its exact end on 105/105 3.x files. | **S** | <!-- EXT-1.2.2-001 --> |
| `Cache` | stream | always (120/120) | Cached library symbols, packages and devices (§5); five tables read to the exact end on 105/105. | **S** | <!-- EXT-1.2.2-002 --> |
| `DsnStream` | stream | 102 of 120: absent in 3 Library-3.2 files (BeagleBoard-xM fixture, its corpus copy, REMOTE_DIMMING) and in all 15 files below Library 3 | Design-level property record (§12.3) | **O** | <!-- EXT-1.2.2-003 INT-13.2-009 --> |
| `HSObjects` | stream | all 105 3.x files; absent in 11 of the 15 files below 3 (the 1.1 file and 10 of 14 at 2.0) | Two counted tables (§12.4, §15) | **O** | <!-- EXT-1.2.2-004 --> |
| `NetBundleMapData` | stream | 102 of 120: absent in the same 3 Library-3.2 files as `DsnStream` and in all 15 files below 3 | Net-bundle definitions (§12.5, §17.3) | **O** | <!-- EXT-1.2.2-005 --> |
| `AdminData` | stream | all 105 3.x files; absent in 11 of the 15 files below 3, including fixture GPR_LF.DSN (2.0) | 6 opaque bytes (§12.6) | **O** | <!-- EXT-1.2.2-006 --> |
| `BundleMapData` | stream, 4 bytes | 15 files (11 at Library 3.2, 4 at 3.3), e.g. HB1A-AAFM.DSN, nixie.dsn, reComputer J401_V1.0.DSN | Not decoded | **O** | <!-- EXT-1.2.1-002 --> |
| `AnnotateCtrl` | stream | optional (1 of 120) | Annotation reference ranges (§12.7) | **O** | <!-- EXT-1.2.2-007 --> |
| `Views Directory` | stream | always | Schematic folders with time stamps (§12.2) | **S** | <!-- EXT-1.2.2-008 --> |
| `Symbols Directory` | stream | always | Standalone symbol list (§12.2) | **S** | <!-- EXT-1.2.2-009 --> |
| `Packages Directory` | stream | always | Package list (§12.2) | **S** | <!-- EXT-1.2.2-010 --> |
| `Cells Directory` | stream | always | Cell list (§12.2) | **S** | <!-- EXT-1.2.2-011 --> |
| `Parts Directory` | stream | always | Part-view list (§12.2) | **S** | <!-- EXT-1.2.2-012 --> |
| `ExportBlocks Directory` | stream | always | Empty list (§12.2) | **S** | <!-- EXT-1.2.2-013 --> |
| `Graphics Directory` | stream | always | Empty list (§12.2) | **S** | <!-- EXT-1.2.2-014 --> |
| `Views/` | storage | always, one or more folders | Schematic folders (§1.5) | **S** (120/120) | <!-- EXT-1.2.2-015 --> |
| `Symbols/` | storage | always | The stream `$Types$` plus standalone symbol streams `<n>` | **S** (120/120) | <!-- EXT-1.2.2-016 --> |
| `Packages/` | storage | always | Package streams `<n>` | **S** (120/120) | <!-- EXT-1.2.2-017 --> |
| `Cells/`, `Parts/`, `ExportBlocks/` | storage | always, always empty | none | **S** (120/120) | <!-- EXT-1.2.2-018 --> |
| `Graphics/` | storage | always | Exactly one stream, `$Types$`, of 0 bytes | **S** (120/120) | <!-- EXT-1.2.2-019 EXT-1.2.4-004 --> |
| `CIS/` | storage | optional | Variants, groups, BOM data (§14) | | |
| `LayoutReuse/` | storage | optional | `ReuseSchematics.txt` | | |
| `CCSStorage/` | storage | none of 120 files | *unverified*, see Unverified below | | |

The seven `* Directory` streams are present on 120/120 and each decodes (saved `u32`, `u16` count, entries) to its exact end on 735/735 (105 3.x files × 7). <!-- EXT-1.2.2-008 EXT-1.2.2-009 EXT-1.2.2-010 EXT-1.2.2-011 EXT-1.2.2-012 EXT-1.2.2-013 EXT-1.2.2-014 -->

The inventory as a whole: every root entry the external source lists occurs with the stated kind. Its presence column holds with the exceptions in the table above (`DsnStream` and `NetBundleMapData` absent in 18 files, `HSObjects` and `AdminData` in 11), the type streams are `$Types$`, the root also holds `BundleMapData` (15 files), and no file has `Constraint` or `CCSStorage`. **O** (120 files). <!-- EXT-0.3-002 EXT-1.2.1-001 -->

The parser reads none of `AdminData`, `Cells`, `ExportBlocks`, `Graphics`, `HSObjects`, `Parts`, `Symbols`, `DsnStream`, `NetBundleMapData` and `BundleMapData`. The first seven are present in every 3.x file (`AdminData` and `HSObjects` are absent in 11 files below 3, including the GPR_LF fixture); `DsnStream`, `NetBundleMapData` and `BundleMapData` are present in some files only. <!-- INT-13.2-009 -->

### 1.5 Schematic folders under `Views/`

| Path | Kind | Count | Content | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| `Views/<s>` | storage | 1 or more per file (180 folders in 120 files) | One schematic folder | **S** (120/120) | <!-- EXT-1.2.3-001 --> |
| `Views/<s>/Schematic` | stream | exactly 1 per folder | Schematic header: name, id watermark, page order, id registry (§10) | **S** (180/180) | <!-- EXT-1.2.3-002 --> |
| `Views/<s>/Pages` | storage | exactly 1 per folder | Pages | **S** (180/180) | <!-- EXT-1.2.3-003 --> |
| `Views/<s>/Pages/<p>` | stream | 1 or more per folder | One schematic page (§6); 451 3.x pages read to the exact end | **S** (180/180) | <!-- EXT-1.2.3-004 --> |
| `Views/<s>/Hierarchy/Hierarchy` | stream | root folder | Occurrence tree (§10) | | |
| `Views/<s>/CISSchematic/...` | storage | optional | `VariantOCCStorage/VariantOCCStream`, `SchematicInfoStorage/{SchematicInfoStream, <p>...}` (§14) | | |

The deepest path observed has 5 components (5 files); 115 files reach 4. **O** (120 files). See Unverified below for the 6-component path the external source names. <!-- EXT-1.1.2-009 -->

**Order and dependencies.**

- The physical order of streams and sectors in the container carries no meaning; streams are located only through the directory tree. **O** (120 files). <!-- EXT-1.3.1-001 EXT-18.2-022 -->
- `Library` depends on no other stream: it decodes alone to its exact end. **S** (105/105). <!-- EXT-1.3.3-001 -->
- Every record-bearing stream (pages, `Cache`) refers to the Library string table, so a file without `Library` cannot be decoded. **S** (`Library` present on 120/120; all page and Cache string references resolve through it). <!-- EXT-1.2.2-023 -->
- The `* Directory` streams have no byte-level dependency on other streams. **O** (735/735 decode alone). The same claim for `Views/<s>/Schematic`, `HSObjects`, constraint and CIS streams is untested, because those streams were not decoded here. <!-- EXT-1.3.3-005 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| No other entry occurs at the root | EXT §1.2.1 | The root stream `BundleMapData` (4 bytes) occurs in 15 files (11 at 3.2, 4 at 3.3); INT lists it | **O** (15 files) | <!-- EXT-1.2.1-002 --> |
| `DsnStream` is always present | EXT §1.2.2 | Absent in 3 Library-3.2 files (BeagleBoard-xM fixture and corpus copy, REMOTE_DIMMING) and all 15 files below 3; INT's "some designs only" holds | **O** (18 files) | <!-- EXT-1.2.2-003 --> |
| `NetBundleMapData` is always present | EXT §1.2.2 | Absent in the same 18 files as `DsnStream` | **O** (18 files) | <!-- EXT-1.2.2-005 --> |

### Unverified

- *unverified*: a path reaches 6 components, `CIS/VariantStore/Groups/<g>/<sg>/<sg>`. No file has sub-group streams (the maximum depth seen is 5). Settled by a CIS design with nested variant sub-groups. <!-- EXT-1.1.2-009 -->
- *unverified*: a trailing `.` is allowed in an entry name (page names). No entry name in 120 files ends in `.`. <!-- EXT-1.1.3-007 -->
- *unverified*: an empty entry name is allowed only for a CIS per-page stream directly under `Views/<s>/CISSchematic/SchematicInfoStorage/`. No empty name occurs in 120 files. <!-- EXT-1.1.3-008 -->
- *unverified*: such an empty-named stream has a path ending in `/`, which a path-based CFB lookup resolves to the parent storage; a reader must then enumerate and open streams through directory entries rather than by path, and must not reject the file. No such stream occurs; `OleReader` resolves by path and would collide on one. <!-- EXT-1.1.3-016 -->
- *unverified*: the escape also applies to the `Views/<s>` storage name and to the CIS per-page stream `Views/<s>/CISSchematic/SchematicInfoStorage/<p>`; for example a folder listed as `A/B` in Views Directory is stored as `A` U+0002 `B`. No folder name or Views Directory entry in 120 files holds `/` or `:`. <!-- EXT-1.1.3-009 EXT-1.1.3-013 -->
- *unverified*: Views Directory and the Schematic stream store folder and page names in logical form, and the page-name list of `SchematicInfoStream` (§14) is the one in-stream place that keeps the escaped form. No escaped folder name occurs. <!-- EXT-1.1.3-011 EXT-16.9.2-004 -->
- *unverified*: a variant or group name in the CIS tree may equal a fixed storage name of that tree. No CIS name clash occurs. <!-- EXT-1.1.3-017 -->
- *unverified*: the authored page order of a folder is stored in its Schematic stream, not in the container. The Schematic stream was not decoded here (§10 owns it). <!-- EXT-1.3.1-002 -->
- *unverified*: `DsnStream` properties depend on the Library string table. Its property pairs were not decoded here. <!-- EXT-1.3.3-004 -->
- *unverified* (no `CCSStorage` in any of 120 files; the checker in `check_base.py` ran on 0 instances): `CCSStorage` is an optional storage holding exactly two streams. <!-- EXT-12.9-001 -->
  - `CCSStorage/___IndexInfoForMiscStorage` uses the envelope of the constraint index streams (§13.2) with one row: +0x00 `u32 count`, always 1; +0x04 `l32bytes name`, the name of the sibling data stream; then `l32bytes descr`, a description text, where the stream ends. <!-- EXT-12.9.1-001 EXT-12.9.1-002 EXT-12.9.1-003 EXT-12.9.1-004 -->
  - `descr` has exactly the shape `{ "FileName": <token>,` / `"Descr": <word> <word>,` / `"CreationTime": "dd/dd/dddd  dd:dd:dd" ` / `}`. Lines end in LF, each continuation line starts with a tab and a space, two spaces separate date and time, and one space precedes the last LF. <!-- EXT-12.9.1-005 EXT-12.9.1-006 -->
  - In `descr`, `<token>` and the two words are unquoted, so `descr` is not strict JSON, and `<token>` differs from `name`. <!-- EXT-12.9.1-007 EXT-12.9.1-008 -->
  - `CCSStorage/<n>` is printable-ASCII Base64 with LF line breaks, at most 72 characters per line, no CR. Decoded, it is a SQLite 3 database file: it starts with `SQLite format 3\0`, has page size 8192 and is 2,097,152 bytes long. <!-- EXT-12.9.2-001 EXT-12.9.2-002 -->
- *unverified* (no `Views/<s>/Constraint` storage, hence no `DCF` stream, in any of 120 files; the ZIP checker `check_zip` in `check_base.py` ran on 0 instances): `Views/<s>/Constraint/DCF` is a ZIP archive. It starts with `50 4B 03 04`; local file records come first from offset 0, contiguous, then the central directory in the same member order, then the end-of-central-directory record, and nothing follows. Grammar: `DCF := LocalRecord[n] CentralHeader[n] EndRecord`; `LocalRecord := LocalHeader name[name_len] payload[size]`. Every member is stored (method 0, compressed size equals uncompressed size); each member's CRC-32 (reflected polynomial `0xEDB88320`, initial value and final XOR `0xFFFFFFFF`) is in both headers and matches the payload; DOS time and date words are 0; members are in ascending byte order of name. The three header layouts follow the list. <!-- EXT-13.3.1-001 EXT-13.3.1-002 EXT-13.3.1-003 EXT-13.3.1-004 EXT-13.3.1-005 EXT-13.3.1-006 EXT-13.3.1-007 -->
- *unverified* (no DCF): the archive members. `FileType.txt` (always; the 6 bytes `Design`, no newline); `FormatVersion.txt` (always; ASCII `<major>.<minor>`, no newline, §17.1); `Header.xml` (always; §13.4.2); `objects/Design.xml` (always; §13.4.10); `objects/DiffPair.xml` (optional; §13.4.7); `objects/Gate.xml` (always; §13.4.9); `objects/Net.xml` (always; §13.4.4); `objects/NetClass.xml` (optional; §13.4.8); `objects/Pin.xml` (always; §13.4.5); `objects/Xnet.xml` (optional; §13.4.6); `userPropertyDefinitions.xml` (always; §13.4.11). An archive has 8, 9, 10 or 11 members. A reader locates members by name through the central directory, assumes no fixed member count or list, and accepts version strings beyond the four known. <!-- EXT-13.3.5-001 EXT-13.3.5-002 EXT-13.3.5-003 EXT-13.3.5-004 EXT-13.3.5-005 EXT-13.3.5-006 EXT-13.3.5-007 EXT-13.3.5-008 EXT-13.3.5-009 EXT-13.3.5-010 EXT-13.3.5-011 EXT-13.3.5-012 EXT-13.3.5-018 -->

DCF local file header (*unverified*, no DCF in the data):

| Offset | Type | Name | Value | Ids |
| --- | --- | --- | --- | --- |
| +0x00 | `u32` | signature | `0x04034B50` (`PK\3\4`) | <!-- EXT-13.3.2-001 --> |
| +0x04 | `u16` | version_needed | 20 | <!-- EXT-13.3.2-002 --> |
| +0x06 | `u16` | flags | 0 | <!-- EXT-13.3.2-003 --> |
| +0x08 | `u16` | method | 0 (stored) | <!-- EXT-13.3.2-004 --> |
| +0x0A | `u16` | mod_time | 0 | <!-- EXT-13.3.2-005 --> |
| +0x0C | `u16` | mod_date | 0 | <!-- EXT-13.3.2-006 --> |
| +0x0E | `u32` | crc32 | CRC-32 of the payload | <!-- EXT-13.3.2-007 --> |
| +0x12 | `u32` | compressed_size | payload length | <!-- EXT-13.3.2-008 --> |
| +0x16 | `u32` | uncompressed_size | equals compressed_size | <!-- EXT-13.3.2-009 --> |
| +0x1A | `u16` | name_len | length of name | <!-- EXT-13.3.2-010 --> |
| +0x1C | `u16` | extra_len | 0 | <!-- EXT-13.3.2-011 --> |
| +0x1E | ASCII[name_len] | name | member path | <!-- EXT-13.3.2-012 --> |
| follows name | bytes[compressed_size] | payload | member content, stored as is | <!-- EXT-13.3.2-013 --> |

DCF central directory header (*unverified*):

| Offset | Type | Name | Value | Ids |
| --- | --- | --- | --- | --- |
| +0x00 | `u32` | signature | `0x02014B50` (`PK\1\2`) | <!-- EXT-13.3.3-001 --> |
| +0x04 | `u16` | version_made_by | 0 | <!-- EXT-13.3.3-002 --> |
| +0x06 | `u16` | version_needed | 20 | <!-- EXT-13.3.3-003 --> |
| +0x08 | `u16` | flags | 0 | <!-- EXT-13.3.3-004 --> |
| +0x0A | `u16` | method | 0 | <!-- EXT-13.3.3-005 --> |
| +0x0C | `u16` | mod_time | 0 | <!-- EXT-13.3.3-006 --> |
| +0x0E | `u16` | mod_date | 0 | <!-- EXT-13.3.3-007 --> |
| +0x10 | `u32` | crc32 | as the local header | <!-- EXT-13.3.3-008 --> |
| +0x14 | `u32` | compressed_size | as the local header | <!-- EXT-13.3.3-009 --> |
| +0x18 | `u32` | uncompressed_size | as the local header | <!-- EXT-13.3.3-010 --> |
| +0x1C | `u16` | name_len | as the local header | <!-- EXT-13.3.3-011 --> |
| +0x1E | `u16` | extra_len | 0 | <!-- EXT-13.3.3-012 --> |
| +0x20 | `u16` | comment_len | 0 | <!-- EXT-13.3.3-013 --> |
| +0x22 | `u16` | disk_start | 0 | <!-- EXT-13.3.3-014 --> |
| +0x24 | `u16` | internal_attributes | 0 | <!-- EXT-13.3.3-015 --> |
| +0x26 | `u32` | external_attributes | 0 | <!-- EXT-13.3.3-016 --> |
| +0x2A | `u32` | local_header_offset | offset of the matching local header from the stream start | <!-- EXT-13.3.3-017 --> |
| +0x2E | ASCII[name_len] | name | the local header's name bytes | <!-- EXT-13.3.3-018 --> |

DCF end of central directory record (*unverified*):

| Offset | Type | Name | Value | Ids |
| --- | --- | --- | --- | --- |
| +0x00 | `u32` | signature | `0x06054B50` (`PK\5\6`) | <!-- EXT-13.3.4-001 --> |
| +0x04 | `u16` | disk | 0 | <!-- EXT-13.3.4-002 --> |
| +0x06 | `u16` | central_start_disk | 0 | <!-- EXT-13.3.4-003 --> |
| +0x08 | `u16` | disk_entries | member count | <!-- EXT-13.3.4-004 --> |
| +0x0A | `u16` | total_entries | member count | <!-- EXT-13.3.4-005 --> |
| +0x0C | `u32` | central_size | byte length of the central directory | <!-- EXT-13.3.4-006 --> |
| +0x10 | `u32` | central_offset | offset of the first central header | <!-- EXT-13.3.4-007 --> |
| +0x14 | `u16` | comment_len | 0 | <!-- EXT-13.3.4-008 --> |
| +0x16 | | end | 22 bytes; the stream ends here | <!-- EXT-13.3.4-009 --> |

### Open questions

- How a backslash, `!` or a character above U+007F would be stored in an entry name. None occurs in the 5,830 names. <!-- EXT-1.oq-001 -->
- What the embedded `CCSStorage` database holds; the external source's theory is a constraint or component database embedded by the saving tool, outside this format. No file has `CCSStorage`. <!-- EXT-12.9.2-003 -->
- What the `CCSStorage` database and the `DsnStream` kind-0 extension record contain. No `CCSStorage` occurs; the `DsnStream` record belongs to §12.3. <!-- EXT-12.oq-006 -->

Parser coverage: the parser reads the CFB header, FAT, mini FAT, DIFAT and directory (`ole-reader.ts`), resolves streams by path, matches the root `Library` by full path and enumerates `Views/<s>/Pages/<p>` and `Packages/<n>`. It does not check the fixed header values (it reads `major_version` without checking it), does not use CFB time stamps or the escape mapping, and reads none of `AdminData`, `HSObjects`, `DsnStream`, `NetBundleMapData`, `BundleMapData`, `AnnotateCtrl`, the `* Directory` streams, `Symbols/`, `Graphics/`, `CCSStorage` or `Constraint`.

<!-- meta: EXT-0.1-003 EXT-1-002 EXT-16.9.1-001 EXT-16.9.2-001 -->

---

## 2. Primitive encodings

The streams are built from a small set of scalar, string and packed encodings, named here and referred to by type name in every later layout. Counts below come from full-stream decodes of the 105 files at Library version 3.2 or 3.3 (Library to its exact end 105/105, 451 pages and 105 Caches to the exact end, 735 `* Directory` streams to the exact end, 38,826 primitive entries), unless a count says otherwise.

### 2.1 Integers

All multi-byte integers in every binary stream are little-endian, signed integers are two's complement, and each type has a fixed width. **S** (every stream above consumed to its exact end with these widths). <!-- EXT-2.1-001 INT-1-002 INT-3.2-001 EXT-8-002 -->

| Type | Bytes | Encoding | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `u8` | 1 | unsigned | **S** | <!-- EXT-2.1-004 --> |
| `i8` | 1 | two's complement | **S** | <!-- EXT-2.1-005 --> |
| `u16` | 2 | unsigned, little-endian | **S** | <!-- EXT-2.1-006 --> |
| `i16` | 2 | two's complement, little-endian | **S** | <!-- EXT-2.1-007 --> |
| `u32` | 4 | unsigned, little-endian | **S** | <!-- EXT-2.1-008 --> |
| `i32` | 4 | two's complement, little-endian | **S** | <!-- EXT-2.1-009 --> |
| `u64` | 8 | unsigned, little-endian; used only for `filetime64` (§2.7) | **S** (13,612 FILETIMEs in `* Directory` entries; no other `u64` in the decoded streams) | <!-- EXT-2.1-010 --> |

- No decoded field is floating point (Library, pages, Cache, primitives, directories). The opaque regions are not proven free of floats. **S** (every decoded field). <!-- EXT-0.2-003 EXT-2.1-003 -->
- The chapters on the Schematic and Hierarchy streams (§10) state little-endian integers and stream-relative offsets; little-endian holds wherever those layouts were decoded, and those two streams were not decoded in this check. <!-- EXT-10-005 -->
- Element counts of arrays inside records (pins, display properties, aliases, primitive lists, directory entries) are `u16`. **S** (every stream read to its exact end). The page-name list count of the Schematic stream, also listed by the external source, is unchecked (Unverified below). <!-- EXT-2.1.1-001 -->
- Reader guidance: bound every count by the bytes left in the stream before allocating. No count in 120 files exceeds the bytes remaining. <!-- EXT-2.1.1-008 -->
- Minimum element sizes useful for that bound: 3 bytes per string-table entry (`u16` + n + 1) and 25 bytes plus the name per `* Directory` entry. **S** (735 directory streams to the exact end). The external source's 30 or 62 bytes per `HSObjects` row is unchecked (Unverified below). <!-- EXT-2.1.1-009 -->

### 2.2 Strings

String payloads are sequences of 8-bit code units; no code page is stored anywhere in the format. **S** (no code-page field; 893 string-table entries carry bytes ≥ 0x80). <!-- EXT-2.3-001 EXT-2.3.7-001 -->

**`lstr`**, the counted NUL-terminated string, is the usual string form, used for almost every string in every record:

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `u16` | n | payload length in bytes, terminator excluded | **S** | <!-- EXT-2.3.2-001 EXT-2.1.1-002 --> |
| +0x02 | `u8[n]` | payload | string bytes, never `00` | **S** | <!-- EXT-2.3.2-002 --> |
| +0x02+n | `u8` | nul | always `00` | **S** | <!-- EXT-2.3.2-003 EXT-2.3.2-005 --> |

**S** (251,796 string-table entries, 840 part fields, 6,806 directory names, 105 root names and every page and Cache string: terminator `00` in all, payload without `00`, size n + 3). <!-- EXT-0.2-004 EXT-2.3.1-001 EXT-5.1-001 EXT-8-003 INT-3.1-001 -->

- An `lstr` is n + 3 bytes long; the empty string is `00 00 00`, a zero length followed by the terminator alone. **S** (string-table entry 0 on 105/105). <!-- EXT-2.3.2-004 EXT-5.1-002 INT-3.1-002 -->
- The payload is at most 65,535 bytes (the `u16` bound). The longest observed is 1,421 bytes, in the Library string table. **S**. <!-- EXT-2.3.2-006 -->
- `cstr` is 7-bit ASCII (the Library introduction is ASCII on 120/120); an `lstr` payload may hold any byte except `00` (0 of 251,796 contain one). **S**. <!-- EXT-2.3.7-002 -->

**`fixstr[N]`** is N bytes, NUL-terminated when shorter than N. It is used for the Library database-type introduction (N = 32; NUL at +31 on 120/120) and the LOGFONT face name (N = 32; a NUL on 2,653/2,653 rows). **S**. <!-- EXT-2.3.1-003 -->

The Library font table holds 60-byte LOGFONTA rows. **S** (the Library decodes through the string table and suffix to its exact end on 105/105 with that row size). <!-- INT-13.4-011 -->

**Character set.** Bytes ≥ 0x80 occur in 893 Library string-table entries. All 893 are valid Windows-1252, 804 are valid GBK and 2 are valid UTF-8; 433 hold runs of four or more high bytes. Isolated high bytes are most often 0xB0 (274), 0xB1 (79), 0xB5 (14), 0xA8 (7) and 0xEC (7); 0xFC occurs once and 0x92 never. **O** (893 entries). <!-- EXT-2.3.7-003 -->

- A Windows-1252 byte such as `B5` (µ in `0.1µF`) occurs in the data and reads as written under Windows-1252. **O** (1 file holds `B5 46`). That Capture writes the ANSI code page of the saving machine is not provable from the files (Open questions below). <!-- INT-3.1-003 -->
- The parser decodes every string as Windows-1252, a byte-to-character bijection on 0 to 255 in its decoder, so a design saved under another code page (GBK, for example) reads as the Windows-1252 form of its bytes and re-encoding as Windows-1252 recovers the original bytes. **T** (`binary-reader.ts:28`; 804 GBK-valid strings exist). <!-- INT-3.1-004 -->
- The external source advises Latin-1 (each byte to the code point of the same value) when the code page is unknown. Latin-1 and the parser's Windows-1252 both preserve every byte (Parser divergences). **T** (`binary-reader.test.ts` 'decodes every byte to its own character, so none is lost'). <!-- EXT-2.3.2-007 -->

**Parser string helpers.** `BinaryReader` (`binary-reader.ts`) had three string readers, ported from the C++ reference:

| Reader | Form | Cap | Use | Ids |
| --- | --- | --- | --- | --- |
| `readStringLenZeroTerm` | `lstr` | any `u16` length (the 400-byte cap was removed 2026-11-21); throws on a non-`00` terminator | every DSN string, the Library's included | <!-- INT-3.1-010 INT-3.1-013 --> |
| `readStringZeroTerm` | NUL-terminated, no length | 3500 characters | not called by any DSN parser | <!-- INT-3.1-007 INT-3.1-009 --> |
| `readStringLenTerm` | length-prefixed, no terminator | 400 characters | was not called by any DSN parser; deleted 2026-11-21 | <!-- INT-3.1-008 INT-3.1-009 --> |

The caps, the terminator check and the absence of callers are **O**: `checks/base/code_check.ts` reads a 400-byte `lstr`, throws on 401 bytes and on a non-`00` terminator, and finds 0 call sites of the other two readers in `src/` and `scripts/`. <!-- INT-3.1-009 INT-3.1-010 INT-3.1-013 -->

The 400-byte cap and `readStringLenTerm` are now removed (Parser divergences, Resolved).

### 2.3 String-table references

A string index is a `u32` index into the Library string table (§4); index 0 is the empty string and means "no string". Entry 0 is the only empty entry. **S** (105/105; every index in page and Cache prefix pairs resolves). <!-- EXT-0.2-008 EXT-7.0.5-001 EXT-16.13.2-001 -->

### 2.4 Booleans and flags

The format has no boolean type. Truth values take three forms in the decoded data: a whole integer, a bit in a flag word, and a threshold on a word. **O**. <!-- EXT-2.4-001 -->

| Form | Rule | Example | Evidence | Ids |
| --- | --- | --- | --- | --- |
| Whole integer (`u8` or `u32`) | 0 = false, non-zero = true | page-settings `is_metric` (`u32`) takes only 0 and 1 | **O** (451 pages) | <!-- EXT-2.4-002 EXT-16.13.1-002 --> |
| Flag word | mask test, non-zero = true | wire junction flags (`u8`): bit 0 start, bit 1 end; bits 2 to 7 never set | **O** (85,489 wires) | <!-- EXT-2.4-003 EXT-16.13.1-003 --> |
| Threshold | a pin word ≥ 0x8000 selects ordinal 0x10000 − word | page pin word (§6) | **O** (part pin points match the cached symbol on 11,374 placed parts; bit 15 set on 3,242 pins) | <!-- EXT-16.13.1-005 --> |

The pin-shape word and the part flags, named as flag words by the external source, are unchecked; so is the bit-15 form (Unverified below).

### 2.5 Coordinates

A coordinate is a signed integer whose width, `i16` or `i32`, is a property of the record that holds it. **S** (every record ends exactly at its boundary with these widths). <!-- EXT-2.5.1-001 INT-3.3-001 EXT-0.2-009 -->

| Width | Fields | Evidence | Ids |
| --- | --- | --- | --- |
| `i32` | wire endpoints (start x/y, end x/y) | **S** (85,489 wires) | <!-- INT-3.3-006 --> |
| `i32` | alias location | **S** (16,165 aliases) | <!-- INT-3.3-007 --> |
| `i32` | cached symbol pin start and hot point | **S** (cached pins inside pin frames; 11,374 parts match) | <!-- INT-3.3-008 --> |
| `i32` | corners of graphic primitives | **S** (38,826 primitive entries with consistent lengths) | <!-- EXT-2.5.1-002 --> |
| `i16` | placed-instance location | **S** (15,009 PlacedInstance records) | <!-- INT-3.3-002 --> |
| `i16` | page pin hot point | **S** (63,616 page pin instances) | <!-- INT-3.3-003 --> |
| `i16` | Global, Port and off-page connector location and bbox | **S** (Global 8,342, OffPage 6,491, Port 2,135) | <!-- INT-3.3-004 --> |
| `i16` | SymbolDisplayProp x, y | **S** (65,096 bodies of 14 bytes) | <!-- INT-3.3-005 --> |
| `i16` | instance location and bbox (15,009 placed, 174 drawn, graphics), primitive point lists (length a function of the point count on 1,043 polygons, polylines and Beziers), SymbolVector location (15) | **S** | <!-- EXT-2.5.1-003 --> |

- A wire stores its own `i32` endpoints; each alias is a separate structure nested in the wire with its own `i32` location. **S** (16,165 aliases). <!-- INT-3.3-009 -->
- Point lists of Polygon, Polyline and Bezier primitives, and the bbox of the graphic-instance base, store each point y before x. Every other coordinate pair is x before y. **O** (1,680 discriminating points fall inside the symbol bbox only when read y-first, 0 only x-first; the page-graphic bbox equals the primitive extent read y1, x1, y2, x2 on 2,007 graphics, x-first on 0). <!-- EXT-2.5.1-005 -->
- All 341,956 wire coordinates lie within the `i16` range, and none is negative. **S**. Negative coordinates and objects outside the page border, which the external source allows, do not occur in wires. <!-- EXT-2.5.1-004 -->

### 2.6 Orientation

Orientation is a 2-bit quarter-turn count r (0 to 3) plus a 1-bit mirror flag, packed into the `u16` transform word of placed and drawn instances, connectors, ports, title blocks, ERC objects and graphic instances. **O** (reproduces cached pin positions on 11,374 of 11,648 placed parts with a cached symbol). <!-- EXT-2.5.2-001 -->

| Bits | Meaning | Evidence | Ids |
| --- | --- | --- | --- |
| 0-7 | colour (not checked) | | <!-- EXT-2.5.2-002 --> |
| 8-9 | r | **O** (pin matches) | <!-- EXT-2.5.2-002 --> |
| 10 | mirror | **O** (pin matches) | <!-- EXT-2.5.2-002 --> |
| 11-15 | zero | **O** (40,800 transform words of types 12, 13, 23, 37, 38, 55-62, 65, 77, 89) | <!-- EXT-2.5.2-002 --> |

A symbol-local point (x, y) is mirrored first (x negated), then rotated:

| r | Result | Ids |
| --- | --- | --- |
| 0 | (x, y) | <!-- EXT-2.5.2-005 --> |
| 1 | (y, −x) | <!-- EXT-2.5.2-006 --> |
| 2 | (−x, −y) | <!-- EXT-2.5.2-007 --> |
| 3 | (−y, x) | <!-- EXT-2.5.2-008 --> |

**O** (all pins land on their stored page pins on 11,374 of 11,648 placed parts with a cached symbol, using the external source's placement-box anchor and the best of the cached candidates; 274 match no pin. With the first candidate only the count is 11,296 under that anchor and 11,564 under the stored-bbox anchor. The rotation table is the same under every anchor). <!-- EXT-2.5.2-004 -->

The stored location is applied after the transform. For a placed part, Global, off-page connector or port, the external source anchors the transformed placement box at the location; that rule fits connectors 11,693 hit / 196 miss and parts 11,296 / 352, while anchoring on the stored symbol bbox fits better, 11,885 / 4 and 11,564 / 84 (§6.4). **O**. <!-- EXT-2.5.2-009 -->

### 2.7 Time stamps

| Type | Layout | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `unixtime32` | `u32` | seconds since 1970-01-01T00:00:00 UTC; 0 = not set | **O** (Library created/modified: modified within 0 to 10 s of the UTC CFB root time on 105/105, created ≤ modified, both non-zero; 0 in the Library default page block on 105/105) | <!-- EXT-2.6.1-001 EXT-0.2-007 --> |
| `filetime64` | `u64` | 100-ns ticks since 1601-01-01T00:00:00, in the local wall-clock time of the writing system | **O** (Views Directory modified minus saved, within 14 h, is a whole number of hours on 107 rows and of quarter hours on 12, 119 of 136; the other 17 were not modified in the last save; 13,593 of 13,627 FILETIMEs carry sub-second ticks) | <!-- EXT-2.6.2-001 EXT-0.2-006 --> |

The CFB container's own FILETIMEs are UTC (§1.2).

### 2.8 Fixed values

- `PREAMBLE` is the 4 bytes `FF E4 5C 39`. It occurs where expected on every framed record and on 22,636 primitive wrappers. **S**. <!-- EXT-9-002 -->

### 2.9 Primitive list entries

A primitive list entry starts with its primitive kind code. **S** (first byte = kind on 38,826 entries). <!-- EXT-16.1.2-001 -->

| Kind | Hex | Primitive | Page graphic instance type | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| 40 | `0x28` | Rect, axis-aligned rectangle (§8.6.1) | 55 | **S** (type 55 holds kind 40 on 435/435) | <!-- EXT-16.1.2-003 --> |
| 41 | `0x29` | Line, straight segment (§8.6.2) | 56 | **S** (1,427/1,427) | <!-- EXT-16.1.2-004 --> |
| 42 | `0x2A` | Arc, elliptical arc (§8.6.3) | 57 (unconfirmed) | **S** (1,722 in symbol bodies; no type-57 instance) | <!-- EXT-16.1.2-005 --> |
| 43 | `0x2B` | Ellipse, by its corner box (§8.6.1) | 58 | **S** (119/119) | <!-- EXT-16.1.2-006 --> |
| 44 | `0x2C` | Polygon, filled or not (§8.6.4) | 59 | **S** (1/1) | <!-- EXT-16.1.2-007 --> |
| 45 | `0x2D` | Polyline, open point chain (§8.6.5) | 60 | **S** (31/31) | <!-- EXT-16.1.2-008 --> |
| 46 | `0x2E` | CommentText, free text (§8.6.6) | 61 | **S** (4,107/4,107) | <!-- EXT-16.1.2-009 --> |
| 47 | `0x2F` | Bitmap, raster image (§8.6.7) | 62 | **S** (11/11) | <!-- EXT-16.1.2-010 --> |
| 48 | `0x30` | SymbolVector, a named group of child primitives (§8.8); also structure type 48 | none | **S** (15 vectors framed as type 48: 2 full prefixes, short n = −1, empty preamble) | <!-- EXT-16.1.2-013 --> |
| 87 | `0x57` | Bezier curve (§8.6.5) | 88 (unconfirmed) | **S** (3 in symbol bodies; no type-88 instance) | <!-- EXT-16.1.2-011 --> |
| 90 | `0x5A` | OLE object, embedded (§8.6.8) | 89 | **S** (9/9) | <!-- EXT-16.1.2-012 --> |

- No other kind occurs. **S** (kinds 40 to 48, 87 and 90 only, in 38,826 entries). <!-- EXT-16.1.2-014 -->
- The kind code space is separate from the structure type space except for 48: kinds 40 to 47, 87 and 90 never appear as structure type bytes in frames. **S**. <!-- EXT-16.1.2-002 -->
- Kind 48 occurs only in LibraryPart (24) bodies (10 Cache, 5 Packages); kind 90 only in the GraphicObject of a type-89 instance (9/9). **S**. <!-- EXT-16.1.2-016 EXT-16.1.2-017 -->

**Entry header (wrapped form).**

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `u8` | kind | primitive kind code | **S** (38,826 entries; lists end exactly at the bbox boundary, 11,820 lists) | <!-- EXT-8.4.1-001 --> |
| +0x01 | `u8` | kind_repeat | equals kind | **S** (38,826/38,826) | <!-- EXT-8.4.1-002 --> |
| +0x02 | `u32` | length | see the length rule | **S** (frames all 38,826) | <!-- EXT-8.4.1-003 --> |
| +0x06 | `u32` | reserved | 0 | **S** (38,826/38,826) | <!-- EXT-8.4.1-004 --> |
| +0x0A | | body | kind-specific fields (§8.6) | **S** (polygon, polyline, Bezier length a function of the point count on 1,043/1,043) | <!-- EXT-8.4.1-005 --> |
| after body | `u8[4]` | ext_magic | `PREAMBLE` | **S** (22,636 non-46 entries) | <!-- EXT-8.4.1-006 --> |
| next | `u32` | ext_length | extension size E | **S** (22,636) | <!-- EXT-8.4.1-007 --> |
| next | `u8[E]` | extension | extension records | **S** (22,636) | <!-- EXT-8.4.1-008 --> |

- For kinds other than 46, the body ends at +0x02 + length; the 8-byte wrapper and the extension follow outside `length`, and the entry is 2 + length + 8 + E bytes. **S** (22,636 entries). <!-- EXT-8.4.1-009 -->
- For kind 46 (CommentText) the wrapper sits inside the body after the text; `length` counts from +0x02 to the end of the extension minus the wrapper's own 8 bytes, and the entry is 2 + length + 8 bytes with no wrapper after it. **S** (4,682/4,682 wrapped). <!-- EXT-8.4.1-010 -->
- A second entry form, the bare form of §8.3, exists (new): across all primitive lists of all containers, 8,204 non-46 entries in 19 distinct file names (e.g. HB1A-AAFM.DSN, BeagleBoard-xM_ORCAD.DSN, parallella_schematic.dsn) and 3,304 kind-46 entries carry no `PREAMBLE` wrapper; their `length` is 8 smaller (Line 24, Rect and Ellipse 32, Arc 40), and the entry still ends at +0x02 + length + 8. §8 gives this form in full. So the wrapper is not universal: test for `PREAMBLE` at +0x02 + length before reading it. A kind-46 entry ends at +0x02 + length + 8 in both forms. **S** (7,986/7,986 kind 46). <!-- EXT-8.4.1-006 EXT-8.4.1-007 EXT-8.4.1-008 EXT-8.4.1-009 EXT-8.4.1-010 EXT-8.4.1-011 -->
- The extension is empty on every entry, CommentText included. **S** (38,826 entries, 7,986 CommentText). No primitive carries an extension record of any kind, so neither listed kind (6/6, 8/6) occurs and the rule that only Polyline carries end shapes holds vacuously. **O** (0 of 38,826; both kinds stay under Unverified below). <!-- EXT-8.4.1-012 EXT-8.4.3-005 EXT-8.4.4-006 -->

**SymbolVector children.** Inside a SymbolVector (§8.8) each child starts with a `u16` selector in place of the kind byte. **S** (15 SymbolVectors, 10 Cache and 5 Packages, 30 children). <!-- EXT-8.4.2-001 EXT-16.5.10-001 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `u16` | selector | primitive kind, < 256 | **S** (30/30) | <!-- EXT-8.4.2-002 --> |
| +0x02 | `u8` | kind | equals the selector; the top-level fields from `length` on follow, one byte later (`length` at +0x03) | **S** (30/30) | <!-- EXT-8.4.2-003 --> |

- So a Polyline child begins `2D 00 2D` and a top-level Polyline `2D 2D`. **S** (30/30 children; 288 top-level polylines). <!-- EXT-8.4.2-005 -->
- Selector 45 (Polyline) is the only child kind. **S** (30/30). Selector 48 (nested SymbolVector) and every other selector do not occur. **O** (0 of 30). <!-- EXT-16.5.10-002 EXT-16.5.10-003 EXT-16.5.10-004 -->

**CommentText font.** The CommentText `u32` font field holds the font index in bits 0 to 15; bits 16 to 31 are opaque (0x0000 on 5,273, 0x8000 on 26, other values on 2,687). **O**. <!-- EXT-16.4.3-002 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| No 64-bit integers occur | INT §3.2 | Every `* Directory` entry carries two `u64` FILETIMEs (6,806 entries, 13,612 values, all plausible dates); INT's claim holds only for the streams the parser reads | **S** | <!-- INT-3.2-002 --> |

### Unverified

- *unverified*: the only big-endian data is inside the embedded `CCSStorage` database (§1, Unverified), outside this format. Every decoded field is little-endian; no file has `CCSStorage`. <!-- EXT-2.1-002 -->
- *unverified*: the page-name list count in the Schematic stream is `u16`; that stream was not decoded here. <!-- EXT-2.1.1-001 -->
- *unverified*: bus-entry end points are `i32`; the 1,688 BusEntry bodies (28 bytes each) were framed but not decoded field by field. <!-- EXT-2.5.1-002 -->
- *unverified*: the colour in bits 0-7 of the transform word; not checked. <!-- EXT-2.5.2-002 -->
- *unverified*: `HSObjects` rows are at least 30 or 62 bytes. Not checked. <!-- EXT-2.1.1-009 -->
- *unverified*: `l32bytes` is a `u32` byte count followed by that many bytes, no terminator; it forms the two-field rows of the `___IndexInfoForMiscStorage` index streams. It occurs only in Constraint and `CCSStorage` index streams, which no file has. <!-- EXT-2.3.1-004 EXT-2.3.5-001 -->
- *unverified*: `l32str` is a `u32` count, the bytes, then one `00` outside the count; it occurs only in `AnnotateCtrl`. The one file with `AnnotateCtrl` was not decoded. <!-- EXT-2.3.1-005 EXT-2.3.5-002 -->
- *unverified*: `dstr` is an ASCII decimal length, one space, then that many bytes; it carries the text payloads of preamble extension records. Those records (`DsnStream`, page records) were not decoded here, and no primitive extension record exists. <!-- EXT-2.3.1-006 -->
- *unverified*: bit 15 of a word as a truth value (set = true), for example "power pins visible" in the placed-instance primitive word, whose bits 0 to 1 hold the IsPrimitive type. Not decoded here. <!-- EXT-2.4-004 EXT-16.13.1-004 -->
- *unverified*: one coordinate unit is 1/100 inch (0.254 mm) on every page, metric or not, so object coordinates convert at 0.01 in per unit and never use the page-settings unit; text positions and offsets (§9) and connectivity coordinates (§11, where "equal" means exact integer equality) use the same unit. Pin points are multiples of 10 units on 37,209/37,280 non-metric and 20,012/26,336 metric page pins; the absolute unit needs Capture. <!-- EXT-2.5.1-006 EXT-2.5.1-014 EXT-9-003 EXT-11-005 -->
- *unverified*: a Polyline may carry one end-shape record: extension kind 8, version 6, ASCII payload `"<startShape> <endShape> <arrowHeadSize> "`, three signed 32-bit decimals each followed by one space, then three `00` bytes; `record_length` = 12 + text length + 3; at most one such record; all three values zero is the default and the record is then omitted. 0 kind-8 records in 318 polylines. <!-- EXT-8.4.1-013 EXT-8.4.3-004 EXT-8.4.4-001 EXT-8.4.4-002 EXT-8.4.4-003 EXT-8.4.4-004 EXT-8.4.4-005 -->
- *unverified*: CommentText carries extension kind 6, version 6, ASCII payload `"<justification> <x> <y>"` (§8.6.6, §9.9). 0 primitive extension records in the data. <!-- EXT-8.4.3-003 -->
- *unverified*: for selector 48 the child's kind byte is the type byte of the nested SymbolVector's first full prefix. No nested SymbolVector occurs. <!-- EXT-8.4.2-004 -->

### Open questions

- Which code page a file's non-ASCII strings use, and whether any field identifies it. Of 893 high-byte strings, 804 are valid GBK and all 893 valid Windows-1252; no field names the code page. The external source's reading (the ANSI code page of the writing system, varying between files) fits but is not provable from the files. <!-- EXT-2.3.7-004 EXT-2.oq-001 -->
- Whether r = 1 displays as a 90° counter-clockwise turn. On a y-down page (1, 0) maps to (0, −1), upward, which is counter-clockwise; the display needs Capture. <!-- EXT-2.5.2-012 EXT-2.oq-003 -->
- Which number denotes which Polyline arrow shape. No kind-8 record exists. <!-- EXT-8.4.4-007 -->

### Parser divergences

| Parser behaviour | What the files show | Impact | Ids |
| --- | --- | --- | --- |
| Decodes strings as Windows-1252 (`binary-reader.ts:28`) | The external source advises Latin-1; both are byte-preserving | Bytes 0x80 to 0x9F map to different characters; no bytes are lost | <!-- EXT-2.3.2-007 --> |

Resolved (2026-11-21): `readStringLenZeroTerm` accepts any `u16` length and keeps the terminator check, the Library reads its strings with it (its separate uncapped reader is gone), and `readStringLenTerm`, which nothing called, is deleted. **O**: instrumented across all 192 corpus and fixture DSNs, in the netlist and the drawn-page paths, the 400-byte cap never fired once the Cache was read by its tables (PR 299), so it guarded nothing; removing it leaves every design's nets identical. **T** (`binary-reader.test.ts`: a 1,421-byte `lstr` reads; a non-`00` terminator still throws). <!-- EXT-2.3.2-006 -->

Parser coverage: the parser reads integers, `lstr` strings, string-table references, `i16`/`i32` coordinates (with the y-first bbox) and the transform word's rotation and mirror bits, and applies the pin-word threshold. It skips every primitive list to its boundary (`structures.ts:534-536`), so the primitive entry header, kinds, SymbolVector children and extensions are not read, and it does not decode `filetime64`, `unixtime32`, `fixstr`, `l32bytes`, `l32str` or `dstr`.

<!-- meta: EXT-0.2-001 EXT-0.2-002 EXT-0.2-005 EXT-2-001 EXT-2.3.4-001 EXT-2.3.4-002 EXT-5.1-003 EXT-16.1.2-015 EXT-16.13.1-001 INT-3.1-011 -->

---

## 3. Record framing and structure types

A framed record is the unit of every structured binary stream in a `.DSN`: a chain of nested length prefixes that all carry the record's structure type id, a short prefix with the record's user properties, a preamble with optional extension sub-records, and then the type-specific body. This chapter gives that framing, the rules that find each part, the prefix count of every type, and the table of structure type ids. <!-- EXT-0.3-003 INT-4.3-001 INT-4.4-001 -->

Evidence basis of this chapter: 120 OLE files (the 18 version-3 fixture designs plus the version-3 designs of `designs-dataset/cadence-corpus`). An independent layout reader walked 451 page streams and 105 Cache streams to their exact last byte with 0 aborts, framing 352,000 records (323,658 with a short prefix, 28,342 of types 52 and 53). A layout-free scan of all 4,253 streams found 243,686 further short-prefixed records (Packages 77,815, Hierarchy 155,532, nested in Cache 3,798, nested in pages 6,140, Symbols 129, Schematic 162, DsnStream 102, NetBundleMapData 8). Together: 595,686 records (567,344 with a short prefix, 28,342 of types 52 and 53), plus 18,708 type-66 Hierarchy frames (18,599 derived, 109 root). <!-- EXT-0.3-003 -->

All integers are little-endian, and no padding sits between fields: little-endian reads frame all 595,686 records and consume every walked stream exactly. **S** <!-- EXT-3.1-001 --> A string written `lstr` is `[u16 len][len bytes][00]`; the terminating NUL was present on every `lstr` of the page and Cache walk. **S** <!-- EXT-3.1-002 -->

### 3.1 Where framed records occur

Framed records occur in page streams, `Views/*/Schematic`, the Hierarchy streams, `Cache`, `Packages/*`, `Symbols/*`, `DsnStream` and `NetBundleMapData`. No framed record occurs in `Library`, `Graphics/*`, the `* Directory` streams, `AdminData`, `HSObjects`, `BundleMapData` or the CIS streams. **O** <!-- EXT-3-001 --> (EXT lists the streams without the negative half; the stream list was observed by scan, not by a full layout walk of every stream.)

The `SchematicInfoStream` lists page names in the container's escaped form: a `/` or `:` in a name is stored as byte `0x02` or `0x03`, exactly as in the stream name, and the bytes `/` and `:` never occur in the list. **O** (1 stream in the corpus: 23 names, 4 with `0x02`/`0x03`, every name matching a sibling stream) <!-- EXT-14.13.1-004 -->

### 3.2 Record anatomy

A record has up to four consecutive parts:

| Part | Size | Present |
| --- | --- | --- |
| F full prefixes | 9 bytes each | always, F >= 1 |
| short prefix | 3 + 8n bytes | every type except 52, 53 and the type-66 root and derived frames |
| preamble | 8 + len bytes | exactly when a short prefix is present |
| body | type-specific | always |

**S** (352,000 walked records, every stream consumed to its exact end) <!-- EXT-3.2-001 INT-4.3-001 EXT-5.1-004 EXT-5.1-005 EXT-5.1-006 EXT-5.1-007 EXT-7.0.1-001 EXT-7.0.1-002 EXT-7.0.1-003 EXT-7.0.1-004 -->

- F is at least 1 and fixed for each structure type: one F per type over 595,686 records, 0 exceptions. **S** <!-- EXT-3.2-002 EXT-0.3-004 EXT-7.0.2-016 --> Lists of records are introduced by `u16` counts on every page and Cache list walked, so the next structure is always determined. **S** <!-- EXT-0.3-004 -->
- Every prefix of one record carries the same type byte: the short-prefix type byte equals the chain type on 567,344/567,344. **S** <!-- EXT-3.2-005 EXT-16.1.1-001 INT-4.3-001 -->
- The short prefix is the last prefix of the chain on every short-prefixed record (567,344). Types 52 and 53 and the type-66 root and derived frames end their chain with a full prefix instead (see §3.8). **S** <!-- EXT-3.2-003 INT-4.2-001 -->
- A preamble follows the short prefix exactly when a short prefix is present: all 567,344 short-prefixed records have one; none of the 47,050 prefix-only frames has one. **S** <!-- EXT-3.2-004 INT-4.4-003 -->
- User properties (MPN, Value, PCB Footprint and the rest) are the short prefix's name/value pairs, indices into the `Library` string table (174,325 pairs). **S** That the body never repeats them is not proven. <!-- INT-4-001 -->

### 3.3 Full prefix (9 bytes)

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u8 | `type` | structure type id | **S** (all records) | <!-- EXT-3.2.1-001 INT-4.1-001 --> |
| +0x01 | u32 | `end_offset` | length of this prefix's region, counted from the first byte after the prefix; never 0 on a real record | **S** (all records) | <!-- EXT-3.2.1-002 INT-4.1-002 EXT-2.1.1-005 --> |
| +0x05 | u32 | `reserved` | always 0 | **S** (595,686 records, plus 18,599 derived and 109 root frames) | <!-- EXT-3.2.1-003 INT-4.1-003 EXT-2.8-005 --> |

- A full prefix at stream offset P opens the region [P+9, P+9+`end_offset`); its stop is P+9+`end_offset`, and every stop lies inside the stream. Each stop matches a layout boundary on every walked type. **S** <!-- EXT-3.2.1-004 INT-4.1-004 --> The region of the first (outermost) prefix is R1, the next R2, and so on.
- The reserved field is 0 in all 1,449 `Packages/*` streams of the corpus (77,815 records) and is never a copy of `end_offset`. **S** <!-- INT-4.1-006 -->
- The parser skips the reserved four bytes without reading them (`generic-parser.ts:111`). OpenOrCadParser treats them as unknown data, with its assertion that they are zero commented out. (parser code) <!-- INT-4.1-005 INT-4.1-007 -->

### 3.4 Short prefix (3 + 8n bytes)

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u8 | `type` | same type id as the full prefixes | **S** (567,344/567,344) | <!-- EXT-3.2.2-001 INT-4.2-002 --> |
| +0x01 | i16 | `prop_count` | number of property pairs; -1 means no property list | **S** (values -1..45; -1 on 102,068 records) | <!-- EXT-3.2.2-002 INT-4.2-003 EXT-2.1.1-003 EXT-16.1.3-001 --> |
| +0x03 | (u32, u32) × n | pairs | `name_idx`, `value_idx`; n = max(`prop_count`, 0) | **S** (the magic sits exactly after 8n bytes on 567,344/567,344) | <!-- EXT-3.2.2-003 INT-4.2-004 --> |

- `prop_count` -1 is never followed by pairs (102,068 records). **S** <!-- EXT-3.8-005 EXT-16.13.2-002 --> In the data -1 and 0 both mean zero pairs, so a reader can treat them alike. **O** <!-- EXT-3.2.2-010 EXT-16.1.3-003 --> No value below -1 occurs (0 of 567,344). **S** <!-- EXT-16.1.3-005 -->
- `prop_count` -1 occurs only on types 2 (385 records; the other 5,755 have 0), 6 (4,167), 32 (4,395), 39 (76,941), 48 (15) and 49 (16,165); on 6, 32, 39, 48 and 49 it is always -1. **S** <!-- EXT-3.2.2-006 EXT-16.1.3-002 EXT-7.0.3-001 EXT-7.0.3-002 -->
- Observed `prop_count` values are -1 and 0..45; the maximum, 45, is on type 13. No value outside -1..55 occurs. **S** <!-- EXT-3.2.2-005 --> Positive counts are 1..45 (55 never seen); counts are always positive on types 13 (15,009 records) and 65 (443). Several per-type ranges EXT gives are exceeded; §3.9 gives the observed values. **S** <!-- EXT-16.1.3-004 EXT-7.0.3-003 -->
- Types 16, 20, 21, 23, 37, 38 have count 0 or a small positive number of user property pairs. **S** <!-- EXT-7.0.3-004 --> Types 29, 55-62, 89 and 77 have count 0 on every record; type 12 has count 0 on 165 records and 1 on 9 (of 174). **S** <!-- EXT-7.0.3-005 -->
- Each pair is two string indices, name and value, 0-based into the `Library` string table: `name_idx` lies inside the table on 174,325/174,325 pairs. `value_idx` lies inside on 174,262; the other 63 are `0xFFFFFFFF` (type 20, `SPICE_MULTIVIBRATOR.DSN`, past a 266-entry table). **S** The property meaning per name was not checked against Capture. <!-- EXT-2.7-004 EXT-3.2.2-004 EXT-3.2.2-009 INT-4.2-005 EXT-5.1-011 EXT-7.0.3-006 -->
- Reader guidance: a pair whose `value_idx` points past the table is absent; keep reading the record. The 63 such records still frame correctly. **O** <!-- EXT-3.2.2-008 -->

### 3.5 Preamble (8 + len bytes)

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u8[4] | `magic` | `FF E4 5C 39` | **S** (567,344 records) | <!-- EXT-3.2.3-001 EXT-8-004 --> |
| +0x04 | u32 | `len` | extension byte count; 0 on 562,762 records, non-zero on 4,582 | **S** | <!-- EXT-3.2.3-002 --> |
| +0x08 | u8[len] | extension | a sequence of sub-records (§3.6); empty when `len` = 0 | **S** (non-empty extensions tile as sub-records, 4,583/4,583: 4,582 record preambles plus 1 Hierarchy root-data preamble holding the kind-5 sub-record) | <!-- EXT-3.2.3-003 EXT-2.9-001 INT-4.4-001 --> |

- The preamble immediately follows the short prefix: the magic sits right after the pairs on 567,344/567,344. **S** <!-- EXT-3.2.3-004 -->
- The preamble ends the innermost region, and the body follows it (567,344/567,344). **S** <!-- INT-4.4-002 -->
- Reader guidance: test for the four magic bytes exactly. The only records without them are the records without a short prefix. **S** <!-- EXT-3.2.3-005 -->

### 3.6 Extension sub-records

A non-empty preamble extension is a sequence of sub-records with no gaps and no trailing bytes (4,583/4,583: 4,582 record preambles plus 1 Hierarchy root-data preamble holding the kind-5 sub-record, all tile exactly). **S** <!-- EXT-3.4-001 --> Every extension found holds exactly one sub-record (4,583/4,583: 4,582 record preambles plus 1 Hierarchy root-data preamble holding the kind-5 sub-record). **S** (new) <!-- EXT-3.4-006 EXT-16.1.4-010 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `length` | whole sub-record length including this 12-byte header; at least 12 | **S** (4,583) | <!-- EXT-3.4-002 EXT-2.9-002 --> |
| +0x04 | u32 | `kind` | 0, 2, 5, 6 or 7 | **S** | <!-- EXT-3.4-003 EXT-2.9-003 --> |
| +0x08 | u32 | `version` | 2 for kind 0, 6 for the others | **S** | <!-- EXT-3.4-004 EXT-2.9-004 --> |
| +0x0C | u8[length-12] | payload | kind-specific | **S** | <!-- EXT-3.4-005 EXT-2.9-005 --> |

The same header opens a sub-record in a preamble extension and in a primitive extension (4,583 sub-records). **S** <!-- EXT-16.1.4-001 --> Each kind has exactly one version: kind 0 is always version 2, kinds 2, 5, 6 and 7 always version 6. **S** <!-- EXT-16.1.4-002 --> No kind other than 0, 2, 5, 6, 7 occurs in any stream. **S** <!-- EXT-16.1.4-009 -->

| Kind / version | Name | Occurs on (corpus) | Payload | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| 0 / 2 | Flag | type 55 only: 2 records | 7 bytes `05 00 00 00 00 00 00`; length 19 | **S** | <!-- EXT-3.4-009 EXT-16.1.4-003 EXT-16.1.5-007 --> |
| 2 / 6 | Attribute locks | 12 (56), 13 (3,309), 66 links (972), and 21 WireBus (32) (new) | text rows (below) | **S** | <!-- EXT-3.4-010 EXT-16.1.4-004 EXT-7.0.3-008 --> |
| 5 / 6 | Reference ranges | once, in Hierarchy root data; never in a type-66 link preamble | text | **S** | <!-- EXT-16.1.4-005 --> |
| 6 / 6 | Justification | type 39 (202); never in a primitive extension | text | **S** | <!-- EXT-16.1.4-006 --> |
| 7 / 6 | Design metadata | type 4 (9 of 102 DsnStreams) | JSON text | **S** | <!-- EXT-16.1.4-007 --> |

EXT lists the Flag record on types 4, 10, 13, 39, 55, 56, 77; only 55 has one in the corpus. EXT lists Attribute locks on 12, 13 and 66; type 21 also carries them. EXT lists Reference ranges on 66 links and root data, and Justification also in CommentText primitive extensions; neither second location occurs. <!-- EXT-3.4-009 EXT-16.1.4-004 EXT-16.1.4-005 EXT-16.1.4-006 -->

Cache records have an empty preamble except 19 type-39 displays with a kind 6/6 sub-record. **S** <!-- EXT-5.1-006 --> Page graphic instances (55-62, 89) have an empty extension on 6,138 records; 2 boxes (type 55) carry the 19-byte kind-0 Flag record, and no line (56) does. **S** <!-- EXT-8.9.1-004 EXT-7.15-011 --> The 27,343 preambles found outside framed records (primitive and root-data preambles) are all empty except the one Hierarchy root-data kind 5/6; that one matches the sub-record layout. **S** <!-- EXT-8.4.3-001 -->

**Text payloads.** Text payloads (kinds 2, 5, 6, 7) are ASCII and end in exactly three `00` bytes: 4,581/4,581 (kind 2: 4,369, kind 5: 1, kind 6: 202, kind 7: 9). The kind-5 payload ends `20 00 00 00`. **S** <!-- EXT-3.4-008 EXT-2.3.6-003 EXT-2.9-005 --> Kind 6/6 sub-records on type 39 have lengths 16 (112 records, text `3` with no x and y), 20, 21, 22 and 23. **S** (new) <!-- EXT-7.0.3-009 -->

**Kind-0 Flag record.** The payload occupies sub-record bytes +0x0C to +0x12 (19-byte record, 7-byte payload, 2/2). **S** <!-- EXT-16.1.5-001 -->

| Offset | Type | Name | Values seen | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x0C | u8 | `mode` | 5 on 2/2 (0 never seen) | **S** | <!-- EXT-16.1.5-002 --> |
| +0x0D | u16 | `reserved` | 0 on 2/2 | **S** | <!-- EXT-16.1.5-003 --> |
| +0x0F | u32 | `flag` | 0 on 2/2 (1 never seen) | **S** | <!-- EXT-16.1.5-004 --> |

**Attribute-lock rows (kind 2/6).** The payload is text: a decimal row count, then per row a name, flags, owner and value, tokens separated by spaces, ending in three `00`. 4,369 payloads parse to their exact end. **S** <!-- EXT-16.1.6-001 EXT-3.4-010 --> Name, owner and value are `dstr` strings: a decimal byte length, one space, then that many bytes. Integers are decimal digits after optional spaces. **S** (4,369 texts) <!-- EXT-2.3.6-001 EXT-2.3.6-002 --> The row count is 1 on 4,369/4,369. **S** <!-- EXT-3.4-012 EXT-16.1.6-002 --> Flags are 0 on 2,774 rows, 128 on 1,594 rows, and 13 on 1 row (row `__NG_OWNER`, `STM32F746NGH V1.1_last.DSN`, page `MCU`, text `1 10 __NG_OWNER 13 0  0  `) (new). **S** The meaning of the flag values was not checked. <!-- EXT-3.4-010 EXT-16.1.6-003 EXT-16.1.6-004 -->

### 3.7 Regions and layers

- The stops of nested full prefixes strictly decrease: each prefix stops before the one in front of it, on every chain. **S** <!-- EXT-3.2.4-001 EXT-5.1-009 -->
- The innermost full prefix bounds exactly the short prefix and the preamble; its stop is the end of the preamble (567,344/567,344: walk 323,658, scan 243,686). **S** <!-- EXT-3.2.4-002 -->
- Each outer prefix adds one layer of body fields, from the stop of the region inside it to its own stop. This holds on page types 13, 12, 23, 65, 77, 37, 38 and Cache symbols 24, 33, 34, 35, 64, 75. **S** <!-- EXT-3.2.4-003 -->
- The body is stored innermost layer first: for type 13 the base fields end at R3, the pins at R2, the device index at R1 (15,009/15,009). **S** <!-- EXT-3.2.4-004 -->
- For F >= 2 the record ends at the R1 stop, and nested child records lie inside R1; this holds for every walked F >= 2 page type and Cache top-level record. **S** <!-- EXT-3.2.4-006 --> In the Cache, record length = 9 + R1 `end_offset`; the five Cache tables read to their exact end on 105/105 Caches. **S** <!-- EXT-5.1-008 -->
- Every page record ends at its R1 stop: 13 (15,009), 12 (174), 23 (2,135), 65 (443), 77 (2,066), 20/21 (85,489), 16/17 (63,616), 49 (16,165), 39 (65,096), 29 (1,688), 52 (27,130), graphic instances (6,140), 37 (8,342), 38 (6,491). **S** <!-- EXT-7.0.1-006 --> The exception is NetBus (53): its member list belongs to the record but lies after R1 (1,212/1,212). **S** <!-- EXT-7.0.1-007 -->
- The 5 bytes after each Global (37) and OffPageConnector (38) are page-list data after the record: R1 ends at the symbol-kind byte on 8,342 + 6,491 records, and page streams still end exactly. **S** <!-- EXT-7.0.1-008 -->
- R1 is the whole record for page and Cache records except 53 (**S**) and for the DsnStream record (102/102). Hierarchy F = 1 records and the Schematic header have bodies after R1. `Packages/*` and `Symbols/*` records were not walked by layout. <!-- EXT-3.2.4-013 -->

Records with F = 1:

| Type | Short prefix | R1 holds | Body | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| 4 | yes | short prefix and preamble; R1 = end of DsnStream | nothing follows | **S** (102/102) | <!-- EXT-3.2.4-007 --> |
| 9, 66 link, 67, 68, 69, 82, 91 | yes | short prefix and preamble only | follows R1; length from the body layout (not checked) | **O** (9: 162, 66 links: 18,599, 67: 34,640, 68: 84,820, 69: 10,258, 82: 740, 91: 6,475) | <!-- EXT-3.2.4-008 --> |
| 52 | no | whole body | none after R1 | **S** (27,130/27,130) | <!-- EXT-3.2.4-009 --> |
| 53 | no | header | member list follows R1 and names type-52 records | **S** (1,212/1,212) | <!-- EXT-3.2.4-010 --> |

### 3.8 Records without a short prefix

Four frames have exactly one full prefix and no short prefix or preamble after it: **S** <!-- EXT-3.5-008 EXT-7.0.1-005 EXT-3.3-001 EXT-3.3-002 -->

| Frame | Stream | Records | Shape |
| --- | --- | --- | --- |
| 52 SchematicNet | page | 27,130 | one full prefix, then the body; R1 = record end |
| 53 NetBus | page | 1,212 | one full prefix, then the header; member list after R1 |
| 66 root frame | Hierarchy | 109 | one full prefix (reserved 0), then root data |
| 66 derived frame | Hierarchy | 18,599 | one full prefix (reserved 0); the byte after it is not 66 |

- None of 52, 53 or the derived frame has a preamble after its prefix. The root data of a root frame ends with a preamble on only 28 of 109 root frames. **S** <!-- EXT-3.3-005 -->
- Reader guidance: read exactly one full prefix for these frames. The first body byte can equal the type byte: it is 52 on 88 SchematicNets and 53 on 6 NetBus records, and one SchematicNet (`MYLIBRARY.DSN`, `PAGE1`, offset 861) would pass the zero and nesting tests of §3.10 as a second full prefix. **S** <!-- EXT-3.3-006 -->

### 3.9 Prefix counts and region ends per type

The full-prefix count does not depend on the stream: a type has the same F in a page stream, the Cache, `Packages/*` and `Symbols/*`. Types seen in several streams keep one F: 6 (3), 24 (5), 26 and 39 (2), 31 (3), 32 (2), 35, 64, 75 (4), 48 (2); 0 exceptions. **S** <!-- EXT-3.6-044 -->

Regions are listed outermost first. "prop_count seen" is the observed distribution; where EXT's stated range differs, the excess is given beside it.

| Type | F | Region ends | prop_count seen | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| 2 GraphicObject | 3 | R1: end of the parent instance's R1 (after the bbox), 6,140/6,140; R2, R3 not checked | -1: 385, 0: 5,755 | **S** (6,140) | <!-- EXT-3.6-002 EXT-7.0.2-014 --> |
| 4 DesignProperties | 1 | R1: end of preamble = end of stream | 0: 1, 1: 99, 2: 2 | **S** (102) | <!-- EXT-3.6-003 --> |
| 6 PartCell | 3 | R2 position not checked | -1 on all | **S** (4,167) | <!-- EXT-3.6-004 --> |
| 9 SchematicHeader | 1 | R1: end of preamble; body follows to the stream end | 0 on all | **S** (162) | <!-- EXT-3.6-005 --> |
| 10 Page | 2 | R1: end of stream; R2: end of preamble | 0 on all | **S** (451) | <!-- EXT-3.6-006 --> |
| 12 DrawnInstance | 3 | R1: after the last pin; R2: after the inline LibraryPart; R3: end of preamble | 0: 165, 1: 9 (EXT: 0) | **S** (174) | <!-- EXT-3.6-007 EXT-7.0.2-002 EXT-7.5-022 --> |
| 13 PlacedInstance | 4 | R1: after the device index; R2: after the last pin; R3: after the symbol-kind byte; R4: end of preamble | 1..45 | **S** (15,009) | <!-- EXT-3.6-008 EXT-7.0.2-001 EXT-7.3-029 --> |
| 16 ScalarPinInstance | 2 | R1: after the last display property; R2: end of preamble | 0: 62,503, 1: 117 | **S** (62,620; region ends on 63,616 pins of types 16 and 17) | <!-- EXT-3.6-009 EXT-7.0.2-009 --> |
| 17 BusPinInstance | 2 | as type 16 | 0 on all | **S** (996) | <!-- EXT-3.6-010 --> |
| 20 WireScalar | 2 | R1: after the line style; R2: end of preamble | 0: 81,018, 1: 1,509, 2: 62, 4: 1, 5: 6, 6: 6, 8: 3 (EXT: 0-5) | **S** (82,605) | <!-- EXT-3.6-011 --> |
| 21 WireBus | 2 | as type 20 | 0: 2,854, 1: 30 (EXT: 0) | **S** (2,884) | <!-- EXT-3.6-012 EXT-7.0.2-008 EXT-7.7-018 --> |
| 23 Port | 3 | R1: after the 9-byte trailer (ends with the port type); R2: after the symbol-kind byte; R3: end of preamble | 0 on all | **S** (2,135) | <!-- EXT-3.6-013 EXT-7.0.2-003 EXT-7.9-008 --> |
| 24 LibraryPart | 5 | R1: record end; R2: end of the display list; R3: end of the bbox; R4: after the two `lstr` (source library); R5: end of preamble | 0..14 | **S** (4,387; Cache and inline in 12: R4 2,778/2,778 (2,604 Cache + 174 inline), R3 and R2 2,722/2,722, 56 Cache symbols not decoded by the checker's primitive reader) | <!-- EXT-3.6-014 EXT-7.0.2-015 --> |
| 26 SymbolPinScalar | 2 | R1: record end; R2: end of preamble | 0: 86,740, 1: 14,099, 2: 102, 4: 342, 5: 19, 6: 41, 7: 6 (EXT: 0-5, 7) | **S** (101,349) | <!-- EXT-3.6-015 --> |
| 27 SymbolPinBus | 2 | as type 26 | 0 on all | **S** (996) | <!-- EXT-3.6-016 --> |
| 29 BusEntry | 2 | R1: after the reserved bytes (28-byte body); R2: end of preamble | 0 on all | **S** (1,688) | <!-- EXT-3.6-017 EXT-7.0.2-012 --> |
| 31 Package | 3 | R2 position not checked | 0 on all | **S** (3,648) | <!-- EXT-3.6-018 --> |
| 32 Device | 2 | R2: end of preamble | -1 on all | **O** (4,395) | <!-- EXT-3.6-019 --> |
| 33 GlobalSymbol | 4 | R1: after pins and display list; R2: after the bbox; R3: after the two `lstr`; R4: end of preamble | 0: 297, 1: 13, 2: 17, 4: 1 (EXT: 0-2) | **S** (328) | <!-- EXT-3.6-020 --> |
| 34 PortSymbol | 4 | as type 33 | 0 on all | **S** (127) | <!-- EXT-3.6-021 --> |
| 35 OffPageSymbol | 4 | as type 33 (130/130) | 0: 120, 1: 2, 2: 1, 3: 8 (EXT: 0, 2) | **S** (131) | <!-- EXT-3.6-022 --> |
| 37 Global | 2 | R1: after the symbol-kind byte; R2: end of preamble; 5 list bytes follow R1 | 0: 8,287, 3: 55 (EXT: 0-1) | **S** (8,342) | <!-- EXT-3.6-023 --> |
| 38 OffPageConnector | 2 | as type 37 | 0: 1,073, 1: 4,906, 2: 469, 3: 43 | **S** (6,491) | <!-- EXT-3.6-024 EXT-7.0.2-006 --> |
| 39 SymbolDisplayProp | 2 | R1: after the display mode (14-byte body on pages); R2: end of preamble | -1 on all | **S** (76,941) | <!-- EXT-3.6-025 EXT-7.0.2-011 --> |
| 48 SymbolVector | 2 | R1: end of the vector (skipping by R1 keeps the Cache decode aligned, 10/10) | -1 on all | **O** (15) | <!-- EXT-3.6-026 --> |
| 49 Alias | 2 | R1: after the name; R2: end of preamble | -1 on all | **S** (16,165) | <!-- EXT-3.6-027 EXT-7.0.2-010 EXT-7.8-009 --> |
| 52 SchematicNet | 1, no short prefix | R1: after the line width (record end) | none | **S** (27,130) | <!-- EXT-3.6-028 EXT-7.0.2-013 --> |
| 53 NetBus | 1, no short prefix | R1: end of the header; member list follows | none | **S** (1,212) | <!-- EXT-3.6-029 EXT-7.0.2-013 --> |
| 55, 56, 58-62, 89 graphic instances | 2 | R1: after the inline GraphicObject (record end); R2: end of preamble | 0 on all | **S** (6,140) | <!-- EXT-3.6-030 EXT-7.0.2-007 EXT-8.9.1-002 EXT-8.9.1-003 --> |
| 64 TitleBlockSymbol | 4 | as type 33 (120/124; 4 not decoded by the checker) | 2: 5, 3: 6, 7: 93, 8: 6, 9: 4, 10: 9, 11: 1, 12: 6 (EXT: 7, 10-13) | **S** (130) | <!-- EXT-3.6-031 --> |
| 65 TitleBlock | 3 | R1: after the 12-byte trailer (ends with the page number); R2: after the symbol-kind byte; R3: end of preamble | 2: 2, 4: 93, 5: 60, 6: 7, 7: 28, 8: 28, 9: 51, 10: 13, 11: 113, 12: 12, 13: 27, 14: 9 (EXT: 4-22) | **S** (443) | <!-- EXT-3.6-032 EXT-7.0.2-004 EXT-7.12-007 --> |
| 66 Occurrence link | 1 | R1: end of preamble; link fields follow | 0-14, plus 15, 16, 18 on 12 records (EXT: 0-14) | **O** (18,599) | <!-- EXT-3.6-033 --> |
| 66 root / derived frame | 1, no short prefix | root R1 ends at a preamble end on only 28/109; derived-frame end not checked | none | **O** (109 + 18,599) | <!-- EXT-3.6-033 --> |
| 67 HierarchyNet | 1 | R1: end of preamble; fields follow | 0: 32,911, 1: 1,716, 3: 13 (EXT: 0, 3) | **O** (34,640) | <!-- EXT-3.6-034 --> |
| 68 PortOrScalarPinOccurrence | 1 | R1: end of preamble; fields follow | 0: 84,793, 1: 27 | **O** (84,820) | <!-- EXT-3.6-035 --> |
| 69 BusPinOccurrence | 1 | as type 68 | 0 on all | **O** (10,258) | <!-- EXT-3.6-036 --> |
| 75 ErcSymbol | 4 | as type 33 (503/503) | 0 on all | **S** (577) | <!-- EXT-3.6-037 --> |
| 77 ErcObject | 3 | R1: after the three trailing `lstr` (the last is the location string); R2: after the symbol-kind byte; R3: end of preamble | 0 on all | **S** (2,066) | <!-- EXT-3.6-039 EXT-7.0.2-005 EXT-7.13-007 --> |
| 82 TitleBlockOccurrence | 1 | R1: end of preamble; fields follow | 0: 323, 4: 349, 11: 24, 16: 44 | **O** (740) | <!-- EXT-3.6-040 --> |
| 91 OffPageOccurrence | 1 | R1: end of preamble; fields follow | 0 on all | **O** (6,475) | <!-- EXT-3.6-041 --> |
| 103 NetGroup | 2 | R1: end of preamble + 6-byte body (8/8) | 0 on all | **O** (8) | <!-- EXT-3.6-042 --> |

- Types 23, 65 and 77 have three full prefixes. R2 bounds the graphic-instance base layer and the outermost layer holds only the trailer: 9 bytes for a Port (2,135/2,135), 12 bytes for a TitleBlock (443/443), three `lstr` for an ErcObject (2,066/2,066). **S** <!-- EXT-3.6-045 EXT-7.0.2-017 -->
- A type-2 GraphicObject sits at body offset 34 of each page graphic instance, exactly one per instance (6,140/6,140), and ends at the instance's R1 stop. **S** <!-- EXT-3.10-002 EXT-16.1.1-004 -->

Per-record frame summaries (prefix count, property count, extension) for the page objects:

| Record | Frame as observed | Evidence | Ids |
| --- | --- | --- | --- |
| 13 PlacedInstance | F = 4; count >= 1; extension empty or one kind 2/6 sub-record (15,009/15,009); the kind-0 form never occurs on 13 | **S** | <!-- EXT-7.3-002 --> |
| 16/17 pin instance | F = 2; count 0 or 1; preamble always empty (63,616/63,616) | **S** | <!-- EXT-7.4-003 --> |
| 12 DrawnInstance | F = 3; count 0 (165) or 1 (9); extension empty (118) or kind 2/6 (56) | **S** | <!-- EXT-7.5-002 --> |
| 20/21 Wire | F = 2; counts as in the table (85,489 wires); preamble empty except kind 2/6 on 32 bus wires | **S** | <!-- EXT-7.7-001 --> |
| 49 Alias | F = 2; count -1; preamble empty (16,165/16,165) | **S** | <!-- EXT-7.8-002 --> |
| 23 Port | F = 3; count 0; extension empty (2,135/2,135) | **S** | <!-- EXT-7.9-001 --> |
| 37/38 Global, OffPageConnector | F = 2; counts 0-3; preamble empty (14,833/14,833) | **S** | <!-- EXT-7.10-002 --> |
| 29 BusEntry | F = 2; count 0; preamble empty (1,688/1,688) | **S** | <!-- EXT-7.11-001 --> |
| 65 TitleBlock | F = 3; count >= 2; preamble empty (443/443) | **S** | <!-- EXT-7.12-002 --> |
| 77 ErcObject | F = 3; count 0; extension empty (2,066/2,066) | **S** | <!-- EXT-7.13-002 --> |

#### Page record frame (type 10)

Every page stream starts with its type-10 Page record: **S** (451/451)

| Offset | Type | Field | Value | Ids |
| --- | --- | --- | --- | --- |
| +0x00 | u8 | type | 10 | <!-- EXT-6.2.1-001 --> |
| +0x01 | u32 | outer length | stream length - 9: R1 runs to the end of the stream and holds all page data, including the 14 lists | <!-- EXT-6.2.1-002 --> |
| +0x05 | u32 | reserved | 0 | <!-- EXT-6.2.1-003 --> |
| +0x09 | u8 | type | 10 | <!-- EXT-6.2.1-004 --> |
| +0x0A | u32 | inner length | R2 ends exactly at the end of the preamble | <!-- EXT-6.2.1-005 --> |
| +0x0E | u32 | reserved | 0 | <!-- EXT-6.2.1-006 --> |
| +0x12 | u8 | short-prefix type | 10 | <!-- EXT-6.2.1-007 --> |
| +0x13 | i16 | prop_count | 0; no pairs | <!-- EXT-6.2.1-008 --> |
| +0x15 | u8[4] | magic | `FF E4 5C 39` | <!-- EXT-6.2.1-009 --> |
| +0x19 | u32 | extension length | 0 on 451/451 (EXT also allows 19, never seen) | <!-- EXT-6.2.1-010 --> |
| +0x1D | lstr | page name | at +0x1D + extension length | <!-- EXT-6.2.1-014 --> |

### 3.10 Finding the end of the prefix chain

Let T be the type byte at the record start. From the cursor: **S** <!-- EXT-3.8-001 EXT-3.8-002 EXT-3.8-003 EXT-3.8-004 -->

1. If the byte at the cursor is not T, the chain has ended without a short prefix (52, 53 and the type-66 root and derived frames; see the one exception in §3.8). <!-- EXT-3.5-001 -->
2. Otherwise take 9 bytes as a candidate full prefix. It is a full prefix if bytes +5..+8 are zero **and** its stop is at or before the previous full prefix's stop. This gives the table F on all 567,344 short-prefixed records. <!-- EXT-3.5-002 -->
3. If it is a full prefix, advance 9 bytes and repeat from step 1. <!-- EXT-3.5-003 -->
4. Otherwise the cursor is at the short prefix: read it, then the preamble. The zero test ends the chain on 564,156 records and the nesting test on 3,188. <!-- EXT-3.5-004 -->

The nesting test is required. A short prefix shows zeros at +5..+8 when its first pair has `name_idx` < 65,536 and `value_idx` = 0 mod 65,536 (for example an empty value), so it passes the zero test; its candidate stop lies beyond the previous stop. This happens on 3,188 records (types 12: 9, 13: 1,888, 20: 6, 24: 686, 26: 288, 64: 6, 65: 78, 66: 225, 67: 2). **S** <!-- EXT-3.5-005 --> Counting by the zero test alone therefore miscounts records of types 12, 13, 20, 24, 26, 64, 65, 66 and 67; no miscount occurs on 16, 35 or 82, which EXT also lists. **S** <!-- EXT-3.5-007 -->

A reader may instead read exactly F full prefixes (from §3.9) and then the short prefix: fixed-F reading equals the zero-and-nesting chain on all 567,344. **S** <!-- EXT-3.5-006 --> The parser auto-detects the count by trying 10 down to 1 and keeping the first count that parses (`generic-parser.ts:187`), the same brute-force method as OpenOrCadParser (`maxPrefixes` = 10). Emulated, it yields the structural F on 567,344/567,344 records. **S** <!-- INT-4.3-002 INT-4.3-004 --> INT rates this auto-detection a low-risk heuristic, and it holds: it never picks a wrong count on our data. **S** <!-- INT-13.4-001 -->

### 3.11 Record ends and skipping

- When decoding stops before the record end, the bytes up to the end still belong to the record: the walker continues at R1 for undecoded tails and streams still end exactly. **S** <!-- EXT-3.7-001 -->
- Reader guidance: always continue at the record end of §3.7, not at the end of the decoded fields. Continuing at R1 consumes every walked stream exactly (451 pages, 105 Caches). **S** <!-- EXT-3.7-002 -->
- A record of unknown layout is skipped by jumping to its R1 stop. This is verified for every walked F >= 2 type in pages and the Cache and for type 52 (**S**); skips of nested 2, 26, 27, 32, 39 and 48 were only observed by scan, and `Packages/*` and `Symbols/*` were not walked. <!-- EXT-3.7-013 -->
- Skipping to the R1 stop does not cover the body of an F = 1 short-prefixed record (9, 66-91: R1 = end of preamble, body after) or of a type-66 root or derived frame; type 4 is the exception, its R1 is the stream end. **O** <!-- EXT-3.7-016 -->
- The parser's `readRestOfStructure()` jumps to the furthest stop, which is the R1 stop; `skipStructure()` uses it to step over undecoded bodies (`generic-parser.ts:64`, `:236`). **S** <!-- INT-4.5-005 -->
- Parser checkpoints (parser code): each full prefix's stop is a checkpoint, and the parser calls `checkpoint()` where a boundary is expected (`generic-parser.ts:49`). <!-- INT-4.5-001 --> `checkpoint()` is advisory: it marks a matching unparsed boundary as parsed and otherwise returns silently, never throwing. <!-- INT-4.5-002 --> A body that drifts off the true layout is therefore not caught by it. <!-- INT-4.5-003 --> `skipToNextBoundary()` jumps to the nearest unvisited boundary at or after the cursor; LibraryPart uses it on the normal path to step over primitives (`generic-parser.ts:84`, `structures.ts:537`). <!-- INT-4.5-004 -->

### 3.12 Lookahead and sentinels

| Test | Rule | Evidence | Ids |
| --- | --- | --- | --- |
| dispatch | the byte at the cursor, not consumed, is the type of the next record; it decides every list record in the walk | **S** | <!-- EXT-3.8-001 --> |
| full or short prefix | bytes +5..+8 and the nesting of stops (§3.10) | **S** | <!-- EXT-3.8-002 --> |
| chain end without short prefix | byte at the cursor differs from T | **S** | <!-- EXT-3.8-003 --> |
| preamble present | 4 bytes at the cursor are `FF E4 5C 39` (567,344) | **S** | <!-- EXT-3.8-004 --> |
| no property list | `prop_count` = -1 | **S** | <!-- EXT-3.8-005 --> |
| type 00 | never starts a record; the 9,533 type-0 scan patterns are zero runs in front of primitive or free preambles, never in a record list | **S** | <!-- EXT-3.8-009 EXT-16.1.1-003 --> |

### 3.13 Object identifiers

Id 0 is used where nothing is referenced: pin wire id 0 on 4,265 isolated pins, connector trailer wire id 0 on 534. **O** That 0 always means "no id" is not proven. <!-- EXT-3.9-006 EXT-16.13.2-003 -->

### 3.14 Structure type ids

The structure type id is the first byte of every prefix of a framed record. **S** <!-- EXT-0.2-010 EXT-16.1.1-001 --> Every record found (595,686) has a type listed below; scan hits of unlisted values 0 and 46 are false positives (zero runs, pairs outside the string table). A byte not in the table is not a known structure type. **S** <!-- EXT-3.10-001 EXT-16.1.1-002 --> F comes from §3.9. "Records" counts records across the corpus; 0 means no real file has one.

| Id | Hex | Name | Role | F | Records (streams) | Evidence | Ids |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 0x02 | GraphicObject | graphic body nested in a page graphic instance (name, library, colour, one primitive list, bbox) | 3 | 6,140 (page, inside 55-62/89) | **S** | <!-- EXT-3.10-002 EXT-16.1.1-004 INT-5-005 --> |
| 4 | 0x04 | DesignProperties | root of `DsnStream`: design properties and metadata | 1 | 102 (DsnStream) | **O** | <!-- EXT-3.10-003 EXT-16.1.1-005 --> |
| 6 | 0x06 | PartCell | part cell | 3 | 4,167 (Cache 2,570 in table 3, Packages 1,597) | **S** | <!-- EXT-3.10-004 EXT-16.1.1-006 INT-5-006 EXT-5.2.6-001 --> |
| 9 | 0x09 | SchematicHeader | root of a `Schematic` stream | 1 | 162 (Schematic) | **O** | <!-- EXT-3.10-005 EXT-16.1.1-007 --> |
| 10 | 0x0A | Page | root of a page stream | 2 | 451 (page) | **S** | <!-- EXT-3.10-006 EXT-16.1.1-008 INT-5-007 --> |
| 11 | 0x0B | PartInstance | unknown | unknown | 0 | none | <!-- EXT-3.10-007 EXT-16.1.1-048 INT-5-008 --> |
| 12 | 0x0C | DrawnInstance | hierarchical block instance | 3 | 174 (page) | **S** | <!-- EXT-3.10-008 EXT-16.1.1-9001 INT-5-009 --> |
| 13 | 0x0D | PlacedInstance | placed part instance | 4 | 15,009 (page) | **S** | <!-- EXT-3.10-009 EXT-16.1.1-9002 INT-5-010 --> |
| 16 | 0x10 | ScalarPinInstance | scalar pin of an instance, nested only (60,316 inside 13, 2,304 inside 12; never a page-list record) | 2 | 62,620 (page) | **S** | <!-- EXT-3.10-010 EXT-16.1.1-009 INT-5-011 EXT-7.6-003 EXT-7.18-014 --> |
| 17 | 0x11 | BusPinInstance | pin instance of a DrawnInstance for a bus port; same body as 16 (new) | 2 | 996 (page, all inside 12, 4 files) | **S** | <!-- INT-5-012 EXT-7.18-014 --> |
| 20 | 0x14 | WireScalar | scalar wire | 2 | 82,605 (page) | **S** | <!-- EXT-3.10-012 EXT-16.1.1-010 INT-5-013 --> |
| 21 | 0x15 | WireBus | bus wire | 2 | 2,884 (page) | **S** | <!-- EXT-3.10-013 EXT-16.1.1-011 INT-5-014 --> |
| 23 | 0x17 | Port | hierarchical port instance on a page (its symbol definition is type 34) | 3 | 2,135 (page) | **S** | <!-- EXT-3.10-014 EXT-16.1.1-012 INT-5-015 --> |
| 24 | 0x18 | LibraryPart | part view: symbol body with pins | 5 | 4,387 (Cache 2,604 in table 2, Packages 1,609, page 174 inline in 12) | **S** | <!-- EXT-3.10-015 EXT-16.1.1-013 INT-5-016 EXT-5.2.6-002 --> |
| 26 | 0x1A | SymbolPinScalar | scalar symbol pin, in the pin slots of 24 (32,398), 33 (328), 34 (127), 35 (130) and also 64 (11, new) | 2 | 101,349 (Cache 31,167, Packages 67,877, page 2,304 inside inline 24, Symbols 1) | **S** | <!-- EXT-3.10-016 EXT-16.1.1-014 INT-5-017 EXT-5.2.6-010 --> |
| 27 | 0x1B | SymbolPinBus | bus symbol pin of a DrawnInstance's inline LibraryPart; every name bus-like (e.g. `FMC_LA_P_[8:1]`) (new) | 2 | 996 (page, all inside the inline 24 of a 12, 4 files; none in Cache or Packages) | **S** | <!-- INT-5-018 EXT-5.2.6-011 --> |
| 29 | 0x1D | BusEntry | bus entry | 2 | 1,688 (page) | **S** | <!-- EXT-3.10-018 EXT-16.1.1-015 INT-5-019 --> |
| 31 | 0x1F | Package | package | 3 | 3,648 (Cache 2,375 in table 4, Packages 1,273) | **S** | <!-- EXT-3.10-019 EXT-16.1.1-016 INT-5-020 EXT-5.2.6-003 --> |
| 32 | 0x20 | Device | device (pin map) of a package, nested in 31 | 2 | 4,395 (Cache 2,735 all inside a 31, Packages 1,660) | **O** (role), **S** (Cache nesting) | <!-- EXT-3.10-020 EXT-16.1.1-017 INT-5-021 EXT-5.2.6-012 --> |
| 33 | 0x21 | GlobalSymbol | global (power) symbol definition, Cache table 1 | 4 | 328 (Cache only; 0 in `Symbols/*`) | **S** | <!-- EXT-3.10-021 EXT-16.1.1-018 INT-5-022 EXT-5.2.6-004 --> |
| 34 | 0x22 | PortSymbol | port symbol definition, Cache table 1 | 4 | 127 (Cache) | **S** | <!-- EXT-3.10-022 EXT-16.1.1-019 INT-5-023 EXT-5.2.6-005 --> |
| 35 | 0x23 | OffPageSymbol | off-page connector symbol definition, Cache table 1 | 4 | 131 (Cache 130, Symbols 1) | **S** | <!-- EXT-3.10-023 EXT-16.1.1-020 INT-5-024 EXT-5.2.6-006 --> |
| 37 | 0x25 | Global | global (power) connector instance | 2 | 8,342 (page) | **S** | <!-- EXT-3.10-024 EXT-16.1.1-021 INT-5-025 --> |
| 38 | 0x26 | OffPageConnector | off-page connector instance | 2 | 6,491 (page) | **S** | <!-- EXT-3.10-025 EXT-16.1.1-022 INT-5-026 --> |
| 39 | 0x27 | SymbolDisplayProp | displayed property, nested in page, Cache (symbol and pin display lists), Packages and Symbols records | 2 | 76,941 (page 65,096, Cache 8,004, Packages 3,794, Symbols 47) | **S** | <!-- EXT-3.10-026 EXT-16.1.1-023 INT-5-027 EXT-5.2.6-013 --> |
| 48 | 0x30 | SymbolVector | named group of primitives inside a primitive list of 24 | 2 | 15 (Cache 10 all inside 24, Packages 5 inside LibraryParts) | **S** | <!-- EXT-3.10-027 EXT-16.1.1-024 EXT-5.2.6-014 --> |
| 49 | 0x31 | Alias | net label on a wire, nested in 20 and 21 | 2 | 16,165 (page) | **S** | <!-- EXT-3.10-028 EXT-16.1.1-025 INT-5-028 --> |
| 52 | 0x34 | SchematicNet | scalar net header: wire net ids name 52 records (82,605/82,605), NetBus members name them (12,130/12,130), net-name rows name them (24,269/24,269) | 1, no short prefix | 27,130 (page) | **S** | <!-- EXT-3.10-029 EXT-16.1.1-026 --> |
| 53 | 0x35 | NetBus | bus net header: bus-wire net ids name 53 records (2,884/2,884) | 1, no short prefix | 1,212 (page) | **S** | <!-- EXT-3.10-030 EXT-16.1.1-027 --> |
| 55 | 0x37 | GraphicBoxInst | rectangle graphic | 2 | 435 (page) | **S** | <!-- EXT-3.10-031 EXT-16.1.1-028 --> |
| 56 | 0x38 | GraphicLineInst | line graphic | 2 | 1,427 (page) | **S** | <!-- EXT-3.10-032 EXT-16.1.1-029 --> |
| 57 | 0x39 | GraphicArcInst | arc graphic (unverified) | 2 (EXT) | 0 | none | <!-- EXT-3.10-033 EXT-16.1.1-030 --> |
| 58 | 0x3A | GraphicEllipseInst | ellipse graphic | 2 | 119 (page) | **S** | <!-- EXT-3.10-034 EXT-16.1.1-031 --> |
| 59 | 0x3B | GraphicPolygonInst | polygon graphic | 2 | 1 (page) | **S** | <!-- EXT-3.10-035 EXT-16.1.1-032 --> |
| 60 | 0x3C | GraphicPolylineInst | polyline graphic | 2 | 31 (page) | **S** | <!-- EXT-3.10-036 EXT-16.1.1-033 --> |
| 61 | 0x3D | GraphicCommentTextInst | text graphic | 2 | 4,107 (page) | **S** | <!-- EXT-3.10-037 EXT-16.1.1-034 --> |
| 62 | 0x3E | GraphicBitMapInst | bitmap graphic | 2 | 11 (page) | **S** | <!-- EXT-3.10-038 EXT-16.1.1-035 --> |
| 64 | 0x40 | TitleBlockSymbol | title-block symbol definition, Cache table 1 | 4 | 130 (Cache 124, Symbols 6) | **S** | <!-- EXT-3.10-039 EXT-16.1.1-036 INT-5-031 EXT-5.2.6-007 --> |
| 65 | 0x41 | TitleBlock | title-block instance | 3 | 443 (page) | **S** | <!-- EXT-3.10-040 EXT-16.1.1-037 INT-5-032 --> |
| 66 | 0x42 | Occurrence | Hierarchy root frame; instance occurrence (link and derived frame) | 1 | 18,599 links, plus 18,599 derived and 109 root frames (Hierarchy) | **O** | <!-- EXT-3.10-041 EXT-16.1.1-038 INT-8-042 --> |
| 67 | 0x43 | HierarchyNet | design net record: occurrence id and flattened net name | 1 | 34,640 (Hierarchy) | **O** | <!-- EXT-3.10-042 EXT-16.1.1-039 INT-8-042 --> |
| 68 | 0x44 | PortOrScalarPinOccurrence | scalar pin occurrence; also named as the header port-list record (that role not distinguished by framing) | 1 | 84,820 (Hierarchy) | **O** | <!-- EXT-3.10-043 EXT-16.1.1-052 --> |
| 69 | 0x45 | BusPinOccurrence | bus pin occurrence, in the same 4 files that hold 17 and 27 (new) | 1 | 10,258 (Hierarchy) | **O** | <!-- EXT-3.6-036 --> |
| 75 | 0x4B | ErcSymbol | ERC marker symbol definition, Cache table 1 | 4 | 577 (Cache 503, Symbols 74) | **S** | <!-- EXT-3.10-045 EXT-16.1.1-040 EXT-5.2.6-008 --> |
| 76 | 0x4C | BookMarkSymbol | bookmark symbol definition (unverified) | 4 (EXT) | 0 | none | <!-- EXT-3.10-046 EXT-16.1.1-041 EXT-3.6-038 EXT-5.2.6-009 --> |
| 77 | 0x4D | ErcObject | ERC marker instance | 3 | 2,066 (page) | **S** | <!-- EXT-3.10-047 EXT-16.1.1-042 INT-5-033 --> |
| 78 | 0x4E | BookMarkSymbolInst | unknown | unknown | 0 | none | <!-- EXT-3.10-048 EXT-16.1.1-054 --> |
| 82 | 0x52 | TitleBlockOccurrence | title-block occurrence | 1 | 740 (Hierarchy) | **O** | <!-- EXT-3.10-049 EXT-16.1.1-043 --> |
| 88 | 0x58 | GraphicBezierInst | Bezier graphic (unverified) | 2 (EXT) | 0 | none | <!-- EXT-3.10-050 EXT-16.1.1-044 --> |
| 89 | 0x59 | GraphicOleEmbedInst | embedded OLE object graphic | 2 | 9 (page) | **S** | <!-- EXT-3.10-051 EXT-16.1.1-045 --> |
| 91 | 0x5B | OffPageOccurrence | off-page connector occurrence | 1 | 6,475 (Hierarchy) | **O** | <!-- EXT-3.10-052 EXT-16.1.1-046 --> |
| 98 | 0x62 | PinShapeSymbol | unknown | unknown | 0 | none | <!-- EXT-3.10-053 EXT-16.1.1-056 INT-5-034 --> |
| 103 | 0x67 | NetGroup | net-bundle group | 2 | 8 (NetBundleMapData) | **O** | <!-- EXT-3.10-054 EXT-16.1.1-047 INT-5-035 --> |
| 111 | 0x6F | (no name) | unknown | unknown | 0 | none | <!-- EXT-3.10-055 EXT-16.1.1-058 --> |

- The Cache holds only types 6, 24, 26, 31, 32, 33, 34, 35, 39, 48, 64 and 75, at top level or nested; every Cache variant sits in its table (0 table/type violations). **S** <!-- EXT-5.2.6-016 -->
- OpenOrCadParser names 66 `SthInHierarchy1` and 67 `NetDbIdMapping`; the parser's names for 2, 17, 52 and 53 are `SthInPages0`, `T0x11`, `T0x34` and `T0x35` (`structure-types.ts`). <!-- INT-8-042 INT-5-001 INT-5-002 -->
- The same numbers serve as record-type values elsewhere: the Cache variant type equals the body's type byte on every variant, and the page symbol-kind byte is 24 on instances and 64 on title blocks. **S** The values in `* Directory` entries and `Symbols/Types` were not checked. <!-- EXT-16.1.1-060 -->

### 3.15 Primitive kind codes

Graphic primitives inside a primitive list use their own kind codes, a separate code space from structure type ids: 40 Rect, 41 Line, 42 Arc, 43 Ellipse, 44 Polygon, 45 Polyline, 46 CommentText, 47 Bitmap, 48 SymbolVector, 87 Bezier. The one overlap is 48, which is both the SymbolVector kind and the SymbolVector structure type: kinds 40-45, 47 and 87 never start a framed record, and kind-48 entries are SymbolVector records (15). **S** <!-- EXT-8.2-001 -->

Kinds seen in Cache primitive lists: 40: 1,660, 41: 13,688, 42: 1,361, 43: 1,014, 44: 471, 45: 164, 46: 821, 47: 4, 87: 3, plus kind 48; 51 entries could not be decoded by the checker. **S** <!-- EXT-5.2.6-015 --> Value 91 never occurs as a primitive kind (19,196 decoded Cache primitives); type-91 records occur only in the Hierarchy (6,475). **S** <!-- EXT-8.2-015 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| BusPinInstance (17) never occurs | EXT §3.10, §16.1.1 | 996 records, F = 2, short prefix and preamble, all inside a DrawnInstance (4 files) | **S** | <!-- EXT-3.10-011 EXT-16.1.1-050 --> |
| SymbolPinBus (27) never occurs | EXT §3.10, §16.1.1 | 996 records inside the inline LibraryPart of DrawnInstances (4 files), framed by the page walk | **S** | <!-- EXT-3.10-017 EXT-16.1.1-051 --> |
| BusPinOccurrence (69) never occurs | EXT §3.10, §16.1.1 | 10,258 records in the Hierarchy streams of the same 4 files | **O** | <!-- EXT-3.10-044 EXT-16.1.1-053 --> |
| Types 52 and 53 carry no prefix chain at all | INT §5 | each starts with one 9-byte full prefix whose R1 stop is the record end (27,130 + 1,212); the parser already skips it as a prefix | **S** | <!-- INT-5-004 --> |
| Type 52 is primitive graphics (line/shape) | INT §5 | net header (SchematicNet): wire net ids name 52 records 82,605/82,605 | **S** | <!-- INT-5-029 --> |
| Type 53 is primitive graphics (polyline/shape) | INT §5 | bus net header (NetBus): bus-wire net ids name 53 records 2,884/2,884 | **S** | <!-- INT-5-030 --> |
| Kind 6/6 justification sub-records are 20-25 bytes | EXT §7.0.3 | lengths 16 (112 records), 20, 21, 22, 23 | **S** | <!-- EXT-7.0.3-009 --> |
| Page objects other than 12, 13, 39, 23, 77 have an empty preamble | EXT §7.0.3 | 21 WireBus carries a kind 2/6 extension on 32 records | **S** | <!-- EXT-7.0.3-013 --> |
| The rule governing the prefix count is unknown | INT §4.3 | F is fixed per type (§3.9) and the chain ends where the zero and nesting tests say, 0 exceptions on 595,686 records | **S** | <!-- INT-4.3-003 -->
| Attribute-lock flags take only 0 and 128 | EXT §16.1.6 | flags 13 on 1 row (type-13 PlacedInstance, STM32F746NGH V1.1_last.DSN, page MCU, row `1 10 __NG_OWNER 13 0  0  `); the row has the same token shape as the 4,368 others and parses to its exact end | **S** | <!-- EXT-16.1.6-005 --> |

### Unverified

- *unverified*: `end_offset` is a length, not a pointer, so a record can be moved without patching it. A writer test is needed. <!-- EXT-3.2.1-005 -->
- *unverified*: `prop_count` values below -1 mean no pairs (the parser loops on `size >= 0`). No such value occurs (0 of 567,344). <!-- EXT-3.2.2-007 -->
- *unverified*: zero bytes after the last extension sub-record end the sequence. No extension has bytes after its last sub-record (0 of 4,583: 4,582 record preambles plus 1 Hierarchy root-data preamble). <!-- EXT-3.4-007 -->
- *unverified*: in attribute-lock rows, `flags & 0x80` means the property was edited by the user (meaning per name only). Needs Capture; 128 on 1,594 rows. <!-- EXT-3.4-011 -->
- *unverified*: types 23, 65 and 77 can also occur with two full prefixes, R2 ending at the preamble and R1 covering the base layer and trailer, and a reader should accept that. No such record exists (0 of 4,644). <!-- EXT-3.6-046 EXT-7.0.2-018 -->
- *unverified*: type 76 BookMarkSymbol has F = 4, a short prefix and preamble, region ends as type 33, `prop_count` 0, and sits in Cache table 1 with the layout of EXT §5.3. No real file has a type-76 record. <!-- EXT-3.6-038 EXT-5.2.6-009 -->
- *unverified*: type 57 is GraphicArcInst (arc graphic) and type 88 GraphicBezierInst (Bezier graphic), both page graphic instances with F = 2. No real file has a type-57 or type-88 record. <!-- EXT-3.10-033 EXT-16.1.1-030 EXT-3.10-050 EXT-16.1.1-044 -->
- *unverified*: type 76 is BookMarkSymbol, a bookmark symbol definition in Cache and `Symbols/*`. No real file has one. <!-- EXT-3.10-046 EXT-16.1.1-041 -->
- *unverified*: type 11 PartInstance is a type id that never appears as a page-list record; INT names it "part instance (unused by us)". No real file has a type-11 record. <!-- EXT-7.6-001 INT-5-008 -->
- *unverified*: type 98 is PinShapeSymbol, a pin shape symbol definition. No real file has a type-98 record. <!-- INT-5-034 -->
- *unverified*: a reader should keep undecoded bytes inside a region for byte-exact rewriting, and a writer must recompute the `end_offset` (prefix bytes +1..+4) of every enclosing full prefix when a region's length changes. Writer guidance; needs a round trip through Capture. <!-- EXT-3.7-003 EXT-3.7-004 EXT-18.10.1-014 -->
- *unverified*: records carry three independent `u32` identifier spaces. The id-space semantics are outside what framing checks can show. <!-- EXT-3.9-001 -->
- *unverified*: a writer must allocate a new id above both the stored watermark and the largest id in use, because stored watermarks can lie below ids present; why they do is EXT's open question. Watermarks are outside framing scope. <!-- EXT-3.9-007 EXT-3.oq-004 -->
- *unverified*: all coordinates in EXT chapter 5 are signed integers in the symbol's local coordinate system. Outside framing. <!-- EXT-5.1-012 -->
- *unverified*: the Page record's extension, when present, is one kind-0 version-2 sub-record with payload `01 00 00 00 00 00 00`; the whole 19-byte extension is `13 00 00 00 00 00 00 00 02 00 00 00 01 00 00 00 00 00 00`. No Page record has an extension (0/451). <!-- EXT-6.2.1-011 EXT-6.2.1-012 EXT-16.1.5-010 -->
- *unverified*: a kind-0 sub-record with payload `00 00 00 01 00 00 00` (length 19) on types 39 (alone or before a kind 6/6 record) and 77 means value-if-value-exists: draw the display only when the property has a value. 0 records carry it. <!-- EXT-7.0.3-010 EXT-16.1.5-005 -->
- *unverified*: on a Port (23), the kind-0 sub-record `13 00 00 00 00 00 00 00 02 00 00 00 05 00 00 00 00 00 00` (payload `05 00 00 00 00 00 00`) means the port is locked. No Port carries it (0/2,135). <!-- EXT-7.0.3-011 EXT-7.9-002 -->
- *unverified*: reader guidance to accept Port trailers of other lengths, keeping the bytes and leaving the port type undefined. Every trailer is 9 bytes (0 of 2,135 differ). <!-- EXT-7.9-009 -->
- *unverified*: a type-78 record in a list can be skipped through its first full prefix. No real file has a type-78 record. <!-- EXT-7.14-002 -->
- *unverified*: the all-zero payload `00 00 00 00 00 00 00` means value-if-exists off, and the `05` payload on a Port means locked. Neither occurs (0 records; 0 of 2,135 Ports carry a Flag record), so neither meaning can be checked. <!-- EXT-16.1.5-006 EXT-16.1.5-009 -->
- *unverified*: EXT's per-type `prop_count` lists include values that no real record carries: type 4: 3; type 9: 3; type 13: 20 and 46-55; type 16: 2; type 20: 3; type 23: 1; type 24: 15-52; type 26: 3; type 37: 1; type 38: 4; type 64: 13; type 65: 15-22; type 82: 1-3, 5-10, 12-15, 17-19; type 91: 1. Across all types the listed values 20 and 46-55 never occur. <!-- EXT-3.6-003 EXT-3.6-005 EXT-3.6-008 EXT-3.6-009 EXT-3.6-011 EXT-3.6-013 EXT-3.6-014 EXT-3.6-015 EXT-3.6-023 EXT-3.6-024 EXT-3.6-031 EXT-3.6-032 EXT-3.6-040 EXT-3.6-041 EXT-3.2.2-005 -->
- *unverified*: the listed page graphic types 57 (Arc) and 88 (Bezier) as frames of F = 2 with count 0 and an inline GraphicObject. No real record of either type exists. <!-- EXT-3.6-030 EXT-7.0.2-007 EXT-7.0.3-005 EXT-3.10-002 -->
- *unverified*: extension kind 8, version 6 (Line endings) in Polyline primitive extensions, payload text of three numbers. Kind 8 never occurs. <!-- EXT-16.1.4-008 -->

### Open questions

- What the 4 reserved bytes of a full prefix mean. They are 0 on every full prefix in our data. <!-- EXT-3.oq-001 -->
- What `prop_count` -1 means as distinct from 0. Both mean zero pairs; -1 occurs only on types 2, 6, 32, 39, 48 and 49. <!-- EXT-7.0.3-007 EXT-16.1.3-006 -->
- What the kind-0 payload `05 00 00 00 00 00 00` means outside ports (EXT's theory: locked, on 4, 13, 39, 55, 56), and what `01 00 00 00 00 00 00` on the Page record means. The 05 payload occurs only on type 55 (2 records); the 01 payload never occurs (0/451 Page records have an extension); EXT's (0, 2) lock form never appears on 13, 39 or 56. <!-- EXT-3.4-019 EXT-3.4-021 EXT-3.oq-002 EXT-16.oq-004 EXT-16.1.5-008 EXT-7.0.3-012 EXT-6.2.1-013 -->
- The layout and meaning of types 11 (PartInstance; EXT also calls it the part-instance layer shared by 12 and 13), 78 (BookMarkSymbolInst), 98 (PinShapeSymbol) and 111 (unnamed). No real file has a record of any of them, so their name, F, short prefix and region ends are unknown. <!-- EXT-3.6-043 EXT-3.oq-003 EXT-7.6-002 EXT-16.1.1-049 EXT-16.1.1-055 EXT-16.1.1-057 EXT-16.1.1-059 -->

Parser coverage: the parser reads full prefixes, short prefixes and their property pairs, and preambles through `generic-parser.ts` (auto-detecting F), steps over the single prefix of types 52 and 53 and the type-66 frames, and continues at R1 for skipped types (2, 6, 29, 33, 34, 35, 64, 65, 77); it does not decode extension sub-records (kinds, Flag records, attribute locks), does not read `NetBundleMapData` (103), and reads type 69 only through its generic pin-occurrence path.

<!-- meta: EXT-3.1-003 EXT-3.1-004 EXT-3.6-001 EXT-5.1-010 EXT-7.0.1-009 EXT-7.0.1-010 EXT-7.0.1-011 EXT-8.4.3-002 EXT-16.1.1-061 INT-5-003 -->

---

## 4. The Library stream

`Library` is a stream at the root of the compound file. Every design (`.DSN`, 120 of 120) and every part library (`.OLB`, 27 of 27) in our data has one. **S** (147 containers) <!-- EXT-4-001 --> It holds the file-format version, the font table, the default font of each text category, default instance flags, default part fields, default page settings, the global string table that every property pair and every name or library index elsewhere refers to, the part aliases and, in a design, the name of the root schematic. **S** (146 streams read in this order to the exact end) <!-- EXT-4-002 INT-6-002 -->

The stream is not framed: it carries no prefix chain and no preamble. It is one flat run of little-endian fields read front to back with no padding. **S** (146 streams) <!-- EXT-3-002 EXT-4-004 -->

Counts in this chapter: 147 readable containers, of which 130 are at Library version 3.x (105 designs, 25 libraries), 16 at 2.0 (14 designs, 2 libraries) and 1 at 1.1. "146 streams" means every v2 and v3 Library. The 1.1 stream decodes with neither string-count width, so it gives no field values in this chapter beyond its introduction and version (§4.15).

### 4.1 Layout

F is the number of font rows. Offsets after the font table depend on F; offsets after the part fields depend on their lengths and are written "follows".

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | char[32] | `introduction` | Database signature (§4.2) | **S** (147) | <!-- EXT-4.1-002 INT-6-003 --> |
| +0x20 | u16 | `version_major` | Format major version (§4.3) | **S** (147) | <!-- EXT-4.1-003 INT-6-004 --> |
| +0x22 | u16 | `version_minor` | Format minor version | **S** (147) | <!-- EXT-4.1-004 INT-6-005 --> |
| +0x24 | u32 | `created` | Creation time (§4.4) | **S** (146) | <!-- EXT-4.1-005 INT-6-006 --> |
| +0x28 | u32 | `modified` | Time of last save | **S** (146) | <!-- EXT-4.1-006 INT-6-007 --> |
| +0x2C | u32 | `reserved` | Always 0 | **S** (146) | <!-- EXT-4.1-007 INT-6-008 EXT-2.8-001 --> |
| +0x30 | u16 | `font_count` | F + 1 (§4.5) | **S** (146 exact-end reads) | <!-- EXT-4.1-008 INT-6-009 --> |
| +0x32 | LOGFONTA[F] | `fonts` | 60-byte font rows | **S** (146) | <!-- EXT-4.1-009 INT-6-010 --> |
| +0x32+60F | u16 | `default_font_count` | 24 (§4.6) | **S** (146 of 146) | <!-- EXT-4.1-010 INT-6-011 --> |
| +0x34+60F | u16[24] | `default_fonts` | Default font row per text category | **S** (146) | <!-- EXT-4.1-011 INT-6-012 --> |
| +0x64+60F | u32[2] | `default_flags` | Default instance settings (§4.7) | **S** (146) | <!-- EXT-4.1-012 --> |
| +0x6C+60F | lstr[8] | `default_part_fields` | Eight default part field names (§4.8) | **S** (146) | <!-- EXT-4.1-013 --> |
| follows | 156 bytes | `default_page_settings` | Page settings block (§4.9) | **S** (146) | <!-- EXT-4.1-014 INT-6-015 --> |
| follows | u32 (v3) or u16 (v2.0) | `string_count` | S, number of string entries (§4.10) | **S** (130 u32, 16 u16) | <!-- EXT-4.1-015 --> |
| follows | entry[S] | `strings` | The string table | **S** (271,291 entries) | <!-- EXT-4.1-016 --> |
| follows | u16 | `alias_count` | A (§4.11) | **S** (146) | <!-- EXT-4.1-017 INT-6-018 --> |
| follows | (lstr, lstr)[A] | `part_aliases` | Alias name, package name | **S** (2 libraries with pairs) | <!-- EXT-4.1-018 INT-6-019 --> |
| follows | var | `design_suffix` | Designs only (§4.12) | **S** (119 designs; absent in 27 libraries) | <!-- EXT-4.1-019 --> |

The stream ends exactly after the design suffix in a design and exactly after the part aliases in a library. **S** (105 v3 and 14 v2.0 designs, 27 libraries) <!-- EXT-4.1-020 -->

### 4.2 Introduction and database type

The introduction is NUL-terminated 7-bit ASCII text inside a fixed 32-byte field; the terminator always lies inside the field. **S** (147) <!-- EXT-4.2-001 EXT-2.3.1-002 EXT-2.3.3-001 --> In every file the text is padded with spaces so that its `00` sits at +0x1F, so no bytes follow the terminator inside the field. **S** (147) <!-- EXT-2.3.3-002 -->

| Text at +0x00 | Padding | Database type | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `OrCAD Windows Design` | 11 spaces, `00` at +0x1F | Design: carries the design suffix | **S** (120 of 120 `.DSN`) | <!-- EXT-4.2-002 EXT-4.2-003 EXT-16.7.1-002 --> |
| `OrCAD Windows Library` | 10 spaces, `00` at +0x1F | Part library: no design suffix | **S** (27 of 27 `.OLB`) | <!-- EXT-4.2-004 --> |

The database type is given by the prefix of the introduction. **S** (147) <!-- EXT-16.7.1-001 -->

### 4.3 Version

| Major.minor | Files | Ids |
| --- | --- | --- |
| 3.2 | 123 (98 designs, 25 libraries) | |
| 3.3 | 7 | |
| 2.0 | 16 (14 designs, 2 libraries) | |
| 1.1 | 1 (`a3640.dsn`) | |

`version_major` is 3 in 130 files, 2 in 16 and 1 in one; `version_minor` is 2 or 3 at major 3, 0 at major 2 and 1 at major 1. **S** (147; the 1.1 file read at +0x20 only) <!-- EXT-4.3-002 -->

### 4.4 Times

`created` (+0x24) and `modified` (+0x28) are `u32` Unix seconds, both non-zero, with `created <= modified`. **S** (146; years 2001 to 2024 at v3, 2003 to 2019 at 2.0) <!-- EXT-2.6.1-002 EXT-4.4-001 EXT-4.4-004 --> Whether they are UTC or local cannot be shown from the bytes. `modified` is the time of the last save: the `saved` stamp of the `* Directory` streams (§12.2) equals it or is 1 to 60 seconds later. **S** (146 of 146 files with directories: equal in 126, 1 to 60 s later in 20) <!-- EXT-4.4-002 --> `reserved` at +0x2C is 0. **S** (146) <!-- EXT-4.4-003 -->

### 4.5 Font table

`font_count` is the number of font rows plus one, so it is never 0, and F = `font_count` − 1 rows follow. **S** (146; the row count is proven by the exact stream end) <!-- EXT-4.5-001 --> Observed `font_count`: 3 to 189 at v3, 3 to 69 at 2.0. **S** EXT gives 4 to 415; the value 3 occurs in 19 v3 files. **S** <!-- EXT-4.5-002 -->

Each row is a 60-byte Win32 `LOGFONTA`. **S** (146 exact-end reads; 2,717 v3 rows and 293 v2.0 rows) <!-- EXT-4.5-004 EXT-16.4.5-001 INT-6-052 INT-6-053 --> The format names no values; the Win32 field names give the meaning.

| Row offset | Type | Field | Values seen | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | i32 | `lfHeight` | v3: −120 to 8, mostly negative; v2.0 adds −267 to −133 and two junk rows | **S** (2,717 v3 rows) | <!-- EXT-4.5-005 --> |
| +0x04 | i32 | `lfWidth` | v3: 0 to 58; 0 in 1,419 of 2,717 | **S** | (Refuted table) |
| +0x08 | i32 | `lfEscapement` | v3: 0, 900, 1800, 2700 (tenths of a degree), all four listed values; outside the list, 1242632 on 2 junk v2.0 rows | **S** (2,717) | <!-- EXT-4.5-007 EXT-16.4.5-002 --> |
| +0x0C | i32 | `lfOrientation` | v3: 0, and 900 on 7 rows | **S** | (Refuted table) |
| +0x10 | i32 | `lfWeight` | v3: 0, 200, 300, 400, 700 | **S** (listed 100, 500, 600, 900 under Unverified) | <!-- EXT-4.5-009 EXT-16.4.5-004 --> |
| +0x14 | u8 | `lfItalic` | 0 (2,496 v3 rows), 255 (195), 1 (26 v3, 12 v2.0) | **S** | <!-- EXT-4.5-010 EXT-16.4.5-005 --> |
| +0x15 | u8 | `lfUnderline` | Always 0 | **S** (3,010 rows, v2 and v3) | <!-- EXT-4.5-011 --> |
| +0x16 | u8 | `lfStrikeOut` | Always 0 | **S** (3,010) | <!-- EXT-4.5-012 EXT-16.4.5-006 --> |
| +0x17 | u8 | `lfCharSet` | v3: 0 (2,536), 1 (167), 238 (10), 255 (2), 177 (2); v2.0 adds 161 | **S** | (Refuted table) |
| +0x18 | u8 | `lfOutPrecision` | v3: 0, 3, 7, all listed values; outside the list, 36 on 2 junk v2.0 rows | **S** | <!-- EXT-4.5-014 EXT-16.4.5-009 --> |
| +0x19 | u8 | `lfClipPrecision` | v3: 0, 2, 18, all listed values; outside the list, 12 on 2 v2.0 rows | **S** | <!-- EXT-4.5-015 EXT-16.4.5-010 --> |
| +0x1A | u8 | `lfQuality` | v3: always 1; a v2.0 junk row has 3; never above 6 | **S** (3,010) | <!-- EXT-4.5-016 EXT-16.4.5-011 --> |
| +0x1B | u8 | `lfPitchAndFamily` | 0, 2, 16, 18, 30, 34, 48, 49, 66 at v3; v2.0 adds 20 and 50 | **S** | <!-- EXT-4.5-017 EXT-16.4.5-012 --> |
| +0x1C | char[32] | `lfFaceName` | Face name, lengths 5 to 22 (EXT's 3 to 29 is not reached) | **S** | <!-- EXT-4.5-018 --> |

The `lfQuality` value 2 that EXT lists never occurs, and 82 never occurs among `lfPitchAndFamily` values.

The face name is the bytes before the first `00`; a `00` always lies inside the 32-byte field. **S** (3,010 v2/v3 rows) <!-- EXT-2.3.3-003 --> The bytes after that terminator are not part of the name and are usually not zero. **S** (non-zero in 2,561 of 3,010 rows; 2,341 of 2,717 at v3) <!-- EXT-4.5-019 -->

### 4.6 Default font mapping

`default_font_count` is 24 in every v2 and v3 file. **S** (146 of 146) <!-- EXT-4.6-001 EXT-2.8-007 --> universal-netlist reads this count instead of assuming 24, so another value would not shift the string table. **S** (24 on 146 of 146 v2/v3 files) <!-- INT-13.4-014 -->

`default_fonts` holds 24 `u16` slots. Each slot is 0, meaning no stored font, or a font row number from 1 to F. **S** (146) <!-- EXT-4.6-002 EXT-16.4.4-001 EXT-16.13.2-012 --> Every non-zero slot is at most F **S** (146) <!-- EXT-4.6-012 -->, and the only slot values seen are 0, 1 and 2.

The zero slots are exactly 3, 4 and 17 to 23 in every v2 and v3 file. **S** (146 of 146) <!-- EXT-4.6-013 --> EXT also lists a mapping with no zero slot and a slot-10-only pattern; neither occurs (Unverified). **S** (146) <!-- EXT-16.4.4-010 -->

### 4.7 Default flags

The 8 bytes after the slots are two `u32` words. **S** (146) <!-- INT-6-013 --> The pairs seen are (0, 1) in 100 of 130 v3 files, (0, 0) in 29 and (1, 1) in 1; at 2.0 the second word is 0 in 2 files. **S** EXT names the words `default_drawn_instance_primitive` and `default_placed_instance_primitive`; their meaning is open (§Open questions).

### 4.8 Default part fields

Eight `lstr` values follow back to back, each ending in `00`. **S** (146) <!-- EXT-4.8-001 --> Every v2 and v3 file holds the same eight strings: `1ST PART FIELD` to `7TH PART FIELD` (14 bytes each) and `PCB Footprint` (13 bytes). **S** (146 of 146) <!-- EXT-4.8-002 INT-6-014 -->

### 4.9 Default page settings

The default page settings are a fixed 156-byte block. **S** (146 exact-end reads) <!-- INT-6-051 --> It has the layout of the page-settings block of a page record; its fields are specified with the page stream. Its `IsMetric` field is 1 in 8 of 130 v3 files. **S** (Refuted table, EXT-16.7.3-005)

EXT describes two forms of the default block: a common form with non-empty part fields and zero slots 3, 4, 17 to 23, and an empty form. Every v2 and v3 file has the common form; the empty form and its patterns (eight empty part fields, zero slot 10 only, or no zero slot) never occur. **S** (146) <!-- EXT-4.9-048 EXT-4.9-049 -->

### 4.10 String table

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0 | u32 (v3) or u16 (v2.0) | `string_count` | S. v3: 1 to 27,095; v2.0: 3 to 8,760 | **S** (130 + 16) | <!-- EXT-4.10-001 INT-6-016 --> |
| +4 (+2 at v2.0) | entry[S] | `strings` | In index order | **S** (146 exact-end reads) | <!-- EXT-4.10-002 --> |

| Entry offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0 | u16 | `len` | Payload length; 0 to 1,421 seen | **S** | <!-- EXT-4.10-003 --> |
| +2 | len bytes | payload | Never contains `00`; bytes ≥ 0x80 occur in 28 files, control bytes below 0x20 in 19 | **S** (271,291 payloads) | <!-- EXT-4.10-004 --> |
| +2+len | u8 | terminator | Always `00` | **S** (271,291) | <!-- EXT-4.10-005 EXT-2.8-002 INT-6-017 --> |

The 271,291 entries are 251,960 in 130 v3 files and 19,331 in 16 v2.0 files. The count is a `u32` at v3 and a `u16` at 2.0: every 2.0 Library overruns its stream when read with a `u32` count and ends exactly with a `u16` count. **S** (all 16 v2.0 files, including fixture `gprino-lf`; `u32` on all 130 v3 files) OpenOrCadParser reads a `u16` count for its file-format version "A" and a `u32` otherwise, so its "version A" is Library major 2 on this corpus. **S** <!-- INT-6-054 INT-6-057 -->

- A string reference is a `u32` index into this table. **S** (103 DsnStream pairs resolve) <!-- EXT-2.7-001 -->
- Entry 0 is the empty string and is the only empty entry, so index 0 also means "no string". **S** (146) <!-- EXT-2.7-002 EXT-4.10-007 -->
- No two entries are equal. **S** (146) <!-- EXT-4.10-008 -->
- Each entry takes at least 3 bytes, so S ≤ (bytes after `string_count`) / 3. **S** (146) <!-- EXT-4.10-009 -->
- The table size ranges from 1 to 27,095 entries; small libraries hold 1 to 4. **S** <!-- EXT-2.7-005 -->
- An index is a 0-based position in the table. Every DsnStream and Schematic-header index checked lies below `string_count`. **O** <!-- EXT-4.10-006 EXT-18.10.2-003 --> The other index sites (short-prefix pairs, record name and library indices, display name indices, part value and contents indices, Hierarchy pairs, occurrence designators) are checked in their own chapters.

universal-netlist decodes string payloads as Windows-1252; 28 of 130 v3 files have payload bytes ≥ 0x80. **T** <!-- INT-3.1-005 --> Which code page Capture used is not provable from the bytes.

### 4.11 Part aliases

`alias_count` is 0 in all 119 designs; it is 3 in one v3 library and 25 in a 2.0 library. **S** <!-- EXT-4.11-001 --> Each alias is two `lstr`: the alias name, then the package name. **S** (both libraries read to the exact end) <!-- EXT-4.11-002 --> Only libraries carry aliases.

### 4.12 Design suffix

The suffix is present in every design and absent in every library. **S** (119 designs, 27 libraries) <!-- EXT-4.12-001 INT-6-020 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `reserved` | Always 0 | **S** (119) | <!-- EXT-4.12-002 EXT-2.8-003 --> |
| +0x04 | 4 bytes | (watermark) | As two `u16`: +0x04 holds 1 to 63,072, +0x06 holds 0 (90 v3 designs), 1 (10) or 2 (5). EXT reads the 4 bytes as one `u32` occurrence-ID watermark (Hierarchy chapter) | **S** (119) | <!-- INT-6-021 --> |
| +0x08 | lstr | `root_schematic_name` | Root schematic; never empty; last field of the stream | **S** (119) | <!-- EXT-4.12-004 INT-6-022 --> |

Nothing follows the root name. **S** (119) <!-- EXT-4.12-013 --> Every design at 3.2 and 3.3 (105) ends with it at the stream end. **S** <!-- INT-6-048 -->

The root name equals one Views Directory entry (§12.2). **S** (119 of 119) <!-- EXT-4.12-009 --> It is the schematic Capture's netlist starts from: on 45 of 46 designs with a Capture `pstxprt.dat`, the export's `C_PATH='@design.<schematic>(sch_1):...'` names it, including the multi-view designs SENSOR_BOARD (6 views), EEM2TTL (4), SENSORS EXPO DEMO (3), ROHM_SENSOR_PLATFORM_BASE_BOARD, STRAIN GAUGE BOARD and SEQUENTIALTIMER (2 each). **E** <!-- INT-6-046 INT-6-049 --> The one exception is `nixie.dsn`: its root is `SIM1` while its export's path starts at `NIXIE`. **E** <!-- INT-6-050 --> INT explains this by a save one day after the export with a simulation sheet made root; the date story is not checked.

### 4.13 Validity rules

A Library stream is malformed when any rule below fails. Every rule holds on every well-formed file in our data, with the one exception noted.

| Rule | Holds on | Ids |
| --- | --- | --- |
| The introduction starts with `OrCAD Windows Design` or `OrCAD Windows Library` | **S** (147) | <!-- EXT-4.13-002 --> |
| `reserved` at +0x2C is 0 | **S** (146) | <!-- EXT-4.13-003 --> |
| `font_count` is not 0 | **S** (146) | <!-- EXT-4.13-004 --> |
| No font row has `lfQuality` > 6 | **S** (3,010 rows) | <!-- EXT-4.13-005 --> |
| `default_font_count` is 24 | **S** (146 v2/v3 files) | <!-- EXT-4.13-006 --> |
| `string_count` ≤ remaining bytes / 3 | **S** (146) | <!-- EXT-4.13-007 --> |
| Every string terminator is `00` | **S** (146) | <!-- EXT-4.13-008 --> |
| The design suffix `reserved` is 0 | **S** (119) | <!-- EXT-4.13-009 --> |
| No field runs past the end of the stream | **S** (146) | <!-- EXT-4.13-010 --> |

### 4.14 Part-library variant

A part library (`.OLB`) uses the same container and the same Library layout (25 v3 with a `u32` string count, 2 v2.0 with a `u16`). **S** (27) <!-- EXT-4.14-001 --> It differs in two places: the introduction starts with `OrCAD Windows Library` **S** (27 of 27) <!-- EXT-4.14-002 -->, and there is no design suffix, so nothing follows the part aliases. **S** (27 of 27) <!-- EXT-4.14-003 -->

### 4.15 Versions 1.1 and 2.0

A Library 2.0 stream has the v3 layout with a `u16` string count (§4.10). **S** (16) A protected design's version is encrypted and is read after decryption (Container chapter).

The single 1.1 file, `a3640.dsn`, has the design introduction and version 1.1 at +0x20; the rest of its stream reads to the end with neither a `u32` nor a `u16` string count, so this chapter quotes no field values from it (§Open questions).

### 4.16 Definition storages: `Packages/<p>` and `Symbols/<s>`

The root always holds the seven storages `Packages`, `Cells`, `Parts`, `Symbols`, `Graphics`, `Views` and `ExportBlocks`, in designs and libraries of every version. **S** (147) <!-- EXT-5.7.1-001 -->

| Storage | Content | Evidence | Ids |
| --- | --- | --- | --- |
| `Cells`, `Parts`, `ExportBlocks` | Always empty | **S** (147) | <!-- EXT-5.7.1-002 --> |
| `Graphics` | Exactly one stream, `Graphics/$Types$`, of 0 bytes | **S** (147) | <!-- EXT-5.7.1-003 --> |
| `Symbols` | `Symbols/$Types$` plus zero or more `Symbols/<s>` streams | **S** (147) | <!-- EXT-5.7.1-005 --> |
| `Packages` | Zero or more `Packages/<p>` streams (up to 88 and more per file) | **S** | <!-- EXT-5.7.1-004 --> |
| `Views` | Schematic folders (`Schematic`, `Pages`, `Hierarchy`); empty in libraries | **S** (120 designs) | <!-- EXT-5.7.1-006 --> |

EXT names the two type-list streams `Types`; their real name is `$Types$`. Their layout is in §12.11.

The `Packages`, `Cells` and `Parts` directories (§12.2) index these storages:

- Packages Directory lists the `Packages/<p>` streams: 1,372 v3 and 186 v2.0 streams are listed. The exceptions are 36 `_pDboPackage_Copy_` streams in 4 v3 files (17 in each of the two `BeagleBoard-xM_ORCAD.DSN` copies, fixture and corpus; 1 each in `parallella_schematic.dsn` and `parallella_e16_z7020_schematic.dsn`; 19 in 3 files after deduplication by content) and `Packages/STM32_Bluepill` in `PRIVATE_LIB.OLB`, which have no entry. **S** <!-- EXT-5.7.1-007 -->
- Cells Directory lists the part cells inside the `Packages/<p>` streams, and Parts Directory their views, in 129 of 130 v3 files; `PRIVATE_LIB.OLB` has a cell in an unlisted stream. **S** <!-- EXT-5.7.1-008 EXT-5.7.1-009 -->
- These directories may list further packages, cells or views that have no stream (10 files list packages with no stream). Every Symbols Directory entry has its stream. **S** (130) <!-- EXT-5.7.1-010 -->
- A package held only in Cache can be listed: `BEAGLEBONEBLK_C3.DSN` (fixture, corpus copy and the `_BEAGLEBOARD` variant) lists 20 of its 88 packages that have no `Packages/<p>` stream and exist only in Cache. **S** (Refuted table, EXT-5.7.1-011)

#### `Packages/<p>` stream

A `Packages/<p>` stream holds one package with its cells. **S** (1,373 v3 streams parsed to the exact end; 2.0 streams use the older record encoding and are not read here)

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u16 | `cell_count` | ≥ 1; 1 to 8, 10, 12, 13 seen (EXT's range 1 to 31 is not reached) | **S** (1,373) | <!-- EXT-5.7.2-001 --> |
| +0x02 | cell[cell_count] | `cells` | Back to back | **S** (1,373) | <!-- EXT-5.7.2-002 --> |
| follows | record | Package | One Package record (type 31) ending exactly at the stream end | **S** (1,373) | <!-- EXT-5.7.2-003 --> |

| Cell part | Type | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- |
| first | record | One PartCell record (type 6) | **S** (1,697 cells) | <!-- EXT-5.7.2-004 --> |
| then | u16 | `view_count`, equal to the PartCell's view count (1 or 2) | **S** (1,697) | <!-- EXT-5.7.2-005 --> |
| then | record[view_count] | LibraryPart records (type 24, §4.17) in the PartCell's view order, `.Normal` then `.Convert` | **S** (1,709 views) | <!-- EXT-5.7.2-006 --> |

The stream order is therefore PartCell, LibraryPart views, then Package with its devices; the Package does not come first. **S** (§12.1)

- The stream name is the package name with the stream-name escapes (`/` as 0x02, `:` as 0x03). **S** (1,373; 56 names contain `/` or `:`) <!-- EXT-5.7.2-007 -->
- Every `source_library` string inside the stream is empty (`00 00 00`), and the prefix `end_offset` values are smaller by the bytes the library name would take. **S** (4,779 records; the shrink rule holds on all 372 type-6 copies) <!-- EXT-5.7.2-008 -->
- Every cell a device names appears exactly once; cell order need not follow device order. **S** (1,697 cells; order differs in 52 packages) <!-- EXT-5.7.2-009 -->
- Each device's `pin_slot_count` equals the pin-slot count of its cell's `.Normal` view. **S** (1,763 devices) <!-- EXT-5.7.2-010 -->
- The 36 v3 `_pDboPackage_Copy_` streams (4 files) use another encoding: their first record has no full prefix at offset 2 (new). **S** (36; 5 more such streams sit in 3 Library 2.0 files)

**Against the Cache.** A package stream often has no Cache record of the same name and type, and the reverse. **O** (1,047 of 1,373 streams lack a same-name Cache package; 61 files have Cache packages with no stream) <!-- EXT-5.7.2-011 --> Where both exist:

- Type 6 (PartCell) copies are byte-identical apart from the empty library and the `end_offset` of boundaries 1 and 2. **S** (372 of 372) Type 31 (Package) copies are identical in 320 of 326; 6 differ in content (for example `opencellular-sdr` `Packages/R_1`: Cache `pcb_footprint` `0402`, stream empty). **S** <!-- EXT-5.7.2-012 -->
- Type 24 copies follow the same library rule: boundaries 1 to 4 shrink by the library length and boundary 5 does not, on 363 of 372 copies; the other 9 differ in content length. **S** <!-- EXT-5.7.2-013 -->
- 369 of 372 type-24 copies differ somewhere. In 364 the pin and display segment differs, mostly at the same length, which fits changed pin opaque words, tail words and display opaque bytes; the differing fields were not attributed one by one. **O** <!-- EXT-5.7.2-014 EXT-5.7.2-015 -->
- Short-prefix property pairs differ only in order in 60 copies (same set); 2 copies differ in the set itself, so EXT's "the set of pairs is the same" holds with exceptions. **S** <!-- EXT-5.7.2-016 -->
- The primitive and bbox segment differs in 36 copies (29 at the same length), which fits CommentText bbox and font high-word changes; not attributed field by field. **O** <!-- EXT-5.7.2-017 -->
- Copies also differ in content: 8 in segment length, 2 in property set, 2 in trailer. **O** <!-- EXT-5.7.2-018 -->

#### `Symbols/<s>` stream

Each `Symbols/<s>` stream is one framed record filling the stream from offset 0 to its end. Only types 35 (OffPageSymbol), 64 (TitleBlockSymbol) and 75 (ErcSymbol) occur; 33 and 76 are listed by EXT and never seen. **S** (82 v3 streams) <!-- EXT-5.7.3-001 --> The body uses the terminal-symbol layout of the Cache; the stream name is the symbol name with the stream-name escapes; `source_library` is empty. **S** (82) <!-- EXT-5.7.3-002 --> Where a Cache table-1 record has the same name and type, the two are equal apart from the library rule above; no bbox difference was seen. **S** (52 pairs) <!-- EXT-5.7.3-003 -->

`Symbols/$Types$` is a run of `[lstr name][u16 type]` pairs with no count, to the end of the stream; it is empty (0 bytes) in 85 files. **S** (147) <!-- EXT-5.7.3-004 --> Its names are unique. **S** (147) <!-- EXT-5.7.3-005 --> Every listed name has a `Symbols/<name>` stream whose first byte equals the type. **S** (86 of 86) <!-- EXT-5.7.3-006 --> A listed name without a stream never occurs.

### 4.17 LibraryPart record (type 24)

A LibraryPart is a schematic symbol view: its name, its primitives, its pin slots (SymbolPinScalar, type 26) and its displays (type 39). The pin names live in the pin records. **S** (2,604 Cache and 1,709 `Packages/<p>` records) <!-- INT-9.3-002 --> The record has 5 full prefixes, a short prefix and a preamble; the innermost boundary is the end of the preamble. **S** (4,313 of 4,313) <!-- INT-9.3-003 -->

| Body part | Type | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- |
| 1 | lstr | `name`: the view name, always `<cell>.Normal` or `<cell>.Convert` | **S** (1,709 Packages views) | <!-- INT-9.3-004 --> |
| 2 | lstr | `source_library` | **S** (4,313) | <!-- INT-9.3-005 --> |
| | | Boundary 4 ends here | **S** (4,313) | <!-- INT-9.3-006 --> |
| 3 | u32 | 48 in every record (EXT: symbol colour) | **S** (4,313) | <!-- INT-9.3-007 --> |
| 4 | u16 | Primitive count | **S** | <!-- INT-9.3-008 --> |
| 5 | var | Primitives, then an 8-byte bbox (x1 ≤ x2, y1 ≤ y2); boundary 3 ends after the bbox | **S** (4,313) | <!-- INT-9.3-009 INT-9.3-020 --> |
| 6 | u16 + slots | Pin count, then type-26 records (99,621) or single `00` placeholder bytes | **S** | <!-- INT-9.3-010 --> |
| 7 | u16 + records | Display count, then type-39 records (9,772) | **S** | <!-- INT-9.3-011 --> |
| | | Boundary 2 ends here | **S** (4,313) | <!-- INT-9.3-012 --> |
| 8 | 4 × lstr | Trailer: contents library, contents view, reference, part value (`10K` and the like) | **S** (4,313) | <!-- INT-9.3-014 INT-9.3-015 --> |
| 9 | u8 | Part flags, low byte: values 0 to 7, 10, 11, 42 to 46, 52, 59 | **S** | <!-- INT-9.3-016 --> |
| 10 | u8 | Always `00` (EXT reads parts 9 and 10 as one `u16`; both readings fit) | **S** (4,313) | <!-- INT-9.3-017 --> |
| | | Boundary 1 (record end) | **S** (4,313) | <!-- INT-9.3-018 --> |

- The trailer (parts 8 to 10) is present in all 4,313 records and is never preceded by a preamble. INT calls it an optional GeneralProperties block; it is never absent. **S** (4,313) <!-- INT-9.3-013 -->
- INT and EXT name the trailer strings differently (`implementation_path`, `implementation`, `ref_des` against `contents_library`, `contents_view`, `reference`); the layout is the same.
- INT reads bits 0 to 2 of part 9 as pin-name visible, pin-name rotate and pin-number visible (inverted: 0 = visible); EXT names bit 2 PinNumbersHidden, consistent with that. The bit meanings are per name only.
- A pin slot holding a single `00` byte occurs in 14 of 4,313 records (2 Cache, 12 Packages). **O** <!-- INT-9.3-021 --> INT, after OpenOrCadParser, reads it as a convert-view pin; not checked.

universal-netlist reads the record as follows. **T** It skips the primitives by reading the count and jumping to boundary 3, which lands correctly because boundary 3 is the end of the primitives and bbox <!-- INT-9.3-019 -->; on a `00` pin slot it consumes the byte and records an empty pin name so later names stay aligned with their pin numbers <!-- INT-9.3-022 -->; it reads the trailer inside a `try` and keeps the LibraryPart if the trailer read fails. <!-- INT-9.3-023 -->

### 4.18 How universal-netlist reads the Library

- It takes the version, the string table and, in a design, the root schematic name; on 130 v3 files its string count, string lengths and root equal the full-layout read. **T** <!-- INT-6-044 -->
- It skips the header, fonts, default slots, the 8 flag bytes, the 8 part fields and the 156-byte block by computing offsets, and reads past the aliases. **T** <!-- INT-6-045 -->
- It always reads `string_count` as `u32`. **T** <!-- INT-6-055 --> It refuses a Library below major 3 before reaching the string table; every fixture it reads is `OrCAD Windows Design` at 3.2 or 3.3, and `gprino-lf` (2.0) is refused. **T** <!-- INT-6-056 --> The `u16` count of 2.0 is therefore never needed.
- It takes the root name only when the read ends exactly at the stream end; otherwise the design names no root. **T** <!-- INT-6-047 -->
- It decodes strings as Windows-1252 (§4.10).

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| The string count is `u32` in every version | EXT §2.1.1 | `u16` in all 16 Library 2.0 files; `u32` in all 130 v3 files | **S** | <!-- EXT-2.1.1-004 --> |
| `version_major` is always 3 | EXT §4.3 | 2 in 16 files (for example `VIDEO.DSN`, `GPR_LF.DSN`, `AVR.OLB`), 1 in `a3640.dsn` | **S** (147) | <!-- EXT-4.3-001 --> |
| `lfWidth` known values are 0 to 12 | EXT §4.5 | 0 to 58 at v3; 13 (37 rows), 14, 15, 16, 19, 22, 23, 29 and 58 occur | **S** (2,717 rows) | <!-- EXT-4.5-006 --> |
| `lfOrientation` is always 0 | EXT §4.5, §16.4.5 | 900 on 7 v3 rows | **S** | <!-- EXT-4.5-008 EXT-16.4.5-003 --> |
| `lfCharSet` takes 0, 1, 2, 129, 134 | EXT §2.3.7, §4.5, §16.4.5 | 0, 1, 238, 255, 177 at v3 and 161 at 2.0; 2, 129, 134 never | **S** | <!-- EXT-2.3.7-005 EXT-4.5-013 EXT-16.4.5-007 --> |
| First default-flag word is always 0 | EXT §4.7 | 1 in one v3 file (1, 1) | **S** | <!-- EXT-4.7-002 --> |
| Second default-flag word is always 1 | EXT §4.7 | 0 in 29 v3 files and 2 v2.0 files | **S** | <!-- EXT-4.7-003 --> |
| Default flags hold 0 and 1 | EXT §16.6.3 | (0, 1) in 100 of 130 v3 files, (0, 0) in 29, (1, 1) in 1 | **S** | <!-- EXT-16.6.3-008 --> |
| The default page settings hold `IsMetric` 0 | EXT §16.7.3 | `IsMetric` 1 in 8 of 130 v3 files | **S** | <!-- EXT-16.7.3-005 --> |
| `OrCAD Windows Library` does not occur in real files | EXT §16.7.1 | 27 real part libraries (for example `LED_SCHLIB.OLB`) start with it | **S** (27) | <!-- EXT-16.7.1-003 --> |
| The directories never list a definition held only in Cache | EXT §5.7.1 | `BEAGLEBONEBLK_C3.DSN` (3 copies) lists 20 of 88 packages that exist only in Cache | **S** | <!-- EXT-5.7.1-011 --> |

### Unverified

- *unverified*: a property value index can point past the end of the string table and is then treated as absent (EXT §4.10). Value indices outside DsnStream belong to the page and property chapters and were not checked here. <!-- EXT-4.10-010 -->
- *unverified*: a default-font mapping with no zero slot (EXT §4.6); every one of 146 files has zero slots 3, 4 and 17 to 23. <!-- EXT-4.6-014 -->
- *unverified*: listed `lfWeight` values 100, 500, 600 and 900 (EXT §4.5, §16.4.5) never occur. <!-- EXT-4.5-009 EXT-16.4.5-004 -->
- *unverified*: `lfFaceName` lengths 3, 4 and 23 to 29, and `Packages/<p>` `cell_count` values 9, 11 and 14 to 31, from EXT's stated ranges, never occur. <!-- EXT-4.5-018 EXT-5.7.2-001 -->
- *unverified*: zero default slot 10 alone occurs only with the empty default block (EXT §4.6); neither the pattern nor the empty block occurs in 147 files. <!-- EXT-4.6-015 -->
- *unverified*: the second default-part-field form is eight empty strings, only with the empty default block (EXT §4.8); eight empty strings never occur in 146 files. <!-- EXT-4.8-003 -->
- *unverified*: default slot 10 serves display-property text, slot 12 net alias (net label) text, slot 13 comment text in page graphics and in symbol bodies other than title blocks, and slot 14 comment text in title-block symbols (type 64) (EXT §16.4.4). The bytes cannot show which slot a text uses; EXT itself gives these per name only. <!-- EXT-16.4.4-003 EXT-16.4.4-005 EXT-16.4.4-006 EXT-16.4.4-007 -->
- *unverified*: names stored inline as `lstr` (schematic, page, net and symbol names) need no string-table entry (EXT §18.3). Schematic and directory names are inline `lstr`; the page and net streams were not compared against the table. <!-- EXT-18.3-052 -->

### Open questions

- Which text categories default slots 0 to 9, 11 and 15 to 23 serve. Data: slots 3, 4 and 17 to 23 are always 0; the others hold 1 or 2. <!-- EXT-16.4.4-002 EXT-16.4.4-004 EXT-16.4.4-008 EXT-16.oq-008 -->
- Whether `lfCharSet` identifies the code page of the strings. Not decidable from the bytes. <!-- EXT-2.3.7-006 EXT-16.4.5-008 -->
- Whether the bytes after a face-name terminator are reproducible or leftover buffer contents. Data: non-zero in 2,561 of 3,010 rows, which fits leftover buffer data. <!-- EXT-4.5-020 EXT-4.oq-006 -->
- What the two default flags control. Data: pairs (0, 1), (0, 0) and (1, 1). <!-- EXT-16.6.3-009 EXT-4.oq-002 -->
- What the default part fields control beyond their names. Data: the eight names are identical in all 146 v2/v3 files, so the common form's bytes are fully known. <!-- EXT-4.8-004 EXT-18.oq-004 -->
- The role of `Packages/<p>` against the Cache. Data: the copies mostly equal the Cache records but diverge independently (§4.16), which fits a design-resident library copy kept apart from the Cache. <!-- EXT-5.7.2-019 EXT-5.7.2-020 EXT-5.oq-009 -->
- The meaning of the LibraryPart `u32` after boundary 4. Data: 48 in all 4,313 records; EXT calls it the symbol colour. <!-- INT-13.3-012 -->
- The 1.1 Library: `a3640.dsn` reads to its end with neither a `u32` nor a `u16` string count (an `lstr` terminator fails at offset 2,788). Its layout after the version is unknown, so no field values are taken from it.

### Parser divergences

None. The parser reads the parts of the Library it uses as the files show them.

Parser coverage: universal-netlist reads the Library version, the string table and the root schematic name, skips the introduction, times, font table, default slots, flags, part fields and page settings by offset, checks only the `OrCAD Windows Design` prefix (a library is recognised by its absence), tolerates a `font_count` of 0, refuses versions below 3, and reads `Packages/<p>` streams (excluding `_pDboPackage_Copy_`) and LibraryPart records with their primitives skipped; it does not read `Symbols/<s>`, `Symbols/$Types$` or the part aliases' content.

Page rendering (`render_page`) additionally reads each font row's `lfHeight` and the default-font slots (`readLibraryFonts`), and draws text at `|lfHeight|` page units.

<!-- meta: EXT-0.4-002 EXT-1.3.3-006 EXT-2.7-003 EXT-2.7-006 EXT-4-003 EXT-4.1-001 EXT-4.10-011 EXT-4.12-012 EXT-4.13-001 EXT-4.2-005 EXT-4.5-021 EXT-4.5-022 EXT-4.5-023 EXT-4.5-024 EXT-4.7-001 EXT-16.4.4-009 INT-6-001 INT-9.3-001 -->

---

## 5. Cache, symbols, packages and parts

A design carries its own copy of every library definition it uses or once used: part views and part cells, packages with their devices, and terminal symbols (power and global, port, off-page, title block, ERC, bookmark). The primary copy is the `Cache` stream; `Packages/<p>` and `Symbols/<s>` hold a second, library-style copy of some definitions. **S** (Cache read to the exact end on 89/89 files; 7,167 bodies decoded to their prefix boundaries). <!-- EXT-5-001 INT-10-001 EXT-0.4-003 -->

- The Cache tables hold part views (type 24: 2,141), part cells (6: 2,112), packages (31: 1,959) and terminal symbols 33 (255), 34 (98), 35 (89), 64 (108), 75 (405). Bookmark symbols (76) never occur. **S** (89 files). <!-- EXT-5.2.1-003 -->
- `Packages/<p>` and `Symbols/<s>` are library-style copies: their `source_library` strings are empty (994 + 72 streams). The `Cells`, `Parts` and `ExportBlocks` storages exist and are always empty. **S** (89/89). <!-- EXT-5-003 -->
- Reading the Cache to its end needs no other stream. It holds Library string indices only in short-prefix pairs and in display `name_index` fields, so the Library string table gives meaning, not framing. **S** (89 files). <!-- EXT-1.3.3-002 -->

### 5.1 Cache stream layout

The Cache is five directory tables back to back, in fixed order, with no stream header, no record count, no checksum and no trailer. **S** (89/89). <!-- EXT-5.2.1-001 EXT-16.5.1-001 EXT-5.2.4-001 --> The earlier pass read the same layout to the exact end in all 106 Cache streams of the 18 fixture and 88 corpus version-3 designs.

| Offset | Table | Contents | Evidence | ids |
| --- | --- | --- | --- | --- |
| +0x00 | 0 | Always empty: `group_count` = 0, so the table is the bytes `00 00`. Reading it as a reserved `u16` that is always 0 is equivalent. | **S** (89/89) | <!-- EXT-5.2.1-002 EXT-5.2.1-009 EXT-5.8-001 EXT-16.5.1-002 INT-10.1-001 --> |
| +0x02 | 1 | Terminal symbols: types 75 (405), 33 (255), 64 (108), 34 (98), 35 (89). | **S** (89 files) | <!-- EXT-16.5.1-003 --> |
| after 1 | 2 | Part views, type 24 only (2,141). | **S** | <!-- EXT-5.2.1-004 EXT-16.5.1-004 --> |
| after 2 | 3 | Part cells, type 6 only (2,112). | **S** | <!-- EXT-5.2.1-005 EXT-16.5.1-005 --> |
| after 3 | 4 | Packages, type 31 only (1,959); ends exactly at the end of the stream. | **S** (89/89) | <!-- EXT-5.2.1-006 EXT-16.5.1-006 --> |

The first `u16` of the stream is 0 in every file; INT reads it as the start of a 4-byte header. Bytes 2-3, which INT calls unknown, are the table-1 `group_count` in 89/89 files, so there is no 4-byte header. **S** (89/89). <!-- INT-10.1-002 -->

Each table has this layout:

| Level | Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| Table +0x00 | `group_count` | `u16` | Number of groups; may be 0. | **S** (89 files) | <!-- EXT-5.2.2-001 --> |
| Table +0x02 | `groups` | group[] | `group_count` groups back to back. | **S** | <!-- EXT-5.2.2-002 --> |
| Group +0x00 | `name` | `lstr` | Definition name; equals the name string inside every variant's body. | **S** (7,167/7,167) | <!-- EXT-5.2.2-004 --> |
| Group | `variant_count` | `u16` | Number of variants; 0 in 21,581 groups across tables 1-4. | **S** | <!-- EXT-5.2.2-005 --> |
| Group | `variants` | variant[] | `variant_count` variants. | **S** | <!-- EXT-5.2.2-006 --> |
| Variant +0x00 | `source_library` | `lstr` | Path of the supplying library; equals the `source_library` string inside the body. | **S** (7,167/7,167) | <!-- EXT-5.2.2-007 --> |
| Variant | `id` | `u32` | Record identifier, never 0 (§5.1.2). | **S** (7,167/7,167) | <!-- EXT-5.2.2-008 --> |
| Variant | `id_copy` | `u32` | Always equal to `id`. | **S** (7,167/7,167) | <!-- EXT-5.2.2-009 EXT-3.9-004 --> |
| Variant | `type` | `u16` | Record type of the body; equals the body's first byte. | **S** (7,167/7,167) | <!-- EXT-5.2.2-010 --> |
| Variant | body | framed record | One record of that type; its length is 9 + the first full prefix's `end_offset`. | **S** (7,167/7,167) | <!-- EXT-5.2.2-011 --> |

- A group is one definition name with one variant per source library that supplied a definition of that name. Source libraries are unique within each group (6,563/6,563 groups with variants); 213 groups have several variants. **S**. <!-- EXT-5.2.2-003 EXT-5.2.2-013 -->
- Group names are unique within a table. **S** (89 files × 4 tables). <!-- EXT-5.2.2-012 -->
- Every table-2 group name ends in `.Normal` or `.Convert`, empty groups included. **S** (9,492/9,492). <!-- EXT-5.2.2-019 -->

#### 5.1.1 Source library strings

- `source_library` is never empty and is an absolute path, drive-letter (`X:\...`) or UNC (`\\...`). **S** (7,167/7,167). <!-- EXT-5.2.2-014 EXT-5.2.2-015 -->
- It can hold bytes ≥ 0x80 (74 variants), read as Latin-1 without breaking the walk. **S**. <!-- EXT-5.2.2-017 -->
- It ends in `.olb` in 5,629 variants, `.dsn` in 1,527, and `.ETC` in 11 (PSpice marker symbols, type 64 from `...\PSPICE\MARKER.ETC`). **S** (7,167). <!-- EXT-16.5.2-004 -->
- Every ERC symbol (75) comes from a `.dsn` path (405/405). Types 24, 6 and 31 come from both `.olb` and `.dsn` paths. **S**. <!-- EXT-5.2.2-018 -->

#### 5.1.2 Record identity (`id`)

- `id` is shared by the records of one object: 7,167 variants carry 2,108 distinct ids, and a homogeneous cell's id equals its package's id in 2,052 cases. **S**. <!-- EXT-5.2.3-001 -->
- Records of the same type also repeat ids (274 ids), so unrelated definitions can share one. **S**. <!-- EXT-5.2.3-002 -->
- `id` never exceeds the Library `modified` time by more than 2 s (7,167/7,167); 5,369 (75%) lie between Library `created` and `modified`. **S**. <!-- EXT-5.2.3-006 -->
- 7,166 of 7,167 ids decode to dates in 2000-2030 as Unix seconds; the exception is 909044342 (1998-10-22) in `BeagleBoard-xM_ORCAD.DSN`. **S**. <!-- EXT-5.2.3-005 -->

#### 5.1.3 Order

- The order of groups within a table follows neither bytewise nor case-insensitive sort: 77/77 table-1, 83/83 table-2 and 82/83 table-3 and table-4 instances with more than two named groups. **S**. <!-- EXT-5.2.4-002 -->
- Zero-variant groups are interleaved with the non-empty ones: they sit between non-empty groups in 173 of 187 tables (28/31 table-1, 53/54 table-2, 46/54 table-3, 46/54 table-4); the rest hold them all before (15) or all after (5) the non-empty groups. Non-empty groups are unsorted in all but one table-3/table-4 instance. **S**. <!-- EXT-5.2.4-003 -->
- Variants within a group are in non-increasing `id` order in 183 of 213 multi-variant groups; 30 are not. **S**. <!-- EXT-5.2.4-005 EXT-5.2.4-004 -->

#### 5.1.4 Groups with zero variants

- A zero-variant group is only `[lstr name][00 00]`, with no body. **S** (walk ends exactly on 89/89). <!-- EXT-5.2.5-002 EXT-5.8-002 -->
- Tables 1-4 all contain them: table 1 in 31 files, tables 2-4 in 54 files. **S**. <!-- EXT-5.2.5-001 --> (The earlier pass counted 28,167 across its 106 streams.)
- They also occur after the last variant of table 4: 20 of 89 streams end with zero-variant table-4 groups, 66 end in a variant, 3 end in table 1 (tables 2-4 empty). **S**. <!-- EXT-5.2.5-003 -->
- Every empty table-2 group's base name (suffix removed) is a table-3 group name (7,411/7,411), and that table-3 group is empty in 7,410. **S**. <!-- EXT-5.2.5-004 -->
- 6,183 of 6,468 empty table-4 groups (95.6%) have an empty table-3 group of the same name and an empty table-2 group `<name>.Normal`. **S**. <!-- EXT-5.2.5-005 -->

#### 5.1.5 Locating records

- Each Cache body is bounded by its first full prefix, so a reader can skip any body without decoding it. **S** (7,167/7,167). <!-- EXT-5.2.7-001 -->
- Group names, counts, library strings and zero-variant groups lie between bodies; table-3 part cells are ordinary variants. **S** (2,112 type-6 bodies). <!-- EXT-5.2.7-002 -->
- A scan for `[u32 a][u32 a][u16 t]` finds every body, part cells included (all 2,112 table-3 variants have `id = id_copy` and type 6). **S**. <!-- EXT-5.2.7-003 -->
- Such a scan cannot recover definition names: the string before an id pair is the variant's `source_library`, and the group name precedes that. Parse the tables, or take the name from the body. **S**. <!-- EXT-5.2.7-004 -->
- The Cache is not indexed by the `Cells` and `Parts` directories: 1,760 of 2,112 Cache table-3 cells have no `Cells Directory` entry. **S**. <!-- EXT-12.2.3-009 -->

### 5.2 Symbol-shaped records: types 24, 33, 34, 35, 64, 75, 76

A part view (24) and the terminal symbols (33 GlobalSymbol, 34 PortSymbol, 35 OffPageSymbol, 64 TitleBlockSymbol, 75 ErcSymbol, 76 BookMarkSymbol) share one body layout; type 24 adds one more full prefix and a trailer. **S** (3,096 Cache + 1,276 `Packages/` + 72 `Symbols/` records; type 76 never occurs). <!-- EXT-5.3-001 -->

#### 5.2.1 Prefix chain

| Type | F | Boundaries, outermost first | Evidence | ids |
| --- | --- | --- | --- | --- |
| 24 | 5 | 1 record end; 2 end of displays; 3 end of bbox; 4 end of `source_library`; 5 end of preamble | **S** (2,141 + 1,276) | <!-- EXT-5.3.1-001 --> |
| 33, 34, 35, 64, 75 | 4 | 1 record end = end of displays; 2 end of bbox; 3 end of `source_library`; 4 end of preamble | **S** (955 Cache + 72 stream records) | <!-- EXT-5.3.1-002 --> |

- The short prefix holds the definition's user properties: parts carry up to 14 pairs, title blocks carry their title-block fields. **O** (not resolved against the string table). <!-- EXT-5.3.1-003 -->
- The preamble is present and empty (`len` = 0) in every symbol record (3,096 Cache, 1,276 `Packages/`, 72 `Symbols/`). **S**. <!-- EXT-5.3.1-010 -->

Short-prefix pair count `n` by type:

| Type | `n` observed | Evidence | ids |
| --- | --- | --- | --- |
| 24 | 0-14 (Cache and `Packages/`), inside EXT's stated 0-52 | **S** | <!-- EXT-5.3.1-004 --> |
| 33 | 0 (230), 2 (16), 1 (8), 4 (1) | **S** (255) | <!-- EXT-5.3.1-005 --> |
| 34 | 0 | **S** (98/98) | <!-- EXT-5.3.1-006 --> |
| 35 | Cache 0 (79), 3 (8), 1 (2); `Symbols/` 2 (1) | **S** | <!-- EXT-5.3.1-007 --> |
| 64 | 7 (81), 3 (6), 2 (5), 10 (5), 12 (4), 8 (4), 9 (4), 11 (1); 13 never | **S** (108) | <!-- EXT-5.3.1-008 --> |
| 75 | 0 | **S** (405 + 65) | <!-- EXT-5.3.1-009 --> |

#### 5.2.2 Body

Offsets start at the end of the preamble.

| Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| `name` | `lstr` | Definition name, never empty; for type 24 it is `<cell>.Normal` or `<cell>.Convert`. | **S** (4,444; 3,417/3,417 type-24 suffixes) | <!-- EXT-5.3.2-002 --> |
| `source_library` | `lstr` | Equals the variant's `source_library`; ends boundary 4 (type 24) or 3 (others). | **S** (7,167) | <!-- EXT-5.3.2-003 --> |
| `color` | `u32` | Symbol colour; 48 in every record. | **S** (4,444/4,444) | <!-- EXT-5.3.2-004 EXT-5.3.2-005 --> |
| `primitive_count` | `u16` | Number of primitive entries. | **S** | <!-- EXT-5.3.2-006 --> |
| `primitives` | entry[] | Primitive list (§5.2.3); 26,429 entries. | **S** | <!-- EXT-5.3.2-007 --> |
| `bbox` | `i16 × 4` | x1, y1, x2, y2; x1 ≤ x2 and y1 ≤ y2 always; ends boundary 3 (type 24) or 2 (others). | **S** (3,096 + 1,276 + 72) | <!-- EXT-5.3.2-008 EXT-5.3.2-009 --> |
| `pin_slot_count` | `u16` | Number of pin slots; that many slots end exactly before the display count. | **S** | <!-- EXT-5.3.2-011 --> |
| `pin_slots` | slot[] | Pin slots (§5.2.4); the slot index is the pin's position. | **E** (12,117/12,132 pstchip pins) | <!-- EXT-5.3.2-012 --> |
| `display_count` | `u16` | Number of display properties. | **S** | <!-- EXT-5.3.2-013 --> |
| `displays` | SymbolDisplayProp[] | 8,987 displays, each ending at +0x0E; the list ends at boundary 2 (type 24) or the record end. | **S** | <!-- EXT-5.3.2-014 --> |
| `part_trailer` | §5.2.6 | Type 24 only; ends the record. | **S** (3,417/3,417) | <!-- EXT-5.3.2-015 --> |

The bounding box contains every pin's start point (24,593/24,594 Cache pins, 51,575/51,585 `Packages/` pins) but usually not its hot point (outside for 23,711/24,141 type-24 pins). The exceptions to the first rule are `.Convert` views with a placeholder bbox `0,0,50,50` (for example `BeagleBoard-xM` `SN65C3221EPW.Convert`, pin `DIN` at (0,110)). Type-24 Line and Rect primitives lie inside it (2,032/2,032). **S**. <!-- EXT-5.3.2-010 EXT-18.oq-001 -->

Counts per type:

| Type | Records | Pin slots | Primitives | Displays | Primitive kinds | Evidence | ids |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | 2,141 Cache | 0-272 | 0-433 (433 in 3 records) | 0-6 and 8; usually 2 (1,470/2,141) | any of 40-48 and 87 | **S** | <!-- EXT-5.3.2-016 EXT-5.3.3-015 --> |
| 33 | 255 | 1 | 2, 3, 4, 7 | 0, 1 | {41} 200, {41,43} 54, {41,46} 1 | **S** | <!-- EXT-5.3.2-017 EXT-5.3.3-016 --> |
| 34 | 98 | 1 | 4, 5, 6 | 1 | {41} | **S** | <!-- EXT-5.3.2-018 EXT-5.3.3-017 --> |
| 35 | 89 | 1 | 4, 5, 6, 7, 8, 22, 26 | 0, 1 | {41} 70, {41,46} 19, plus 1 in `Symbols/` | **S** | <!-- EXT-5.3.2-019 EXT-5.3.3-018 --> |
| 64 | 108 | 0 (97), 1 (11 PSpice markers) | 14-31, also 4, 15, 17, 19, 20 listed as extra | 7, 8, 10, also 0, 5, 12 | {40,46} 81, {40,41,46,47} 11, {41,43,46} 11, {40,46,47} 5 | **S** | <!-- EXT-5.3.3-019 --> |
| 75 | 405 Cache + 65 `Symbols/` | 0 | 1 (one 43: 382 + 62; or one 44: 23 + 3) | 0 | {43} or {44} | **S** | <!-- EXT-5.3.2-021 EXT-5.3.3-020 --> |

- Types 33, 34 and 35 have exactly one pin slot (442 records); page connectors refer to these symbols by name and source library. **S**. <!-- EXT-5.3.8-001 -->
- Type 64 has no pins in 97/108 records; the 11 others are PSpice marker symbols with one pin. Title-block user properties sit in the short prefix, and 16/108 contain a bitmap primitive (47). **S**. <!-- EXT-5.3.8-002 -->
- Type 75 has one primitive, no pins, no displays and `n` = 0 (470 records). **S**. <!-- EXT-5.3.8-003 -->

#### 5.2.3 Primitive list framing

Each primitive entry is a `u8 selector`, always equal to the next byte, followed by one primitive record that starts with its own kind byte. **S** (26,414/26,414 top-level entries). <!-- EXT-5.3.3-002 EXT-5.3.3-003 --> Kinds are 40 Rect, 41 Line, 42 Arc, 43 Ellipse, 44 Polygon, 45 Polyline, 46 CommentText, 47 Bitmap, 48 SymbolVector, 87 Bezier; no other kind occurs. **S**. <!-- EXT-5.3.3-004 --> The fields inside each primitive are chapter 8's; this section gives only the list framing.

Kinds 40-45, 47 and 87 come in two entry forms. Every entry's size is `2 + L + 8 + n`. **S**. <!-- EXT-5.3.3-007 -->

| Form | Layout | Occurs | Evidence | ids |
| --- | --- | --- | --- | --- |
| Long | `[kind][u32 L][u32 0]`, kind fields from entry +0x0A; L counts from the L field to the end of the kind fields; a preamble `FF E4 5C 39 [u32 n][n bytes]` follows. | 17,674 entries; every Library 3.3 record | **S** | <!-- EXT-5.3.3-006 --> |
| Short (new) | L stops 8 bytes before the end of the kind fields; those 8 bytes are field data (style and width, fill and hatch, or last points); no preamble follows. | In Cache symbol records only: 6,073 entries in 1,283 symbol records of Library 3.2 files (§8.3 gives the count over all containers, 11,508) (for example `HB1A-AAFM.DSN` `GND_EARTH` Line, L = 24); the form is chosen per symbol (2 records mix) | **S** | <!-- EXT-5.3.3-005 --> |

- Fixed L values (long form): 40 for kinds 40 (2,229) and 43 (1,419), 32 for kind 41 (12,023), 48 for kind 42 (1,292). The short form is 8 less each (1,228, 557, 3,769, 308 entries). **S**. <!-- EXT-5.3.3-012 -->
- Point-counted kinds (long form): Polygon L = 26 + 4n, Polyline and Bezier L = 18 + 4n; minus 8 in the short form (123 polygons, 86 polylines). **S**. <!-- EXT-5.3.3-013 -->
- The long-form preamble length is 0 in every non-text primitive in the Cache, `Packages/` and `Symbols/`. **S**. <!-- EXT-5.3.3-008 -->
- CommentText (46): entry size `2 + L + 8` for all 2,682 entries. Long form (1,372): the preamble sits inside the record after the text, L = 39 + n + E. Short form (1,310, Library 3.2): no preamble, L = 31 + n. **S**. <!-- EXT-5.3.3-009 EXT-5.3.3-010 -->
- SymbolVector (48) is a framed record; the entry is 1 + the record length, and no preamble follows. **S** (15). <!-- EXT-5.3.3-011 -->
- After the last entry, the 8-byte bbox ends exactly at the bbox boundary in every record once the short form is handled. **S**. <!-- EXT-5.3.3-014 -->

SymbolVector (48) is a named group of primitives. Offsets count from the byte after the entry's selector. **S** (15/15 unless stated). <!-- EXT-5.3.3-022 -->

| Offset | Field | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| +0x00 | 2 full prefixes, type 48 | Boundary 1 record end, boundary 2 end of preamble. | **S** (15/15) | <!-- EXT-5.3.3-023 --> |
| +0x12 | short prefix | Always `30 FF FF` (n = -1). | **S** (15/15) | <!-- EXT-5.3.3-024 --> |
| +0x15 | preamble | Always empty. | **S** (15/15) | <!-- EXT-5.3.3-025 --> |
| +0x1D | `i16 x` | Vector location x. | **S** | <!-- EXT-5.3.3-026 --> |
| +0x1F | `i16 y` | Vector location y. | **S** | <!-- EXT-5.3.3-027 --> |
| +0x21 | `u16 child_count` | 2 in 15/15. | **S** | <!-- EXT-5.3.3-028 --> |
| +0x23 | children | Each `[u16 selector][primitive]`, selector equal to the kind byte; all 30 children are kind 45. | **S** (30) | <!-- EXT-5.3.3-029 EXT-5.3.3-030 --> |
| after children | `lstr name` | Vector name; the record ends here. | **S** (15/15) | <!-- EXT-5.3.3-032 --> |

- The selector is a `u8` in a symbol's primitive list (26,414) and a `u16` inside a vector (30). **S**. <!-- EXT-5.3.3-033 -->
- Vectors occur only in type-24 records (10 Cache, 5 `Packages/`) and are never nested. **S**. <!-- EXT-5.3.3-031 EXT-5.3.3-034 -->

#### 5.2.4 Pin slots

The first byte of each pin slot selects its form. **S** (76,377 slots). <!-- EXT-16.5.3-001 -->

| First byte | Form | Count | Evidence | ids |
| --- | --- | --- | --- | --- |
| 26 | SymbolPinScalar record (§5.2.5) | 76,180 | **S** | <!-- EXT-16.5.3-002 --> |
| 00 | Empty slot: the single byte 00, no record; it still counts as a position. | 197 (15 in Cache, 182 in `Packages/` type-24 views) | **S** (device `pin_slot_count` = view slot count 2,261/2,261) | <!-- EXT-3.8-006 EXT-5.3.4-003 EXT-16.13.2-007 --> |
| 27 | SymbolPinBus, same layout as 26 | never | **S** (76,377) | <!-- EXT-16.5.3-003 INT-9.4-001 --> |
| other | Some other framed record, skipped by its first full prefix and counted as an empty position | never | **S** | <!-- EXT-16.5.3-005 --> |

#### 5.2.5 SymbolPinScalar (26)

Every pin record has F = 2. **S** (76,180 pins). Record preambles of symbols, pins, Packages, Devices and PartCells are empty in every record; display extensions are non-empty in 15 symbol and 4 pin displays (chapter 9); Library 3.2 short-form primitives carry no preamble at all (6,073). **S**. <!-- EXT-5.8-003 --> Offsets marked ′ start at the end of the preamble.

| Offset | Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | full prefix | 9 bytes | Boundary 1 = record end. | **S** (76,180) | <!-- EXT-5.3.5-001 INT-9.4-010 --> |
| +0x09 | full prefix | 9 bytes | Boundary 2 = end of preamble. | **S** (76,180) | <!-- EXT-5.3.5-002 --> |
| +0x12 | short prefix | 3 + 8n | Pin user properties; n = 0 (63,481), 1 (12,189), 4 (342), 2 (102), 6 (41), 5 (19), 7 (6). | **S** | <!-- EXT-5.3.5-003 EXT-5.3.5-004 --> |
| | preamble | 8 bytes | Always empty. | **S** (76,180) | <!-- EXT-5.3.5-005 --> |
| +0x00′ | `name` | `lstr` | Logical pin name, never empty; matches pstchip pin names. | **E** (12,117/12,132 pins) | <!-- EXT-5.3.5-006 INT-9.4-002 --> |
| | `start_x`, `start_y` | `i32 × 2` | Inner end of the pin line. | **S** (76,180) | <!-- EXT-5.3.5-007 EXT-5.3.5-008 INT-9.4-003 --> |
| | `hotpt_x`, `hotpt_y` | `i32 × 2` | Connection point (hot point). | **S** (76,180) | <!-- EXT-5.3.5-009 EXT-5.3.5-010 INT-9.4-004 --> |
| | `shape` | `u16` | Shape and visibility bits (below). | **E** (bits 5, 7) | <!-- EXT-5.3.5-011 EXT-16.5.4-001 --> |
| | `opaque_word` | `u16` | Meaning unknown. | **S** (76,180) | <!-- EXT-5.3.5-012 INT-9.4-006 --> |
| | `pin_type` | `u32` | Electrical type (below). | **E** (7,871 pins) | <!-- EXT-5.3.5-014 EXT-16.5.5-001 --> |
| | `tail_tag` | `u8` | Always 26, the record's type byte. | **S** (76,180/76,180) | <!-- EXT-5.3.5-015 --> |
| | `tail_opaque` | 3 bytes | Meaning unknown. | **S** (76,180) | <!-- EXT-5.3.5-016 INT-9.4-008 --> |
| | `display_count` | `u16` | 0, 1 or 2. | **S** (76,180) | <!-- EXT-5.3.5-018 EXT-5.3.5-019 INT-9.4-009 --> |
| | `displays` | SymbolDisplayProp[] | 967 pin displays; the record ends after them. | **S** (76,180) | <!-- EXT-5.3.5-020 --> |

- The line from pin start to hot point is always horizontal or vertical (24,594 Cache + 51,585 `Packages/` + 1 `Symbols/` pins). **S**. <!-- EXT-5.3.5-023 -->
- The pin line length does not determine shape bit 0: lengths 10 and 30 occur with it set and clear. With bit 0 set, lengths are 30, 10, 0, 20; with it clear, 10, 30, 20, 0. **S**. <!-- EXT-5.3.5-024 EXT-5.3.5-025 EXT-5.3.5-026 -->
- `opaque_word` in Cache type-24 pins is zero (11,440), two printable ASCII bytes (2,977) or other (9,724), and differs between the Cache and `Packages/` copies of one definition in 238 or more type-24 pairs. **S**. <!-- EXT-5.3.5-013 EXT-5.8-004 -->
- `tail_opaque` also differs between copies. It is zero exactly when `opaque_word` is zero in 68% of Cache type-24 pins only: both zero 8,676, both non-zero 7,820, word non-zero and tail zero 4,881, word zero and tail non-zero 2,764. **S**. <!-- EXT-5.3.5-017 EXT-5.8-005 -->
- Display bytes alone differ between copies in 2 type-24 pairs; the display opaque byte was not isolated. **O**. <!-- EXT-5.8-006 -->

Pin `shape` bits:

| Bit | Mask | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| 0-4, 6 | | See Unverified (EXT names: IsLong, IsClock, IsDot, IsLeftPointing, IsRightPointing, IsNetStyle). Bits 0, 1, 2 are set on type-24 pins, 3 and 4 on type-34 pins, bit 6 never. | **O** | |
| 5 | 0x0020 | Visible. Clear on 92/92 hidden pstchip `POWER_PINS`; set on 8,036/8,037 listed pins. | **E** | <!-- EXT-5.3.5-032 EXT-16.5.4-007 --> |
| 7 | 0x0080 | Global. Set on hidden global power pins (92/92); never on listed pins (8,036/8,037). | **E** | <!-- EXT-5.3.5-034 EXT-16.5.4-009 --> |
| 8 | 0x0100 | Never set (EXT: IsNoConnect). | **S** (76,180) | <!-- EXT-5.3.5-035 EXT-16.5.4-010 --> |
| 9 | 0x0200 | Never set (EXT: NumberHidden). | **S** (76,180) | <!-- EXT-5.3.5-036 EXT-16.5.4-011 --> |
| 10 | 0x0400 | Set on 19 type-24 pins (for example `nixie.dsn` `555B.Normal` pins `GND`, `TRIGGER`, shape 0x421). Meaning unknown. | **S** | |

Shape bits 5 and 7 and `pin_type` by symbol type:

| Type | Bit 7 | Bit 5 | `pin_type` | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| 24 | Set with bit 5 clear on hidden power pins: 106 Cache (for example `nixie.dsn` `AND2.Normal` `GND`, shape 0x81, type 7) and 73 `Packages/` pins | Set on all others | 4, 7, 1, 0, 2, 5, 3 (never 6) | **S** | <!-- EXT-16.5.5-011 --> |
| 33 | Set 253/255 | Clear 253/255 | 7 in 254/255 (one 2) | **S** (255) | <!-- EXT-5.3.5-039 EXT-16.5.4-014 --> |
| 34 | Clear | Set | 0, 1, 2, 4 | **S** (98/98) | <!-- EXT-5.3.5-040 EXT-16.5.4-015 --> |
| 35 | Set 78/89 | Clear 89/89 | 0, 4 (89/89) | **S** (89) | <!-- EXT-5.3.5-041 --> |

A pin is global when shape bit 7 is set: hidden global power pins carry bit 7 and `pin_type` 7 together (92). `pin_type` 7 alone does not make a pin global: 15,707 type-24 pins (4,701 Cache + 11,006 `Packages/`) with `pin_type` 7 and bit 7 clear are visible, ordinary power pins. **E**. <!-- EXT-5.3.5-042 EXT-16.5.4-016 -->

`pin_type` values, each matched one-to-one against pstchip pin attributes over 7,871 compared pins with 0 exceptions. Port types use the same values (chapter 6). **E**. <!-- INT-9.4-007 -->

| Value | Meaning | pstchip match | Evidence | ids |
| --- | --- | --- | --- | --- |
| 0 | Input | `INPUT_LOAD` only (509) | **E** | <!-- EXT-5.3.5-043 EXT-16.5.5-002 --> |
| 1 | Bidirectional | `BIDIRECTIONAL=TRUE` (972) | **E** | <!-- EXT-5.3.5-044 EXT-16.5.5-003 --> |
| 2 | Output | `OUTPUT_LOAD` only (151) | **E** | <!-- EXT-5.3.5-045 EXT-16.5.5-004 --> |
| 3 | Open collector | `OUTPUT_TYPE=(OC,AND)` (15) | **E** | <!-- EXT-5.3.5-046 EXT-16.5.5-005 --> |
| 4 | Passive | `PINUSE=UNSPEC` (5,467) | **E** | <!-- EXT-5.3.5-047 EXT-16.5.5-006 --> |
| 5 | Three-state | `OUTPUT_TYPE=(TS,TS)` (83) | **E** | <!-- EXT-5.3.5-048 EXT-16.5.5-007 --> |
| 6 | Open emitter (EXT, INT); never occurs | | **S** (76,180) | <!-- EXT-16.5.5-008 --> |
| 7 | Power | `PINUSE=POWER` (674) | **E** | <!-- EXT-5.3.5-050 EXT-16.5.5-009 --> |
| ≥ 8 | Never occurs | | **S** (76,180) | <!-- EXT-5.3.5-051 EXT-16.5.5-010 --> |

#### 5.2.6 Part trailer (type 24 only)

The trailer starts at boundary 2, after the display list, and ends the record. No preamble is stored at its start. **S** (3,417/3,417). <!-- EXT-5.3.7-001 EXT-5.3.7-007 -->

| Field | Type | Meaning | Observed (Cache; `Packages/`) | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| `contents_library` | `lstr` | Implementation library | empty 2,137/2,141; 1,275/1,276 | **S** | <!-- EXT-5.3.7-002 --> |
| `contents_view` | `lstr` | Implementation view or cell name | empty 2,083/2,141; 1,266/1,276 | **S** | <!-- EXT-5.3.7-003 --> |
| `reference` | `lstr` | Default reference-designator prefix | non-empty 2,131/2,141; 1,275/1,276 | **S** | <!-- EXT-5.3.7-004 --> |
| `value` | `lstr` | Default part value | empty 1,427/2,141; 848/1,276 | **S** | <!-- EXT-5.3.7-005 --> |
| `part_flags` | `u16` | Bit field; the record ends here | | **S** (3,417/3,417) | <!-- EXT-5.3.7-006 EXT-9.8-001 EXT-16.5.6-001 --> |

- `part_flags` bits 0-2 take every value 0-7 except 5 (`part_flags & 7`: 3, 6, 2, 4, 0, 7, 1; 4 in 162 records). **S**. <!-- EXT-9.8-007 --> EXT names them IsPinNamesVisible, IsPinNamesRotated and PinNumbersHidden (see Unverified).
- Bits 3-15 hold a small number, `part_flags >> 3` (EXT: ContentsViewType): 0 (2,058 Cache + 1,265 `Packages/`), 5 (65 + 7), 1 (16 + 4), 7 (1), 6 (1). Its meaning is unknown. **S**. <!-- EXT-5.3.7-012 EXT-5.3.7-013 EXT-5.8-009 EXT-9.8-005 EXT-16.5.6-005 EXT-16.5.7-001 -->
- Whole `part_flags` words observed in the Cache: 3, 6, 2, 4, 44, 0, 43, 11, 46, 7, 42, 10, 59, 52, 1 (4 in 134 records, 44 in 27, 46 in 13). **S**.

### 5.3 Package (31)

A Package is one part's physical package and its sections. **S** (2,953 records: 1,959 Cache + 994 `Packages/`). <!-- INT-9.1-001 -->

| Offset | Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | full prefix, type 31 | 9 bytes | Boundary 1 = record end. | **S** (2,953) | <!-- EXT-5.4.1-001 INT-9.1-009 --> |
| +0x09 | full prefix | 9 bytes | Boundary 2 = end of `source_library`. | **S** (2,953/2,953) | <!-- EXT-5.4.1-002 INT-9.1-004 --> |
| +0x12 | full prefix | 9 bytes | Boundary 3 = end of preamble. | **S** (2,953/2,953) | <!-- EXT-5.4.1-003 --> |
| +0x1B | short prefix | 3 bytes | Always `1F 00 00` (n = 0). | **S** (2,953/2,953) | <!-- EXT-5.4.1-004 --> |
| +0x1E | preamble | 8 bytes | Always empty. | **S** (2,953/2,953) | <!-- EXT-5.4.1-005 --> |
| +0x26 | `name` | `lstr` | Package name, never empty. | **S** (2,953) | <!-- EXT-5.4.1-006 INT-9.1-002 --> |
| | `source_library` | `lstr` | Equals the variant library in the Cache; empty in `Packages/` (994). | **S** | <!-- EXT-5.4.1-007 INT-9.1-003 --> |
| | `refdes_prefix` | `lstr` | Reference-designator prefix (`U`, `R`); non-empty in 2,946/2,953, empty in 6 Cache and 1 `Packages/` packages. | **S** | <!-- INT-9.1-005 --> |
| | `pcb_library` | `lstr` | Always empty (INT: unknown string). | **S** (2,953/2,953) | <!-- EXT-5.4.1-009 EXT-5.6.5-004 EXT-5.8-010 INT-9.1-006 --> |
| | `pcb_footprint` | `lstr` | PCB footprint name; empty in 1,225/1,959 Cache (63%) and 659/994 `Packages/`; non-empty in 734 Cache packages. | **S** | <!-- EXT-5.4.1-010 EXT-5.6.5-002 INT-9.1-007 --> |
| | `device_count` | `u16` | Number of devices (sections); 1-13 observed. | **S** (2,953) | <!-- EXT-5.4.1-011 EXT-5.4.1-012 INT-9.1-008 --> |
| | `devices` | Device[] | `device_count` Device records; the record ends here. | **S** (2,953/2,953) | <!-- EXT-5.4.1-013 --> |

The framing matches the Package regions rule: R3 holds the short prefix and empty preamble, R2 ends after `source_library`, R1 ends after the devices at the record end. **S** (1,959 Cache + 994 `Packages/`, 0 exceptions). <!-- EXT-3.2.4-005 -->

### 5.4 Device (32)

One Device is one physical section of the package and holds that section's physical pin map. **E** (per-device pin maps reproduce pstchip `PIN_NUMBER` lists section by section, for example `(1,7)`). <!-- EXT-5.4.2-001 INT-9.2-001 -->

| Offset | Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | full prefix, type 32 | 9 bytes | Boundary 1 = record end. | **S** (3,590) | <!-- EXT-5.4.2-002 INT-9.2-002 INT-9.2-009 --> |
| +0x09 | full prefix | 9 bytes | Boundary 2 = end of preamble. | **S** (3,590/3,590) | <!-- EXT-5.4.2-003 --> |
| +0x12 | short prefix | 3 bytes | Always `20 FF FF` (n = -1). | **S** (3,590/3,590) | <!-- EXT-5.4.2-004 --> |
| +0x15 | preamble | 8 bytes | Always empty. | **S** (3,590/3,590) | <!-- EXT-5.4.2-006 --> |
| +0x1D | `unit_ref` | `lstr` | Section suffix (§5.6.3). | **S** | <!-- EXT-5.4.2-007 EXT-16.5.9-001 --> |
| | `cell` | `lstr` | Name of the part cell this device draws with; resolves to a same-library Cache PartCell for 2,261/2,261 devices and equals the package's refdes prefix in only 93. | **S** | <!-- EXT-5.4.2-008 --> |
| | `pin_slot_count` | `u16` | Number of physical-pin slots; equals the slot count of the cell's `.Normal` view (2,261/2,261 Cache, 1,329/1,329 `Packages/`) and `.Convert` view (31/31). | **S** | <!-- EXT-5.4.2-009 INT-9.2-005 --> |
| | `pin_numbers` | slot[] | Physical-pin slots; the record ends here. | **S** (3,590/3,590) | <!-- EXT-5.4.2-010 --> |

Each physical-pin slot is `lstr number` + `u8 flag`. **S** (77,669 slots: 25,450 Cache + 52,219 `Packages/`). <!-- EXT-16.5.8-001 -->

- `number` is the physical pin designator (`1`, `A5`, `GND`); the numbers match pstchip **E** (12,117/12,132 pins). It is empty in 134 slots (20 Cache, 114 `Packages/`). **S**. <!-- INT-9.2-007 EXT-16.5.8-002 -->
- Slot i holds the physical pin of position i, the pin in slot i of the cell's views; slot index 0 is logical pin 1. **E** (12,117/12,132 pstchip pins). <!-- EXT-5.4.2-013 EXT-5.6.2-002 INT-9.2-010 -->
- The `FF FF` empty-slot form never occurs in 77,669 slots. **S**. <!-- EXT-16.5.8-003 -->
- The `flag` byte is §5.8.

### 5.5 PartCell (6)

A part cell names a symbol cell and lists its views. **S** (3,378 records: 2,112 Cache, 1,266 `Packages/`). <!-- EXT-5.5-001 -->

| Offset | Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | full prefix, type 6 | 9 bytes | Boundary 1 = record end. | **S** (3,378) | <!-- EXT-5.5-002 --> |
| +0x09 | full prefix | 9 bytes | Boundary 2 = end of `source_library`. | **S** (3,378) | <!-- EXT-5.5-003 --> |
| +0x12 | full prefix | 9 bytes | Boundary 3 = end of preamble. | **S** (3,378) | <!-- EXT-5.5-004 --> |
| +0x1B | short prefix | 3 bytes | Exactly `06 FF FF` (n = -1). | **S** (3,378/3,378) | <!-- EXT-5.5-005 --> |
| +0x1E | preamble | 8 bytes | Exactly `FF E4 5C 39 00 00 00 00`. | **S** (3,378/3,378) | <!-- EXT-5.5-006 --> |
| +0x26 | `name` | `lstr` | Cell name. | **S** (3,378) | <!-- EXT-5.5-007 --> |
| | `source_library` | `lstr` | Equals the variant library in the Cache; empty in `Packages/`. | **S** | <!-- EXT-5.5-008 --> |
| | `view_count` | `u16` | 1 (3,346) or 2 (32). | **S** | <!-- EXT-5.5-009 --> |
| | `view[0]` | `lstr` | Exactly `name + ".Normal"`. | **S** (3,378/3,378) | <!-- EXT-5.5-010 EXT-16.5.2-001 --> |
| | `view[1]` | `lstr` | Present when `view_count` = 2; exactly `name + ".Convert"`. The record ends here. | **S** (32/32) | <!-- EXT-5.5-011 EXT-16.5.2-002 --> |

### 5.6 Links between packages, cells, views and placements

All joins compare the name and the source-library string byte for byte; the same name from two libraries is two definitions. **S** (joins resolve 2,261/2,261 device cells and views; 213 groups have several libraries). <!-- EXT-5.6.1-001 -->

```
Package (31).device[i].cell ──> PartCell (6), same library
PartCell.view[0] ──> LibraryPart (24) "<cell>.Normal"
PartCell.view[1] ──> LibraryPart (24) "<cell>.Convert" (optional)
```

- Every device's cell has a same-library PartCell and a same-library `<cell>.Normal` view (2,261/2,261). **S**. <!-- EXT-5.6.1-002 EXT-5.6.1-005 INT-12.2-010 -->
- Each of the 32 cells with a `view[1]` has its `.Convert` type-24 record. **S**. <!-- EXT-5.6.1-003 -->
- Every Cache part cell is used by exactly one package (2,112/2,112). **S**. <!-- EXT-5.6.1-006 -->
- Every view a cell lists exists as a type-24 record of the cell's library (2,134/2,134). Seven type-24 `.Convert` records belong to no cell's view list (their cell has `view_count` 1), for example `reComputer J401_V1.0.DSN` `CC.Convert`, `R.Convert`. **S**. <!-- EXT-5.6.1-007 EXT-16.5.2-002 -->
- A homogeneous package (all devices on one cell) names that cell after itself in 1,907 of 1,911 cases; the 4 exceptions include `OC_CONNECT1_SDR_REV_C_V1P1.DSN` `NPN#1` with cell `NPN__sym_7`. **S**. <!-- EXT-5.6.1-008 EXT-18.10.2-005 -->
- A heterogeneous package (two or more cells) has one distinct cell per device, none named after the package (48/48). **S**. <!-- EXT-5.6.1-009 -->
- Devices that share a cell are adjacent in the device list (1,959/1,959). **S**. <!-- EXT-5.6.1-010 -->
- No field stores whether a package is homogeneous or how its sections are numbered: every byte of the Package and Device records is accounted for by the fields above. Both follow from the device cells and `unit_ref` values. **S**. <!-- EXT-5.6.1-011 -->
- On the Cache side, the view, cell and package names a placement would use match byte for byte (2,261 joins); the placement side is in Unverified. **S**.

#### 5.6.1 Pin positions and physical pin numbers

- A view's pin-slot index is the pin's position. Empty slots keep their position, so later positions do not shift; the pstchip check uses this, empty slots included. **E** (12,117/12,132 pins). <!-- EXT-5.6.2-001 -->
- Dropping an empty entry would shift every later pin by one, so index `pinIndex - 1` would stop meaning logical pin `pinIndex`. **S** (follows from the rule above and the **E** pin map check). <!-- INT-9.2-014 -->
- `pin_slot_count` is equal for the device, its cell's `.Normal` view and its `.Convert` view (2,261/2,261 and 31/31). **S**. <!-- EXT-5.6.2-003 -->

#### 5.6.2 Normal and Convert views

- A cell has a `.Normal` view and optionally a `.Convert` view. The 32 `.Convert` views are complete type-24 records with their own primitives, pins and trailer. **S**. <!-- EXT-5.6.4-001 -->

#### 5.6.3 Multi-section parts

- `device_count` is the number of sections, and `unit_ref` names each one; pstchip's section-ordered `PIN_NUMBER` lists match. **E**. <!-- EXT-5.6.3-001 -->
- A package with one device has an empty `unit_ref` (1,854/1,854). **S**. <!-- EXT-5.6.3-002 EXT-16.5.9-002 INT-9.2-003 -->
- A package with several devices uses `A, B, C, ...` or `-1, -2, -3, ...` in device order (105/105; letters in 99, dashes in 6). **S**. <!-- EXT-5.6.3-003 EXT-16.5.9-003 -->
- Homogeneous multi-section packages have 2 (28), 4 (13), 6 (15) or 8 (1) devices. **S**.

#### 5.6.4 `id` relations

- A part cell's `id` equals its package's: homogeneous cells 2,052 equal, 8 differ; heterogeneous cells 186 equal, 15 differ. **S**. <!-- EXT-5.6.4-002 -->
- A `.Normal` view's `id` equals its cell's (2,110) or is lower by 1-12 (2); it is never higher. **S**. <!-- EXT-5.6.4-003 -->
- A `.Convert` view's `id` equals its cell's in 26 of 28 cases. **S**.
- Combined: `id` is never 0 and repeats in `id_copy` (7,167); cell id = package id in 2,052/2,060 homogeneous cases; `.Normal` id = cell id or lower in 2,112/2,112. **S**. <!-- EXT-18.10.2-017 -->

### 5.7 `Packages/<p>`, `Symbols/<s>` and the library storages

#### 5.7.1 `Packages/<p>`

Each framed `Packages/<p>` stream holds exactly one component type. **S** (994/994). <!-- INT-9-001 -->

| Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| `cell_count` | `u16` | Number of part cells, 1-13 observed; the stream starts with it, not with a record. | **S** (994/994) | <!-- INT-9-002 EXT-3.10-057 --> |
| per cell: PartCell | type 6 | One PartCell record. | **S** (1,266) | <!-- INT-9-003 --> |
| per cell: `view_count` | `u16` | 1-2 observed. | **S** | |
| per cell: views | type 24 × `view_count` | LibraryPart records (1,276). | **S** (994/994) | <!-- INT-9-004 --> |
| Package | type 31 | One Package record, after the last cell; the stream ends exactly after it. | **S** (994/994) | <!-- INT-9-005 EXT-3.7-012 --> |

- Design-file `Packages/<p>` streams use exactly the part-library `Packages` layout, decoding to the exact end. **S** (994/994). <!-- EXT-4.14-006 -->
- The part-library form (EXT: `cell_count` 1-1,024, `view_count` 1-32) holds for design files with `cell_count` 1-13 and `view_count` 1-2; part-library `.olb` files were not checked. **S** (994/994). <!-- EXT-4.14-004 -->
- The overall stream layout holds for all framed streams. **S** (994/994). <!-- EXT-1.2.4-003 -->
- `Packages/*_pDboPackage_Copy_NNNN` streams (19 in the 3 distinct Library-3 files: 17 in BeagleBoard-xM, 1 each in two parallella files; 36 in 4 files when both BeagleBoard-xM copies count, as §1 reports) use a different, unframed layout with no prefixes or preambles; it is not decoded. They have no `Packages Directory` entry. **S** (new). <!-- EXT-1.2.4-003 -->
- A design need not ship `Packages/` streams at all: 34 of 89 files have no framed `Packages/` stream, and the stream count bears no fixed relation to the `Packages Directory` count (copies excluded). **S**. <!-- INT-10.4-002 -->

Framed `Packages/` streams against `Packages Directory` entries on the fixtures. **S**.

| Design | Streams | Directory entries | ids |
| --- | --- | --- | --- |
| BeagleBoard-xM | 161 | 161 | <!-- INT-10.4-003 --> |
| BB-Black (two copies) | 0 | 88 | <!-- INT-10.4-004 INT-10.4-005 --> |
| CutiePi | 67 | 67 | <!-- INT-10.4-006 --> |
| CC13xx | 5 | 5 | <!-- INT-10.4-007 --> |
| LAUNCHXL-CC1310 | 14 | 16 | <!-- INT-10.4-008 --> |
| reComputer J201, J202, J401 | 11 each | 99 each | <!-- INT-10.4-009 --> |
| reServer J401 | 11 | 99 | <!-- INT-10.4-010 --> |
| reServer J2032 | 29 | 29 | <!-- INT-10.4-011 --> |

Both BB-Black copies take every pin map from the Cache. The four Jetson carriers have 11 streams for 99 directory packages and 56-87 Cache packages, so most of their pin maps come from the Cache. **S**. <!-- INT-10.4-012 -->

#### 5.7.2 `Packages/` copies against the Cache

The `Packages/` stream and the Cache can hold different definitions of the same component, with different pin counts: 4 Package copies differ (for example `BeagleBoard-xM` `QUARTZ-32KHz-CM200S_0`) and 276 are identical. **S**. <!-- INT-9.2-015 --> After the Cache copy's `source_library` is emptied, PartCells are byte-identical (325/325) and LibraryParts rarely are (3/325); most LibraryPart differences are pin `opaque_word` and `tail_opaque` (238 pairs differ only there). **S** (new).

#### 5.7.3 `Symbols/<s>` and `Symbols/$Types$`

- Each `Symbols/<s>` stream is one record filling the stream; its first byte is its type and equals its `$Types$` entry: 75 (65), 64 (6), 35 (1). R1 stop is the stream end. **S** (72/72). <!-- EXT-1.2.4-002 EXT-3.7-007 -->
- No `Symbols/<s>` stream is empty or holds a list; the `[lstr name][u16 type]` list form occurs only in `Symbols/$Types$`. **S** (72/72). <!-- EXT-3.10-058 -->
- Each `Symbols/<s>` record has an empty `source_library` and is byte-identical to its Cache table-1 copy after that copy's library is emptied (43/43 compared). **S** (new).
- `Symbols/$Types$` (named with dollar signs) holds `[lstr name][u16 type]` pairs to the end of the stream, one per `Symbols/<s>` stream with matching type. **S** (89/89 files, 72/72 streams). <!-- EXT-1.2.4-001 -->

### 5.8 Device pin flag: pin group and Pin Ignore

The `u8 flag` after each physical pin number (Capture's `bitMapPinGrpCfg`) holds the pin group in bits 0-6. **E**. <!-- INT-12.1-012 INT-9.2-008 -->

| Bits | Mask | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| 0-6 | 0x7F | Pin group (swap group); 0x7F = no group. pstchip `PIN_GROUP='1'` ↔ 0x01 (164 pins); no `PIN_GROUP` ↔ 0x7F (7,861 pins). | **E** | <!-- EXT-5.8-008 --> |
| 7 | 0x80 | Set only in the value 0xFF (44 slots). In a multi-section part the slot is not a pad of that section (pstchip writes 0, pstxnet omits it); in a single-section part the pin is a real pad that the export connects to a sibling pin's net. See Unresolved conflicts. | **E** | |

Values observed: 0x7F (77,551), 0x01 (74), 0xFF (44). **S** (77,669 slots). <!-- EXT-5.4.2-014 EXT-16.5.8-004 -->

### 5.9 Choosing a device pin map

When `Packages/<p>` and the Cache both provide a component, the `Packages/` map takes priority and the Cache is the fallback for components without a dedicated stream. **T** (tests "falls back to the Cache map when the Packages/ lookup misses entirely", "maps the pin index through the Packages/ pin map"). <!-- INT-10.4-001 -->

A `Packages/` map can describe the physical package, whose pad count differs from the symbol's pin count: a 4-pad crystal with 2 schematic pins (`XTAL-CM200S`) has `Packages/` map `1, 3, 2, 4` and Cache map `1, 2`. It can also be shorter than the pin list and transposed: `CON_HDMI_RA` (23 pins) has a 20-entry `Packages/` map with entries 17 and 18 swapped, while the Cache map has 23 entries in order. **E** (earlier pass).

Rule: a placed pin's physical number is `map[ordinal − 1]`. Use the map whose length equals the instance's pin count. When the `Packages/` length differs and the Cache length matches, use the Cache. When neither matches, use the Cache only if `Packages/` is longer. When the chosen map has no entry or an empty slot at the position, try the other map. Only then use the ordinal itself. **E** (earlier pass) and **T** (tests "pin map selection by symbol pin count"). <!-- INT-10.4-013 -->

- A null (empty) entry in a map counts as "no entry here", and the other stream's map is tried. **T** (test "falls back to the Cache map when the Packages/ map has a null at the index"). <!-- INT-9.2-013 -->

### 5.10 Repeated reference designators

**T** (`src/parsers/cadence/dsn/duplicate-refdes.test.ts` and `duplicate-refdes.table.test.ts`, 44 tests passing on rerun, among them "keeps the units of a multi-unit part together", "separates a part with the same package but a different part number", "folds a repeated section with no conflicting pin back into its part"; golden `OC_CONNECT1_SDR_REV_C_REUSED_REFDES`). These rules carry no claim id of this chapter; the multi-unit merge is INT-12.5-001 in chapter 11.

- Each section of a part is its own placed instance with the shared reference; instances that are sections of one part are merged.
- An instance joins an existing part of its reference only when its source package matches (case-insensitively, after removing a trailing `_<digits>`), neither part-number property conflicts (both set and different), and it draws a section that part does not have yet. Otherwise it is another part, kept with its own metadata and pins.
- An instance that draws a section its part already has is kept apart until connectivity is built, then folded back when no pin of the two lies on two different nets.

### 5.11 How the parser reads the Cache

This section records the parser's reading strategy (INT §10), checked by replaying it; the layout above is the format.

- The parser walks the Cache sequentially from offset 4 (after what it treats as a 4-byte header) to the end, or until the walk throws and a scanner takes over. On the 89-file replay, 55 files reach the end, 7 stop in the sub-loop at the end, 27 hand over to the scanner. **O**. <!-- INT-10-002 --> (parser code, `cache-parser.ts:225-320`) <!-- INT-10.3-001 -->
- Per entry it probes for one of three "metadata variants" and runs a sub-loop on a `u16 someVal`. In the table model, `someVal` is a `variant_count`: 0 is a zero-variant group in any of tables 1-4 (the next string is the next group name, a symbol, view, cell or package name), and any non-zero count (1-3 mostly, up to 50 observed) means that many variants follow, each starting with its source library. **S** (parser code, `cache-parser.ts:262-290`). <!-- INT-10.2-008 INT-10.2-009 -->
- It then peeks 8 bytes as twin ids (`cache-parser.ts:258-262`), reads them as `id` and `id_copy` (equal in 7,167/7,167), the `u16` structure type (= body first byte, 7,167/7,167) and the framed body. **S**. <!-- INT-10.2-007 INT-10.2-010 INT-10.2-011 INT-10.2-012 -->
- It decodes only Package (31, for pin maps) and LibraryPart (24, for pin names); every other type is skipped by its prefix chain. (parser code, `cache-parser.ts:300-307`) <!-- INT-10.2-022 INT-10.3-003 INT-10.3-004 -->
- A Cache of 10 bytes or fewer is treated as empty; no corpus Cache is that small (smallest 1,314 bytes). (parser code, `cache-parser.ts:228`) <!-- INT-10.1-003 -->
- When the walk throws, a scanner finds each preamble magic `FF E4 5C 39` and works back to the record start (`cache-parser.ts:143-198`). It tries pair counts 0-64, checking that the byte at `magic − 3 − 8 × pairs` is 0x1F or 0x18 and the following `i16` equals the count (`:159-166`). It then steps back in 9-byte strides over up to 10 full prefixes of the same type byte and parses from there (`:170-188`), letting the prefix reader reject wrong candidates (`:184-186`). (parser code) <!-- INT-10.3-002 INT-10.3-007 INT-10.3-008 INT-10.3-009 INT-12.2-020 -->
- The scanner's bounds are wide enough: the largest LibraryPart short-prefix `n` is 14 (< 64), and F is 5 for type 24 and 3 for type 31 (≤ 10). **S**. <!-- INT-13.4-015 -->
- A short prefix is `type + i16 n + 8n bytes`, preceded by F full prefixes of 9 bytes. **S** (every record). <!-- INT-10.3-005 INT-12.2-012 --> It sits exactly 3 bytes before the preamble magic when n = 0: all 2,953 Packages and 883 of 2,141 Cache LibraryParts (41%). Every such record also has 3 or 5 full prefixes. **S**. <!-- INT-10.3-006 --> A fixed 3-byte assumption therefore finds every Package and a minority of LibraryParts overall, though a majority in some files (`BeagleBoard-xM` 49/85, `HB1A` 31/42, `MULTIO` 17/17). **S**. <!-- INT-10.3-010 INT-12.2-013 -->
- Survey of LibraryParts with n = 0: CutiePi 17 of 57; BeagleBoard-xM 49 of 85; LAUNCHXL-CC1310 13 of 47 (INT counted 45 LibraryParts); reComputer J201 1 of 95 (INT counted 96). **S**. <!-- INT-12.2-014 INT-12.2-015 INT-12.2-016 INT-12.2-017 --> INT's survey counts sit within one of the recovery counts (45/46, 57/56, 96/95, 85/85). **O**. <!-- INT-12.2-018 -->

Structure types reached by the sequential walk on the 11 fixture designs (BB-Black counted twice). **O** (replay). Counts stop where the walk stops, so on scanner designs they describe the head of the stream only (CutiePi walk reaches 11 entries of 182 variants, LAUNCHXL 12 of 143, J2032 151 of 211). <!-- INT-10.2-023 -->

| Type | Count | ids |
| --- | --- | --- |
| 24 LibraryPart | 640 | <!-- INT-10.2-014 --> |
| 6 PartCell | 615 | <!-- INT-10.2-015 --> |
| 31 Package | 521 | <!-- INT-10.2-016 --> |
| 75 ErcSymbol (INT: unidentified 0x4B) | 342 | <!-- INT-10.2-017 --> |
| 33 GlobalSymbol | 74 | <!-- INT-10.2-018 --> |
| 35 OffPageSymbol | 62 | <!-- INT-10.2-019 --> |
| 64 TitleBlockSymbol | 12 | <!-- INT-10.2-020 --> |
| 0 and 20 | 1 each, both in LAUNCHXL-CC1310 just before the walk fails at 43997 (desynchronisation, not entries) | <!-- INT-10.2-021 --> |

Type 75 is identifiable as the ErcSymbol: one 43 or 44 primitive, no pins, and `Symbols/ERC` streams of type 75 listed in `$Types$`. **S**.

Per-design replay of the parser's Cache read. **O**. Where INT's entry count is one higher, the walk ends inside the sub-loop at the end of the stream; all other counts are exact.

| Design | Cache bytes | Walk entries (INT) | Scanner | LibraryParts / Packages recovered | ids |
| --- | --- | --- | --- | --- | --- |
| BeagleBoard-xM | 315,514 | 306 (307) | no | 85 / 79 | <!-- INT-10.3-013 --> |
| BB-Black (both copies) | 282,889 | 262 (263) | no | 75 / 72 | <!-- INT-10.3-014 INT-10.3-015 --> |
| CutiePi | 111,506 | 11 | yes, at 4848 | 56 / 57 (true 57 / 57) | <!-- INT-10.3-016 --> |
| CC13xx | 32,827 | 49 (50) | no | 14 / 12 | <!-- INT-10.3-017 --> |
| LAUNCHXL-CC1310 | 141,722 | 12 | yes, at 43997 | 46 / 41 (true 47 / 41) | <!-- INT-10.3-018 --> |
| reComputer J201 | 588,002 | 375 | no | 95 / 86 | <!-- INT-10.3-019 --> |
| reComputer J202 | 491,152 | 217 | no | 65 / 56 | <!-- INT-10.3-020 --> |
| reComputer J401 | 500,164 | 238 | yes, at 500162 | 65 / 57 | <!-- INT-10.3-021 --> |
| reServer J401 | 787,193 | 385 | yes, at 787191 | 96 / 87 | <!-- INT-10.3-022 --> |
| reServer J2032 | 639,194 | 151 | yes, at 616594 | 70 / 59 (true 70 / 60) | <!-- INT-10.3-023 --> |

- Six designs (BB-Black counted twice) walk the whole Cache; five need the scanner. **O**. <!-- INT-10.3-024 -->
- For reComputer J401 and reServer J401 the walk fails only on the last two bytes: the 8-byte peek meets the final zero-variant group's 2-byte count. **O**. <!-- INT-10.3-025 -->
- CutiePi (4848), LAUNCHXL-CC1310 (43997) and reServer J2032 (616594) break mid-stream, and the scanner recovers the rest. **O**. <!-- INT-10.3-026 INT-12.2-011 -->
- The 400-byte string cap ends the walk on CutiePi (a length of 17152 at offset 4846) and reServer J2032 (65312 at 616592). LAUNCHXL-CC1310 stops for a different reason: a missing NUL after a 33-byte string at 43997. **O**. <!-- INT-3.1-012 -->
- Every design yields LibraryParts from the Cache, the scanner designs included (CutiePi 56/57, LAUNCHXL 46/47); the pin-name coverage of INT §13.5 was not rechecked here. **O**. <!-- INT-10.3-027 -->
- In `Packages/<p>`, a LibraryPart that fails to parse is rewound and skipped, losing only its pin names (`page-parser.ts:217-224`); the trailing Package is parsed without that guard, because losing it would lose the pin map (`page-parser.ts:227`). (parser code) <!-- INT-9-006 INT-9-007 -->
- Device slots: the parser peeks an `i16` and, on -1, consumes 2 bytes and stores a null placeholder (`structures.ts:442-447`), so `pin_map` always has `pin_count` entries. OpenOrCadParser's `StructDevice.cpp:58` skips the entry instead, giving a dense array. The parallel ignore array gets `false` at that position. (parser code) <!-- INT-9.2-006 INT-9.2-011 INT-9.2-012 -->
- SymbolPin: only `name` is kept; the 28 bytes from `start_x` through `tail_opaque` are skipped (`structures.ts:501-503`). (parser code) <!-- INT-9.4-011 INT-13.2-011 -->

### Refuted

| Claim | Source | What the files show | Evidence | ids |
| --- | --- | --- | --- | --- |
| Cache entries are sequential variable-length metadata plus a structure | INT §10.2 | Five directory tables: `[u16 group_count]{[lstr name][u16 variant_count]{[lstr lib][u32 id][u32 id][u16 type][body]}}`, read to the exact end (§5.1). | **S** (89/89, 7,167 bodies) | <!-- INT-10.2-001 --> |
| Cache metadata has three variants found by probing | INT §10.2 | No variants exist; the probes match pieces of the table structure (counts, names, libraries). | **S** | <!-- INT-10.2-002 --> |
| Metadata variant 1 is the entry name | INT §10.2 | The string before the id pair is the variant's `source_library` (7,167). | **S** | <!-- INT-10.2-003 --> |
| Metadata variant 2 is `u16, refDes, u16, name` | INT §10.2 | It is `[u16 count][lstr group name][u16 variant_count][lstr library]`; the "refDes" is a group name. | **S** | <!-- INT-10.2-004 --> |
| Metadata variant 3 is an unknown `u16` then the name | INT §10.2 | The `u16` is a group or variant count. | **S** | <!-- INT-10.2-005 --> |
| The refDes-like strings are 3-letter refdes descriptors | INT §10.2 | Short names such as `LED` and `VDC` are group (definition) names. | **S** | <!-- INT-10.2-006 --> |
| `source_library` ends in `.olb` or `.dsn` | EXT §5.2.2 | 11 variants end in `.ETC` (PSpice `MARKER.ETC`). | **S** (7,167) | <!-- EXT-5.2.2-016 --> |
| Every `id` decodes to 2000-2030 | EXT §5.2.3 | One id is 909044342 (1998-10-22). | **S** | <!-- EXT-5.2.3-005 --> |
| All of table 3 lies between bodies | EXT §5.2.7 | Table-3 part cells are ordinary variants with bodies (2,112). | **S** | |
| An id-pair scan misses every part cell | EXT §5.2.7 | All 2,112 table-3 variants have `id = id_copy` and type 6, so the scan finds them. | **S** | |
| Type 64 has 0 pin slots, 14-31 primitives, 7/8/10 displays | EXT §5.3.2 | 11 type-64 records (PSpice markers) have one pin slot; 4 primitives (11 records) and display counts 0, 5, 12 also occur; the observed 15, 17, 19 and 20 primitives lie inside 14-31. | **S** | <!-- EXT-5.3.2-020 --> |
| Every primitive of kinds 40-45, 47, 87 has the long form | EXT §5.3.3 | 6,073 use the short form (§5.2.3). | **S** | |
| Every pin slot is a type-26 record | EXT §5.3.4 | 197 slots are the single byte 00. | **S** | <!-- EXT-5.3.4-001 --> |
| Pin slot 00 does not occur in real files | EXT §16.5.3 | 197 occur (15 Cache, 182 `Packages/`). | **S** | <!-- EXT-16.5.3-004 --> |
| Pin shape bits 10-15 are reserved and 0 | EXT §5.3.5, §5.8, §16.5.4 | Bit 10 is set on 19 type-24 pins. | **S** | <!-- EXT-5.3.5-037 EXT-5.8-007 EXT-16.5.4-012 --> |
| Type-24 pins never set shape bit 7 and always set bit 5 | EXT §5.3.5, §16.5.4 | 106 Cache + 73 `Packages/` type-24 pins (hidden power pins) set bit 7 and clear bit 5. | **S** | <!-- EXT-5.3.5-038 EXT-16.5.4-013 --> |
| Pin shape: bit 5 is_global, bit 7 is_no_connect | INT §9.4 (after OpenOrCadParser) | Bit 5 is Visible, bit 7 is Global (§5.2.5). | **E** | <!-- INT-9.4-005 --> |
| Known `part_flags` words are 0, 1, 2, 3, 5, 6, 7, 11, 15, 43 | EXT §5.3.7, §16.5.6 | Observed 3, 6, 2, 4, 44, 0, 43, 11, 46, 7, 42, 10, 59, 52, 1; 5 and 15 never. | **S** | <!-- EXT-5.3.7-015 EXT-16.5.6-006 --> |
| Package `refdes_prefix` is never empty | EXT §5.4.1 | Empty in 6 Cache and 1 `Packages/` packages. | **S** | <!-- EXT-5.4.1-008 --> |
| Device physical-pin `number` is never empty | EXT §5.4.2 | Empty in 134 slots. | **S** | <!-- EXT-5.4.2-011 --> |
| Device field 2 is `ref_des` | INT §9.2 | It is the part cell name (2,261/2,261 resolve); it equals the refdes prefix in only 93. | **S** | <!-- INT-9.2-004 --> |
| Homogeneous multi-section packages have two devices | EXT §5.6.3 | 2 (28), 4 (13), 6 (15) or 8 (1) devices. | **S** | <!-- EXT-5.6.3-004 --> |
| A `.Convert` view's `id` always equals its cell's | EXT §5.6.4 | Equal in 26 of 28. | **S** | <!-- EXT-5.6.4-004 --> |

### Unverified

- *unverified*: Listed values that never occur in the files: type-24 short-prefix `n` 15-52 (EXT range 0-52); `device_count` 14-31 (EXT 1-31); pin lengths 6, 7, 15 with shape bit 0 set and 15 with it clear; type 76 in the symbol-type lists (types sharing the layout, 4 full prefixes, table 1, `n` = 0); types 33 and 76 as `Symbols/<s>` streams. <!-- EXT-5.3.1-004 EXT-5.4.1-012 EXT-5.3.5-025 EXT-5.3.5-026 EXT-5.3-001 EXT-5.3.1-002 EXT-5.3.1-009 EXT-5.2.1-003 EXT-5-001 EXT-1.2.4-002 EXT-3.7-007 -->
- *unverified*: An empty physical-pin slot is `FF FF` (`i16` -1, 2 bytes) where a number `lstr` would start, meaning no physical pin at this position. No such slot occurs in 77,669 slots (25,450 Cache + 52,219 `Packages/`). <!-- EXT-3.8-007 EXT-5.4.2-012 EXT-16.13.2-008 -->
- *unverified*: An empty Cache is ten zero bytes, five tables each with `group_count` 0. No corpus Cache is that small (smallest 1,314 bytes). <!-- EXT-5.2.1-008 -->
- *unverified*: Pages refer to Cache definitions by name and source library and do not embed them; a placed instance joins its package by package name, library and device index, and its view by view name; a placed part's symbol name, source library and package match a Cache view, cell and package byte for byte (EXT's example: `PART1.Normal`, `C:\EXAMPLE.OLB`, package `PART1`, device index 0). The page side belongs to chapters 6 and 7; the Cache side of the join holds (2,261 joins). <!-- EXT-5-002 EXT-5.6.1-004 EXT-18.10.2-004 -->
- *unverified*: A placed pin carries a one-based position, and its physical pin is `device.pin_numbers[position − 1]`. The placed-pin side was not checked here (the parser applies it, `pin-resolver.ts:104`; §5.9). <!-- EXT-5.6.2-004 -->
- *unverified*: For packages, cells and views with a `* Directory` entry, after removing the local-time offset (whole quarter hours) from the entry FILETIMEs, `id` lies 0-15 s after the entry's `created` time; for symbols, `id` sometimes equals the entry's `created` or `modified` time within 2 s. The FILETIME comparison was not run. <!-- EXT-5.2.3-007 EXT-5.2.3-008 -->
- *unverified*: A part-library `Symbols/<symbol>` holds one symbol record of type 33, 34, 35 or 64. Part-library `.olb` files were not decoded. <!-- EXT-4.14-005 -->
- *unverified*: Type 76 (BookMarkSymbol) has 0 pin slots, one primitive of kind 40, no displays and no properties. No type-76 record occurs. <!-- EXT-5.3.2-022 EXT-5.3.3-021 -->
- *unverified*: A pin slot starting with byte 27 is a SymbolPinBus record with the SymbolPinScalar layout; a slot starting with any other byte is a framed record skipped by its first full prefix and counted as an empty position. Neither occurs in 76,180 pins. <!-- EXT-5.3.4-002 EXT-5.3.4-004 -->
- *unverified*: Pin shape bits per EXT: bit 0 (0x0001) IsLong, bit 1 (0x0002) IsClock, bit 2 (0x0004) IsDot (inversion bubble), bit 3 (0x0008) IsLeftPointing, bit 4 (0x0010) IsRightPointing, bit 6 (0x0040) IsNetStyle. Bits 0-2 are set on type-24 pins and bits 3-4 on type-34 pins; bit 6 is never set. The meanings need Capture or a richer export. <!-- EXT-5.3.5-027 EXT-5.3.5-028 EXT-5.3.5-029 EXT-5.3.5-030 EXT-5.3.5-031 EXT-5.3.5-033 EXT-16.5.4-002 EXT-16.5.4-003 EXT-16.5.4-004 EXT-16.5.4-005 EXT-16.5.4-006 EXT-16.5.4-008 -->
- *unverified*: `pin_type` 6 is OpenEmitter (open-emitter output). The value never occurs in 76,180 pins. <!-- EXT-5.3.5-049 -->
- *unverified*: `part_flags` bit 0 IsPinNamesVisible (1 = pin names drawn), bit 1 IsPinNamesRotated (1 = pin names rotated), bit 2 PinNumbersHidden (1 = pin numbers hidden). All values 0-7 except 5 occur in bits 0-2; the meanings need Capture. <!-- EXT-5.3.7-009 EXT-5.3.7-010 EXT-5.3.7-011 EXT-9.8-002 EXT-9.8-003 EXT-9.8-004 EXT-16.5.6-002 EXT-16.5.6-003 EXT-16.5.6-004 -->
- *unverified*: A PCB footprint can also be stored as a user property named "PCB Footprint" on a view, in its short prefix or display list. Property names were not resolved against the string table. <!-- EXT-5.6.5-003 -->
- *unverified*: With the old fixed 3-byte scanner, LAUNCHXL-CC1310 and CutiePi yielded 0 LibraryParts and 41 and 57 Packages: pin numbers for all components, pin names for none. That code is gone, so the behaviour cannot be replayed. <!-- INT-12.2-019 -->

### Unresolved conflicts

**Device pin flag bit 7 (Pin Ignore).** INT reads bit 7 of the device pin flag as Capture's Pin Ignore property (Pin Properties → Ignore): the netlister leaves the pin out of that section, and the parser drops such pins from every net (`net-pins.ts:150`; `component-builder.ts:235` and `:310` only keep them out of pin-name lookup). EXT lists the byte as unknown. <!-- EXT-5.4.2-015 EXT-16.5.8-005 EXT-5.oq-005 -->

What the exports show (`checks/cache/ignore-pins.ts`, `page-pins.ts`, cache check `bit-7 device pin slot`):

- Multi-section: `RJ45_1x4_LPJE104-0BENL` (reServer J401, fixture), slot 14 (pin `SHD2`) has numbers `SS1`, `SS2`, `SS3` with flag 0xFF on sections 1-3 and `S5` with 0x7F on section 4. pstchip writes `PIN_NUMBER='(0,0,0,S5)'` and pstxnet has no `SS1`-`SS3`: the slot is not a pad of those sections. Dropping it matches the export.
- Single-section: in every other 0xFF slot the pin is a real pad. pstchip lists it with its number and pstxnet places it on the net of a sibling pin of the same part, although the pin has no wire on the page: `ONYXPSU.DSN` `SI7617DN`/`SIS412DN` `S2`, `S3` on the net of `S1`; `NCP45521IMNTWG-H_5` `PAD` (pin `TH`) on the net of `Vin`; `CLAYR6.DSN` `GPIO_3X3_100` `VDD1`, `VDD2` on `VDD`'s net and `GND1`, `GND2` on `GND`'s; on the Clay board, `MPU9250` `NC2`-`NC9` share pin 6 `NC`'s net, `TPS61201` `PGND2` shares `PGND`'s and `CRYSTAL_4` `GND4` shares `GND`'s. No pin property, pin group, wire or shared hot point names the sibling; a name-stem rule fits every case except `PAD` → `Vin`.
- Parser loss: the parser drops these real pins. `ONYXPSU.DSN` loses 14 pins on 9 parts (`A0_SW`-`A3_SW` pin `TH`; `BATDRV_Q`, `DC_Q1`, `DC_Q2`, `HIDRV_Q`, `LOWDRV_Q` pins 2 and 3); `CLAYR6.DSN` (both copies) loses pins 5-8 of `J3`-`J6` (16 pins). Fixture coverage does not show it: the `clay-r6` fixture holds only the `MK64FN1M0VLL12` block and the board export, not `CLAYR6.DSN`, so no fixture pairs the board with its export; `ONYXPSU.DSN` is corpus only; the one fixture with 0xFF slots (reServer J401) has only the multi-section case, where dropping is right.

So bit 7 marks a pin with no schematic connection of its own: in a multi-section part it is absent from that section; in a single-section part Capture's export still writes it and ties it to a sibling pin. What would settle the sibling rule: a Capture-made test part with Pin Ignore set on a single-section pin whose name shares no stem with the pin it should join, exported with pstchip and pstxnet.

### Open questions

- What table 0 of the Cache would hold, and whether it can be non-empty. It is empty in 89/89 files. <!-- EXT-5.2.1-007 EXT-5.oq-001 -->
- The order of groups within a table and of variants within a group. Groups are unsorted (§5.1.3); variants are mostly in non-increasing `id` order (183/213). <!-- EXT-5.oq-002 -->
- What zero-variant groups record. EXT's reading, the residual name of a definition no longer cached, is not testable from file content; the data fits it (empty table-2/3/4 groups come in matching sets, §5.1.4). <!-- EXT-5.2.5-006 -->
- Whether `id` is a Unix time in seconds (UTC) recording when the definition was stored. Consistent: 7,166/7,167 decode to 2000-2030 and all are ≤ Library `modified` + 2 s; unproven. Why a `.Normal` id is sometimes lower than its cell's (2 cells, by 1-12) and a `.Convert` id differs in 2. <!-- EXT-5.2.3-004 EXT-5.oq-003 -->
- Whether pin `opaque_word`, pin `tail_opaque` and the display opaque byte mean anything. They differ between copies of one definition; no meaning found. <!-- EXT-5.oq-004 INT-9.4-012 INT-13.3-013 INT-13.3-014 --> INT's unknown 2 bytes after `pin_shape` are `opaque_word`; its unknown 4 bytes after `port_type` are `tail_tag` (26 in 76,180) plus the 3 `tail_opaque` bytes. INT's pin enum came from OpenOrCadParser: `pin_type` 0-5 and 7 are now confirmed by export, and shape bits 5 and 7 differ from that source.
- The meaning of ContentsViewType (`part_flags >> 3`): values 0, 1, 5, 6, 7 occur (1 in 16 + 4 records, 5 in 65 + 7). Whether a part-trailer preamble can occur: none in 3,417 records. <!-- EXT-5.3.7-014 EXT-5.oq-006 EXT-9.8-006 EXT-9.oq-009 EXT-16.5.7-005 EXT-16.5.7-006 EXT-16.5.7-007 EXT-16.oq-002 -->
- A part's implementation (EXT: `contents_library`, `contents_view` and `part_flags >> 3` in each view's trailer). The contents fields are usually empty (2,137/2,141), so the meaning is not testable. <!-- EXT-5.6.5-001 -->
- Which PCB footprint governs a placement when the package `pcb_footprint` and a view "PCB Footprint" property are both set. Not tested. <!-- EXT-5.6.5-005 EXT-5.oq-010 -->
- Whether bus pins (27), empty physical slots (`FF FF`) or a type-34 `Symbols/<s>` stream can occur. None seen; empty pin slots (00) do occur (197). <!-- EXT-5.oq-007 -->
- Whether a physical pin number can be 65,535 bytes long, colliding with the `FF FF` empty-slot form. No number comes near; not testable. <!-- EXT-5.oq-008 -->
- The meaning of the `.olb` suffix in `source_library` (EXT: a part library). `.olb` occurs in 5,629 variants; the meaning is not testable from the files. <!-- EXT-16.5.2-003 -->
- The meaning of shape bit 10 (19 type-24 pins).
- How far the parser's metadata probing misreads the Cache: 3 of 15 fixture designs need the scanner mid-stream, while the five-table read has no heuristic and ends exactly on 89/89. INT rated the risk Medium. <!-- INT-13.4-003 -->

### Parser divergences

| Parser does | Files show | Impact |
| --- | --- | --- |
| Drops every pin whose device pin flag has bit 7 set from all nets (`net-pins.ts:150`). | In single-section parts these are real pads that Capture's export writes and ties to a sibling pin's net (§5.8, Unresolved conflicts). | 30 export-backed pins lost on `ONYXPSU.DSN` (14) and `CLAYR6.DSN` (16); no fixture covers it. |
| Reads the Device's second string as `refDes` (`structures.ts:436`); the value is unused. | It is the part cell name (§5.4). | Naming only; netlist output unaffected. |

Resolved: the parser reads the Cache as its five directory tables (`walkCacheTables`, `cache-parser.ts`), the same walk the page renderer uses; the magic scan remains only for a stream whose tables will not walk, which no version-3 file in the corpus is. Netlist output is unchanged: exported netlists are identical on all 90 exportable corpus designs, and coverage against Capture's exports is unchanged on the fixtures and the corpus. **T** (`cache-tables.test.ts`: every version-3 fixture Cache ends exactly at its stream end).

<!-- meta: EXT-5-004 EXT-5.2.3-003 EXT-5.2.4-006 EXT-5.2.5-007 EXT-5.3.1-011 EXT-5.3.2-001 EXT-5.3.3-001 EXT-5.3.5-021 EXT-5.3.5-022 EXT-5.3.7-008 EXT-5.4.2-005 INT-9.2-016 INT-10-003 INT-10.2-013 INT-10.3-011 INT-10.3-012 INT-10.4-014 -->

Parser coverage: the parser reads Package and Device records (name, refdes prefix, footprint, `unit_ref`, pin numbers, pin flag) and LibraryPart pin names from both the Cache and `Packages/<p>`, and applies the pin-map choice and duplicate-refdes rules; it skips PartCells, terminal symbols, the primitive list and bbox, pin geometry, shape bits and `pin_type`, the part trailer flags, `Symbols/<s>`, `Symbols/$Types$` and the `_pDboPackage_Copy_` streams.

Page rendering (`render_page`) additionally reads the Cache's five tables (`readCacheSymbols`) and decodes every symbol-shaped record of types 24, 33, 34, 35, 64 and 75: primitive list, stored box, pin slots with start, hot point, shape and `pin_type`, and display records. Every such record in every version-3 Cache decodes (2,969 of 2,969 bodies in 96 distinct Cache streams); the 14 that do not are in Library 2.0 files, which the page tools refuse. **S**.

---

## 6. Page stream

A schematic page is one stream, `Views/<schematic>/Pages/<page>`, that holds exactly one Page record (type 10) and nothing after it. **S** (451 page streams in 105 files, Library 3.2/3.3). <!-- EXT-6-001 INT-7-001 -->

All counts in this chapter come from the page check of 2026-11-20 (`checks/page/page-check.ts`), which read every page stream of the 105 files to its exact last byte with 0 failures. <!-- EXT-0.4-005 --> The earlier pass behind the previous golden spec read 485 page streams in 106 designs; where its counts differ from this chapter, this chapter follows the newer check.

### 6.1 Stream name and page order

The stream's leaf name is the page name stored in the record, with two characters replaced by control bytes. **S** (451/451 streams). <!-- EXT-6.1-001 -->

| Page-name character | Byte in the stream name | Evidence | Ids |
| --- | --- | --- | --- |
| `/` | `0x02` | **S** (88 leaves carry `0x02`/`0x03`; name equals mapped leaf on 451/451) | <!-- EXT-6.1-002 --> |
| `:` | `0x03` | **S** (451/451) | <!-- EXT-6.1-003 --> |
| every other character | unchanged | **S** (451/451) | <!-- EXT-6.1-004 --> |

To match a stream to its page, map `0x02` to `/` and `0x03` to `:` in the leaf name. **S** (451/451 streams matched). <!-- EXT-6.1-005 -->

The page stream holds no order field. The order of pages lives in the Schematic stream, whose page list equals the set of page streams of that schematic. **O** (162/162 schematics; the order itself was not compared with Capture). <!-- EXT-6.1-006 --> Each page record's name equals its stream name. **S** (451/451). <!-- EXT-18.10.2-002 -->

### 6.2 Layout

The page stream is, in order: <!-- EXT-6.2-005 INT-7-006 -->

| Part | Content | Evidence | Ids |
| --- | --- | --- | --- |
| 1 | Page record frame: type 10, 2 full prefixes, a short prefix (count 0), a preamble. Size 29 bytes plus the preamble extension, whose length is 0 on every page (the 19-byte extension form never occurs). | **S** (451/451) | <!-- EXT-6.2-001 INT-7-002 --> |
| 2 | `lstr` page name | **S** (451/451) | <!-- EXT-6.2-002 INT-7-003 --> |
| 3 | `lstr` page size name | **S** (451/451) | <!-- EXT-6.2-003 INT-7-004 --> |
| 4 | PageSettings, 156 bytes (§6.4) | **S** (451/451) | <!-- EXT-6.2-004 INT-7-005 --> |
| 5 | Fourteen `u16`-counted lists in fixed order (§6.5) | **S** (451/451) | <!-- EXT-6.5-001 EXT-16.6.1-001 --> |

The Page record's R1 stop is the end of the stream, and its R2 stop is the end of the Page preamble. **S** (F = 2, R1 stop = stream end and R2 stop = preamble end on 451/451). <!-- EXT-3.7-005 --> The outer full prefix's length is the stream length minus 9. **S** (451/451). <!-- EXT-6.10-001 -->

The stream ends exactly after the last byte of list 14, which is its `u16` count of 0; no trailing bytes follow. **S** (451/451). <!-- EXT-3.7-010 EXT-6.2-006 EXT-6.10-001 -->

### 6.3 Page name and page size name

- The page name is a non-empty `lstr` and equals the mapped stream leaf (§6.1). **S** (451/451). <!-- EXT-6.3-001 -->
- The page size name is a free-text `lstr` naming the sheet size. It is never empty in the corpus. **S** (451/451). <!-- EXT-6.3-002 -->
- Forms seen: one letter (`A`, `B`, ...) on 256 pages, all IsMetric 0; one letter and one digit (`A3`, `A4`) on 192 pages, all IsMetric 1; the six-letter `Custom` on 3 pages, all IsMetric 0. **O** (451 pages). <!-- EXT-6.3-003 -->
- A metric page whose width and height are an ISO A size in micrometres carries the matching ISO name: A3 on 144/144, A4 on 42/42, A2 on 6/6. **O**. <!-- EXT-2.5.1-010 EXT-6.4.1-007 -->

### 6.4 PageSettings

PageSettings is a fixed 156-byte block that follows the page size name. The Library stream holds a default copy with the same layout (the *Library default block*). **S** (451 pages and 105 Library default blocks; decoding continues into the lists, or into the Library string table, on all of them). <!-- EXT-4.9-001 EXT-6.4-003 INT-7.2-001 INT-13.4-010 EXT-6.4-001 --> All fields are little-endian, offsets are relative to the block start, and every field holds a sensible value under that reading. **O** (451/451). <!-- EXT-6.4-002 --> The Library default block was located by decoding the Library header (fonts, 24 defaults, 8 flag bytes, 8 `lstr`).

Every boolean flag (`+0x5C` to `+0x98`) is a `u32` holding 0 or 1. **O** (451 pages and 105 default blocks). <!-- EXT-16.7.4-001 -->

| Offset | Type | Field | In pages (451) | In the Library default (105) | Evidence | Ids |
| --- | --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | created (unixtime32) | non-zero on 451/451 | 0 on 105/105 | **O** | <!-- EXT-6.4-004 EXT-4.9-002 EXT-2.6.1-003 --> |
| +0x04 | u32 | modified (unixtime32) | non-zero and ≥ created on 451/451 | 0 on 105/105 | **O** | <!-- EXT-6.4-005 EXT-4.9-003 EXT-2.6.1-003 --> |
| +0x08 | u32 | outer margin x | 0 | 0 | **O** | <!-- EXT-6.4-006 EXT-4.9-004 --> |
| +0x0C | u32 | outer margin y | 0 | 0 | **O** | <!-- EXT-6.4-007 EXT-4.9-005 --> |
| +0x10 | u32 | inner margin x | 0 | 0 | **O** | <!-- EXT-6.4-008 EXT-4.9-006 --> |
| +0x14 | u32 | inner margin y | 0 | 0 | **O** | <!-- EXT-6.4-009 EXT-4.9-007 --> |
| +0x18 | u32 | width, page units (§6.4.1) | see below | 0 on 105/105 (97 IsMetric 0, 8 IsMetric 1) | **O** | <!-- EXT-6.4-010 EXT-4.9-008 --> |
| +0x1C | u32 | height, page units | see below | 0 on 105/105 | **O** | <!-- EXT-6.4-012 EXT-4.9-009 --> |
| +0x20 | u32 | pin-to-pin, page units | 100 on 259/259 IsMetric 0 pages; on IsMetric 1 pages 2540 on 183, 1000 on 9 | 100 on 97, 2540 on 5, 1000 on 3 | **O** | <!-- EXT-6.4-014 EXT-4.9-010 --> |
| +0x24 | u16 | reserved | 0 | 0 | **O** | <!-- EXT-6.4-015 EXT-4.9-011 --> |
| +0x26 | u16 | horizontal zone count | 5 ×442, 4 ×7, 10 ×2 | 5 on 102, 4 on 3 | **O** | <!-- EXT-6.4-016 EXT-4.9-012 --> |
| +0x28 | u16 | vertical zone count | 4 ×449, 10 ×2 | 4 on 105/105 | **O** | <!-- EXT-6.4-017 EXT-4.9-013 --> |
| +0x2A | u16 | opaque | 0 ×369, two printable ASCII bytes ×45, other ×37; `FF FF` not seen; may differ between pages of one file | 0 ×80, printable ×6, other ×19 | **O** | <!-- EXT-6.4-018 EXT-4.9-014 --> |
| +0x2C | u32 | horizontal band width, page units | 100 ×249, 2540 ×171, 10 ×17, 50 ×8, 10000 ×3, 5000 ×2, 3048 ×1 | 100 ×86, 10 ×15, 2540 ×3, 10000 ×1 | **O** | <!-- EXT-6.4-020 EXT-6.4-021 EXT-4.9-015 --> |
| +0x30 | u32 | vertical band width | equal to +0x2C on 451/451 | equal on 105/105 | **O** | <!-- EXT-6.4-022 EXT-4.9-016 --> |
| +0x34 | u32 | colour (colour index) | 48 | 48 | **O** | <!-- EXT-6.4-023 EXT-4.9-017 EXT-16.2.4-013 --> |
| +0x38 | u32 | label colour | 48 | 48 | **O** | <!-- EXT-6.4-024 EXT-4.9-018 EXT-16.2.4-013 --> |
| +0x3C | u32 | outer line style | 0 | 0 | **O** | <!-- EXT-6.4-025 EXT-4.9-019 EXT-16.3.1-010 --> |
| +0x40 | u32 | outer line width | 0 | 0 | **O** | <!-- EXT-6.4-026 EXT-4.9-020 EXT-16.3.2-008 --> |
| +0x44 | u32 | inner line style | 0 | 0 | **O** | <!-- EXT-6.4-027 EXT-4.9-021 --> |
| +0x48 | u32 | inner line width | 0 | 0 | **O** | <!-- EXT-6.4-028 EXT-4.9-022 --> |
| +0x4C | u32 | horizontal style | 0 | 0 | **O** | <!-- EXT-6.4-029 EXT-4.9-023 --> |
| +0x50 | u32 | horizontal separator width | 0 | 0 | **O** | <!-- EXT-6.4-030 EXT-4.9-024 --> |
| +0x54 | u32 | vertical style | 0 | 0 | **O** | <!-- EXT-6.4-031 EXT-4.9-025 --> |
| +0x58 | u32 | vertical separator width | 0 | 0 | **O** | <!-- EXT-6.4-032 EXT-4.9-026 --> |
| +0x5C | u32 | outer border visible | 1 | 1 | **O** | <!-- EXT-6.4-033 EXT-4.9-027 EXT-16.7.4-002 --> |
| +0x60 | u32 | inner border visible | 0 | 0 | **O** | <!-- EXT-6.4-034 EXT-4.9-028 EXT-16.7.4-003 --> |
| +0x64 | u32 | horizontal labels are characters | 0 (1 not seen) | 0 | **O** | <!-- EXT-6.4-035 EXT-4.9-029 EXT-16.7.4-004 --> |
| +0x68 | u32 | horizontal visible | 0 | 0 | **O** | <!-- EXT-6.4-036 EXT-4.9-030 EXT-16.7.4-005 --> |
| +0x6C | u32 | horizontal ascending | 0 ×442, 1 ×9 | 0 | **O** | <!-- EXT-6.4-037 EXT-4.9-031 EXT-16.7.4-006 --> |
| +0x70 | u32 | vertical labels are characters | 1 (0 not seen) | 1 | **O** | <!-- EXT-6.4-038 EXT-4.9-032 EXT-16.7.4-007 --> |
| +0x74 | u32 | vertical visible | 0 | 0 | **O** | <!-- EXT-6.4-039 EXT-4.9-033 EXT-16.7.4-008 --> |
| +0x78 | u32 | vertical ascending | 0 ×442, 1 ×9 | 0 | **O** | <!-- EXT-6.4-040 EXT-4.9-034 EXT-16.7.4-009 --> |
| +0x7C | u32 | IsMetric (§6.4.1) | 0 ×259, 1 ×192 | 0 on 97, 1 on 8 | **O** | <!-- EXT-6.4-041 EXT-16.7.3-001 EXT-4.9-035 --> |
| +0x80 | u32 | border displayed | 1 | 1 | **O** | <!-- EXT-6.4-042 EXT-4.9-036 EXT-16.7.4-010 --> |
| +0x84 | u32 | border printed | 1 | 1 | **O** | <!-- EXT-6.4-043 EXT-4.9-037 EXT-16.7.4-011 --> |
| +0x88 | u32 | grid reference displayed | 1 | 1 | **O** | <!-- EXT-6.4-044 EXT-4.9-038 EXT-16.7.4-012 --> |
| +0x8C | u32 | grid reference printed | 1 | 1 | **O** | <!-- EXT-6.4-045 EXT-4.9-039 EXT-16.7.4-013 --> |
| +0x90 | u32 | title block displayed | 1 | 1 | **O** | <!-- EXT-6.4-046 EXT-4.9-040 EXT-16.7.4-014 --> |
| +0x94 | u32 | title block printed | 1 | 1 | **O** | <!-- EXT-6.4-047 EXT-4.9-041 EXT-16.7.4-015 --> |
| +0x98 | u32 | ANSI grid references | 1 | 1 | **O** | <!-- EXT-6.4-048 EXT-4.9-042 EXT-16.7.4-016 --> |

Widths and heights seen in pages: <!-- EXT-6.4-011 EXT-6.4-013 -->

| IsMetric | Widths | Heights |
| --- | --- | --- |
| 0 (mil) | 15200 ×90, 9700 ×82, 20200 ×78, 32200 ×5, 42200 ×2, 20000 ×1, 23000 ×1 | 9700, 7200, 15200, 20200, 32200 ×2, 18000, 17000, 10200 |
| 1 (µm) | 420000, 297000, 594000 | 297000, 210000, 420000 |

The three `Custom` pages have the non-standard sizes 20000 × 18000, 23000 × 17000 and 20200 × 10200. **O**.

Every page in the corpus has label colour 48, horizontal labels are characters 0, vertical labels are characters 1, title block printed 1 and ANSI grid references 1, with a non-empty page size name. **O** (451/451). <!-- EXT-6.4-050 -->

Every field that is constant across pages has the same value in the 105 Library default blocks, title block displayed included (1 in all). Pin-to-pin and IsMetric vary in both pages and default blocks. **O**. <!-- EXT-6.4-051 -->

#### 6.4.1 Units

Width, height, pin-to-pin and the two band widths are in page units, and the page unit depends on IsMetric. Object coordinates on the page (chapter 7) are always in 1/100 inch, whatever IsMetric says. **O** (451/451 pages hold unit-consistent values). <!-- EXT-2.5.1-007 EXT-6.4.1-001 EXT-6.4.1-004 EXT-16.7.3-004 -->

| IsMetric | Page unit | Pin-to-pin | Page units per coordinate unit | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| 0 | 1/1000 inch (mil) | 100 (0.1 in) on 259/259 pages | 10 | **O** | <!-- EXT-2.5.1-008 EXT-2.5.1-012 EXT-6.4.1-002 EXT-16.7.3-002 --> |
| 1 | 1 µm | 2540 (2.54 mm) on 183/192 pages; 1000 on 9 pages (`8MICS.DSN`, `STM32F746NGH V1.1_last.DSN`, `MIC_ARRAY_RELEASE.DSN`) | 254 | **O** | <!-- EXT-2.5.1-009 EXT-6.4.1-003 EXT-16.7.3-003 --> |

- Pins of a part are spaced at multiples of 10 coordinate units (0.1 in) on both kinds of page: 14014/14023 placed instances and 168/168 drawn instances with at least two pins; 9 placed instances are the exceptions. **O**. <!-- EXT-6.4.1-006 -->
- Under this scale, objects lie within `0 ≤ x ≤ width / u` and `0 ≤ y ≤ height / u` (u = 10 or 254, x along the width), apart from 2 to 3% of points beyond the border: outside are 4561 of 170978 wire ends, 1648 of 63616 pins, 435 of 15183 instance locations and 250 of 14833 connector locations. **O**. <!-- EXT-2.5.1-013 EXT-6.4.1-005 -->

#### 6.4.2 Library default block

All 105 Library default blocks have one form: horizontal × vertical zone counts 5 × 4 on 102 and 4 × 4 on 3; band widths 100 ×86, 10 ×15, 2540 ×3, 10000 ×1; horizontal labels are characters, horizontal ascending and vertical ascending all 0; grid reference displayed, grid reference printed, title block displayed, title block printed and ANSI grid references all 1. **O** (105/105). No default block with zero counts, zero widths or zero display flags (the *empty form* EXT describes) occurs. <!-- EXT-4.9-043 EXT-4.9-044 EXT-4.9-045 EXT-4.9-046 EXT-4.9-047 -->

### 6.5 The fourteen lists

After PageSettings come 14 lists. Each is a `u16` record count followed by that many records, with no padding, always in this order. The counts below are those seen; a count is a `u16` and has no other limit. **S** (451/451 pages decode to the exact end). <!-- EXT-6.5-001 EXT-6.5-016 -->

| List | Content | Record types | Records seen | Count range seen | Evidence | Ids |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Title blocks (§7.13) | 65 | 443 | 0–1 (0 ×8, 1 ×443) | **S** | <!-- EXT-6.5-002 EXT-6.5.1-001 EXT-16.6.1-002 --> |
| 2 | Scalar net headers, SchematicNet (§6.6) | 52 | 27130 | 0–1337 | **S** | <!-- EXT-6.5-003 EXT-6.5.1-002 EXT-16.6.1-003 INT-7-007 --> |
| 3 | Bus net headers, NetBus, each followed by `u16 m` and `m × u32` (§6.7) | 53 | 1212 | 0–338 | **S** | <!-- EXT-6.5-004 EXT-6.5.1-003 EXT-16.6.1-004 INT-7-008 --> |
| 4 | Net-name table, unframed rows (§6.8) | none | 25481 rows | 0–1674 | **S** | <!-- EXT-6.5-005 EXT-6.5.1-004 EXT-16.6.1-005 --> |
| 5 | Wires (§7.8) | 20, 21 | 82605 scalar, 2884 bus | 0–2080 | **S** | <!-- EXT-6.5-006 EXT-6.5.1-005 EXT-16.6.1-006 INT-7-010 --> |
| 6 | Part instances (§7.4, §7.6) | 13, 12 | 15009 placed, 174 drawn | 0–169 | **S** | <!-- EXT-6.5-007 EXT-6.5.1-006 EXT-16.6.1-007 INT-7-011 --> |
| 7 | Hierarchical ports (§7.10) | 23 | 2135 | 0–90 | **S** | <!-- EXT-6.5-008 EXT-6.5.1-007 EXT-16.6.1-008 INT-7-012 --> |
| 8 | Globals, each followed by 5 bytes (§7.11) | 37 | 8342 | 0–90 | **S** | <!-- EXT-6.5-009 EXT-6.5.1-008 EXT-16.6.1-009 INT-7-013 --> |
| 9 | Off-page connectors, each followed by 5 bytes (§7.11) | 38 | 6491 | 0–99 | **S** | <!-- EXT-6.5-010 EXT-6.5.1-009 EXT-16.6.1-010 INT-7-014 --> |
| 10 | ERC objects (§7.14) | 77 | 2066 | 0–702 | **S** | <!-- EXT-6.5-011 EXT-6.5.1-010 EXT-16.6.1-011 --> |
| 11 | Bus entries (§7.12) | 29 | 1688 | 0–1024 | **S** | <!-- EXT-6.5-012 EXT-6.5.1-011 EXT-16.6.1-012 --> |
| 12 | Page graphics | 55–62, 88, 89 | 6140: type 61 ×4107, 56 ×1427, 55 ×435, 58 ×119, 60 ×31, 62 ×11, 89 ×9, 59 ×1; 57 and 88 absent | 0–179 | **S** | <!-- EXT-6.5-013 EXT-6.5.1-012 EXT-16.6.1-013 --> |
| 13 | Unknown | unknown | none | always 0 | **S** (451/451) | <!-- EXT-6.5.1-013 EXT-16.6.1-014 --> |
| 14 | Unknown | unknown | none | always 0 | **S** (451/451) | <!-- EXT-6.5.1-014 EXT-16.6.1-015 --> |

After the count of list 14 the read position equals the stream length. **S** (451/451). <!-- EXT-6.5.1-015 -->

Within a list, each record's own type byte identifies it. Lists 5 and 6 mix two types under one count. **S** (451/451). <!-- EXT-6.5-017 --> Scalar and bus wires share the list-5 count (82605 and 2884). **S**. <!-- EXT-6.5-018 --> Placed and drawn instances share the list-6 count and may come in any order: 17 pages mix them, and on all 17 a drawn instance precedes a placed one. **S**. <!-- EXT-6.5-019 -->

**Data outside record regions.** Every page record ends at the stop of its first full prefix (R1), with one exception, NetBus, whose member list lies past that stop (1212 lists). **S**. <!-- EXT-6.5.1-016 --> Two more kinds of list data lie outside any record region: the 5 bytes after each Global and off-page connector (14833), and the net-name rows (25481), which have no frame. **S**. <!-- EXT-6.5.1-017 --> A reader that skips a record by its first full prefix alone loses alignment on all three; reading them explicitly decodes 451/451 pages. **S**. <!-- EXT-6.5.1-018 -->

### 6.6 SchematicNet (52)

A SchematicNet is the header of one scalar net on the page. It has exactly one full prefix, no short prefix and no preamble, and its region ends exactly after the line-width word. **S** (27130 records). <!-- EXT-6.6-001 --> Offsets are record-relative.

| Offset | Type | Field | Values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u8 | type | 52 | **S** (27130) | <!-- EXT-6.6-002 --> |
| +0x01 | u32 | length (bytes after this word) | ends right after line width | **S** (27130/27130) | <!-- EXT-6.6-003 --> |
| +0x05 | u32 | full-prefix marker | 0 | **S** (27130) | <!-- EXT-6.6-004 --> |
| +0x09 | u32 | net id | page-local net id | **S** | <!-- EXT-6.6-005 --> |
| +0x0D | lstr | name | always empty; names are in the net-name table (§6.8) | **S** (27130/27130) | <!-- EXT-6.6-007 --> |
| after name | u32 | reserved | 0 | **S** (27130/27130) | <!-- EXT-6.6-008 --> |
| +4 | u32 | colour (colour index) | 48 | **S** (27130/27130) | <!-- EXT-6.6-009 --> |
| +8 | u32 | line style | 5 (0 and 1 not seen) | **S** (27130/27130) | <!-- EXT-6.6-010 --> |
| +12 | u32 | line width | 3 (0 and 1 not seen) | **S** (27130/27130) | <!-- EXT-6.6-011 --> |

- The net id is what wires (82605 scalar wires), net-name rows (24269), NetBus member lists (12130 members) and pin net words (934 pins) refer to; every such reference names a SchematicNet on the same page. **S**. <!-- EXT-6.6-005 -->
- Net ids are a separate id space: no SchematicNet or NetBus id equals the `db_id` of any object on the same page. **S** (28342 net and bus ids against 126289 `db_id`s). <!-- EXT-6.6-006 -->
- SchematicNet headers are stored in ascending net-id order. **O** (451/451 pages). <!-- EXT-6.6-014 -->
- The low byte of the net id (+0x09) can itself be 52. It is not a second full prefix, because a SchematicNet always has exactly one. **S** (88 ids have low byte 52; reading exactly one full prefix decodes all of them). <!-- EXT-6.6-016 -->

### 6.7 NetBus (53)

A NetBus is the header of one bus net. It starts with the SchematicNet layout (§6.6) under type byte 53, and its full prefix's length covers only that header. **S** (1212 records). <!-- EXT-6.7-001 EXT-6.7-003 -->

| Part | Type | Field | Values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| header | record 53 | SchematicNet layout | name empty; colour 48, line style 5, line width 3 | **O** (1212/1212) | <!-- EXT-6.7-004 --> |
| after the header | u16 | member count `m` | 2 to more than 20 (4 ×384, 2 ×292, 8 ×252, >20 ×118, ...) | **S** (1212/1212) | <!-- EXT-6.7-005 --> |
| next | `m × u32` | member net ids | SchematicNet ids on the same page | **S** (12130/12130) | <!-- EXT-6.7-007 --> |

- The member list belongs to the record but lies after the stop of its first full prefix. NetBus is the only page record whose data extends past that stop. **S** (1212/1212). <!-- EXT-6.7-002 -->
- Every NetBus member list is non-empty. **O** (1212/1212; for example `meta_carrier_sch_rev1.dsn`, page `02-META-CONNECTORS`, bus 9766966, `m` = 4). <!-- EXT-6.7-006 -->
- Bus wires (type 21) carry the NetBus id in their net-id word. **S** (2884/2884). <!-- EXT-6.7-008 -->
- A bus net has a row in the net-name table under its NetBus id, holding the bus name (for example `EA_LCLK_OUT_N[3:0]` → 9766976). **O** (1212 rows). <!-- EXT-6.7-009 -->

### 6.8 Net-name table

List 4 maps net ids to names. Each row is an unframed `lstr name` followed by a `u32 id`, with no type byte and no prefix. **S** (25481 rows; decode reaches the stream end on 451/451). <!-- EXT-3.10-056 INT-7-009 --> The row id names a SchematicNet (24269 rows) or a NetBus (1212 rows). **S**. <!-- EXT-6.6-005 EXT-6.7-009 --> The table maps net ids to names the same way the type-67 table does, which together with these rows reproduces Capture's nets on the fixtures. **E** (nets 4601/4601). <!-- INT-7-009 -->

### 6.9 Objects without a list of their own

- **Junctions.** There is no junction record. Junction dots are two flag bits in each wire (§7.8): set on 15872 scalar wires (bit pattern 1 ×5501, 2 ×7717, 3 ×2654). **S** (full decode, no junction list exists). <!-- EXT-6.9-007 -->
- **Aliases.** There is no alias list. Net aliases are child records inside wires (§7.9): all 16165 aliases lie inside wires. **S**. <!-- EXT-6.9-008 -->
- **Bookmarks.** No bookmark instance (BookMarkSymbolInst, type 78) occurs in any page list, and the Cache holds only types 6, 24, 31, 33, 34, 35, 64 and 75, so no cached BookMarkSymbol (76) is seen either. **O** (451 pages decoded to the end with every list's types enumerated). <!-- EXT-6.9-005 -->
- **`~~CI_IMAGE~~`.** In page streams this ASCII marker occurs only inside type-62 bitmap records (7/7 markers). It also occurs in the Cache stream of 6 files, inside cached symbol data that is not a type-62 record. **O**. <!-- EXT-6.9-009 -->

### 6.10 Net identity across a page

- Every scalar wire's net id names a SchematicNet on the same page (82605 wires); every bus wire's names a NetBus (2884). **S**. <!-- EXT-6.6-005 EXT-6.7-008 -->
- Net-name row ids name a SchematicNet or a NetBus (§6.8). NetBus member ids are SchematicNet ids on the same page (§6.7).
- Pin and connector links to wires and nets are in chapter 7 (§7.5, §7.10, §7.11).

### 6.11 Links to the Schematic and Library streams

- Every non-zero name index and every library index of a type 13, 12, 23, 37, 38, 65 or 77 record resolves inside the Library string table (15009 + 174 + 2135 + 8342 + 6491 + 443 + 2066 records), and every library index names a non-empty string. **O**. <!-- EXT-1.3.3-003 -->
- The Schematic header's id registry holds every part id, every wire id and every wired pin's connection field (162/162 schematics). Its `max_id` is at or above every page `db_id` on 160/162 schematics; 2 schematics have a few ids above it. **O**. <!-- EXT-18.10.2-013 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| Library default pin-to-pin is always 100 | EXT §4.9 | 100 on 97 of 105 default blocks, 2540 on 5 (for example `SENSOR_BOARD.DSN`, `CutiePi_V2.3-20210409.DSN`), 1000 on 3 (`8MICS.DSN`, `STM32F746NGH V1.1_last.DSN`); 2540 goes with IsMetric 1 | **O** | <!-- EXT-4.9-010 --> |
| Library default IsMetric is always 0 | EXT §4.9 | 0 on 97 of 105, 1 on 8 | **O** | <!-- EXT-4.9-035 --> |
| NetBus member count is 0 | EXT §6.7 | 1212/1212 lists are non-empty, 12130 members (§6.7) | **O** | <!-- EXT-6.7-006 --> |
| Bus nets have no net-name row | EXT §6.7, §6.8 | 1212 rows name a NetBus (§6.8) | **O** | <!-- EXT-6.7-009 --> |
| Lists 2 and 3 hold graphical primitives (`T0x34`, `T0x35`) | INT §7 | The layout holds, but type 52 and 53 records are the SchematicNet and NetBus net headers (§6.6, §6.7) | **S** | <!-- INT-7-007 INT-7-008 --> |

The partial claims behind the "known values" columns above also overstate their lists: EXT gives page width, height, zone-count and band-width value sets and list count ranges that the corpus exceeds (42200, 20000, 23000 wide pages; heights 32200, 18000, 17000, 10200; horizontal count 4; band widths 10000, 5000, 3048; list counts far above EXT's ranges). The tables state the values seen. <!-- EXT-6.4-011 EXT-6.4-013 EXT-6.4-016 EXT-6.4-021 EXT-6.5-003 EXT-6.5-004 EXT-6.5-005 EXT-6.5-006 EXT-6.5-008 EXT-6.5-011 EXT-6.5-012 -->

### Unverified

- *Unverified.* The page size name is a label only, and the page dimensions are the width and height in PageSettings. The three `Custom` pages, with non-standard sizes, are consistent with this, but confirming it needs Capture. <!-- EXT-6.3-004 -->
- *Unverified.* The `u16` at PageSettings +0x2A is alignment padding the writer leaves uninitialised. Its values (0, printable bytes, other) fit that reading, but intent cannot be read from files. <!-- EXT-6.4-019 -->
- *Unverified.* Label colour 12 occurs together with horizontal labels are characters 1, vertical labels are characters 0, title block printed 0, ANSI grid references 0 and an empty page size name. No page has label colour 12. <!-- EXT-6.4-049 -->
- *Unverified.* A SchematicNet's colour, line style and line width are the net's display defaults: a wire whose own colour is 48, width 3 or style 5 is drawn with the net's value for that attribute. Every net in the corpus is 48 / 5 / 3, so no override can be observed. <!-- EXT-6.6-012 -->
- *Unverified.* A net whose three format words are 48 / 5 / 3 has no override. All 27130 nets have those values; the meaning needs Capture. <!-- EXT-6.6-013 -->
- *Unverified.* For a PageSettings flag that always has the same value, its meaning is its name. Not testable from files. <!-- EXT-16.7.4-017 -->
- *Unverified* (writer guidance). To write PageSettings, copy the 156 bytes from the source and change only the modelled fields, keeping +0x24 and +0x2A as they are. A round-trip test would need Capture. <!-- EXT-4.9-051 -->
- *Unverified* (listed values never seen). These listed values occur in no file, so each claim is partial: Library default vertical count 0, 5, 10; default horizontal labels are characters 1, horizontal ascending 1, vertical ascending 1; default grid reference displayed, grid reference printed, title block displayed, title block printed and ANSI grid references 0; page size name empty; page vertical count 1, 5, 100; +0x2A `FF FF`; label colour 12; page horizontal labels are characters 1, vertical labels are characters 0; page grid reference displayed, grid reference printed, title block printed and ANSI grid references 0; list 1 count 2, list 6 counts 170-256, list 8 counts 91-172, list 9 counts 100-266, list 12 counts 180-406 and graphic types 57 and 88; SchematicNet line style 0, 1 and line width 0, 1; and, among the page-settings flag value lists, horizontal labels are characters 1 on pages and in the default block, horizontal ascending 1 and vertical ascending 1 in the default block, vertical labels are characters 0 on pages, grid reference displayed, grid reference printed, title block printed and ANSI grid references 0 on pages and in the default block, and title block displayed 0 in the default block. <!-- EXT-4.9-013 EXT-4.9-029 EXT-4.9-031 EXT-4.9-034 EXT-4.9-038 EXT-4.9-039 EXT-4.9-040 EXT-4.9-041 EXT-4.9-042 EXT-6.3-003 EXT-6.4-017 EXT-6.4-018 EXT-6.4-024 EXT-6.4-035 EXT-6.4-038 EXT-6.4-044 EXT-6.4-045 EXT-6.4-047 EXT-6.4-048 EXT-6.5-002 EXT-6.5-007 EXT-6.5-009 EXT-6.5-010 EXT-6.5-013 EXT-6.6-010 EXT-6.6-011 EXT-16.6.1-013 EXT-16.7.4-004 EXT-16.7.4-006 EXT-16.7.4-007 EXT-16.7.4-009 EXT-16.7.4-012 EXT-16.7.4-013 EXT-16.7.4-014 EXT-16.7.4-015 EXT-16.7.4-016 -->

### Open questions

- **PageSettings +0x2A.** What the `u16` is. Data: in pages 0 ×369, two printable bytes ×45, other ×37 (never `FF FF`); in default blocks 0 ×80, printable ×6, other ×19. <!-- EXT-4.oq-003 -->
- **Library default block, empty form.** EXT describes an empty form of the default block (zero zone counts and widths, flags flipped). No such block occurs in 105 files; width and height are 0 in all 105 default blocks, and why is not known. <!-- EXT-4.oq-004 EXT-4.9-050 -->
- **Default created and modified.** Why both are 0 in the default block (105/105). <!-- EXT-4.oq-005 -->
- **Lists 13 and 14.** Their record types and contents are unknown; both are empty on 451/451 pages. EXT suggests list 13 may hold stand-alone no-connect symbols; no record of that kind appears in any list and no cached pin sets IsNoConnect (0/59179), so the files give no case to test and list 14 drawn instances; all 174 drawn instances are in list 6. <!-- EXT-6.oq-001 EXT-6.5-014 EXT-6.5-015 EXT-6.9-001 EXT-6.9-002 EXT-6.9-003 EXT-6.9-004 -->
- **Page extension sub-record.** The meaning of the 19-byte page preamble extension (kind 0, version 2, payload value 1). It never occurs: the extension is empty on 451/451. <!-- EXT-6.oq-002 -->
- **Bookmark instances.** Where type 78 records are stored and what their layout is. None occurs in any page list or Cache table. <!-- EXT-6.oq-003 EXT-6.9-006 -->
- **NetBus member lists (answered).** EXT asked what non-empty member lists look like. They are the norm: 1212/1212 have 2 to more than 20 members, each a SchematicNet id of the same page, and bus net ids also get net-name rows (§6.7). <!-- EXT-6.oq-004 -->

<!-- meta: EXT-6-002 EXT-6.4-001 EXT-6.4-052 EXT-6.6-015 EXT-16.7.4-018 -->

Parser coverage: the parser reads the frame, page name and size name, the PageSettings width, height and IsMetric (to give the sheet size in inches), and lists 1 to 11 (title blocks with their fields, net headers, NetBus member ids, net-name rows, wires, instances, ports, Globals and off-page connectors with their 5-byte tails, ERC objects skipped by structure, bus entries); it does not read list 12 (page graphics) or the other PageSettings fields.

---

## 7. Page objects

Page objects are the records in the page lists of chapter 6: part instances with their pins, wires with their aliases, ports, Globals, off-page connectors, bus entries, title blocks and ERC objects. Counts come from the page check of 2026-11-20 over 451 page streams in 105 files (`checks/page/page-check.ts`); fixture comparisons use the Capture exports of the Cadence fixture designs (`scripts/dsn-vs-dat-coverage.ts`).

### 7.1 Object ids

- Every object record on a page carries a `db_id` unique on that page: instances, wires, connectors, ports, title blocks, ERC objects and graphics (types 13, 12, 20, 21, 23, 37, 38, 65, 77 and the page graphics). **S** (126289 `db_id`s, unique per page). <!-- EXT-7.17-001 EXT-3.9-002 -->
- The Schematic stream's id registry also carries object ids: it holds every part and wire id. **O** (162/162 schematics). <!-- EXT-3.9-002 -->
- Net ids are a separate id space (§6.6): a net id never equals a `db_id` on the same page. **S** (28342 net ids). <!-- EXT-7.17-002 -->
- Display properties, pin instances, aliases and bus entries have no `db_id`; their bodies are fully accounted for without one. **S**. <!-- EXT-7.17-005 -->

### 7.2 Graphic-instance base

The graphic-instance base is the common start of the body of types 12, 13, 23, 37, 38, 55–62, 65, 77, 88 and 89. **S** (decodes on every record of these types; type 88 does not occur). <!-- EXT-7.1-001 EXT-8.9.1-024 --> `B+` offsets count from the body start; `S+` offsets count from the `db_id`, after the variable-length symbol name.

| Offset | Type | Field | Meaning and values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| B+0x00 | u32 | name index | string index of the instance name; every non-zero value resolves in the string table | **S** | <!-- EXT-7.1-002 --> |
| B+0x04 | u32 | library index | string index of the source library. 0 on all 6140 graphics and 174 drawn instances; non-zero and naming a non-empty string on every 13, 23, 37, 38, 65 and 77 record | **S** | <!-- EXT-7.1-003 --> |
| B+0x08 | lstr | symbol name | name of the cached symbol. Empty on graphics and drawn instances, non-empty on every other base record | **S** | <!-- EXT-7.1-004 --> |
| S+0x00 | u32 | `db_id` | object id, unique on the page | **S** (126289) | <!-- EXT-7.1-005 --> |
| S+0x04 | i16 | bbox y1 | bounding box, stored y before x | **S** | <!-- EXT-7.1-006 --> |
| S+0x06 | i16 | bbox x1 | | **S** | <!-- EXT-7.1-007 --> |
| S+0x08 | i16 | bbox y2 | | **S** | <!-- EXT-7.1-008 --> |
| S+0x0A | i16 | bbox x2 | | **S** | <!-- EXT-7.1-009 --> |
| S+0x0C | i16 | loc x | placement anchor, page coordinates (1/100 in) | **O** | <!-- EXT-7.1-010 --> |
| S+0x0E | i16 | loc y | | **O** | <!-- EXT-7.1-011 --> |
| S+0x10 | u16 | transform | §7.3 | **S** | <!-- EXT-7.1-012 --> |
| S+0x12 | u8 | type echo | equals the record's type byte on every base record | **S** | <!-- EXT-7.1-013 --> |
| S+0x13 | u8 | reserved | arbitrary: 0, a printable ASCII code or another value, in every record type; preserve on rewrite | **O** | <!-- EXT-7.1-014 --> |
| S+0x14 | u16 | display count `n` | | **S** | <!-- EXT-7.1-015 --> |
| S+0x16 | `n` × record 39 | SymbolDisplayProp | body exactly 14 bytes; each ends at its R1 | **S** (65096 records) | <!-- EXT-7.1-016 --> |
| next | u8 | symbol kind | §7.2.1 | **S** | <!-- EXT-7.1-017 EXT-16.6.2-001 --> |
| next | record | inline object | only after kind 2 (all 6140 graphics) and in drawn instances (174); nothing elsewhere | **S** | <!-- EXT-7.1-018 --> |

**Bounding box order.** Read as `y1, x1, y2, x2`, every non-zero box has `x1 ≤ x2` and `y1 ≤ y2` (36,301 boxes) and contains the location for types 12, 13, 23, 37 and 38 (31,780/31,780). Read as `x1, y1, x2, y2`, the location falls inside only 543. **S**. <!-- EXT-7.1-006 -->

**Location against the box.** Whenever the box is non-zero, the location lies inside it for placed instances (14638/14638), drawn instances (174/174), ports (2135/2135), off-page connectors (6491/6491) and Globals (8342/8342). **O**. <!-- EXT-7.1-020 EXT-7.1-010 EXT-7.1-011 --> For title blocks the location lies below the box (`loc y > y2`) on 443/443. **O**. <!-- EXT-7.1-021 --> For page graphics the box is not tied to the location: inside on 1324, outside on 689 of 2013 non-zero boxes. **O**. <!-- EXT-7.1-022 -->

#### 7.2.1 Symbol kind

The symbol-kind byte ends the base. It names the kind of symbol used, is constant per record type and is independent of the primitive word (24 on every placed word 0x0001, 0x0002, 0x0006, 0x0016, 0x8002). **S**. <!-- EXT-7.0.6-001 EXT-16.6.2-001 --> The kinds seen are exactly these, each in its stated record type: <!-- EXT-7.18-009 -->

| Kind | Symbol | Used by | What follows the byte | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| 2 | GraphicObject | page graphics 55–62, 88, 89 | one inline GraphicObject record (type 2, F = 3); R1 ends right after it | **S** (6140) | <!-- EXT-7.0.6-002 EXT-16.6.2-002 --> |
| 24 | LibraryPart | 13 PlacedInstance | nothing; R3 ends here; the symbol is the cached part named by the symbol name | **S** (15009) | <!-- EXT-7.0.6-003 EXT-16.6.2-003 --> |
| 24 | LibraryPart | 12 DrawnInstance | one inline LibraryPart record (type 24, F = 5); R2 ends after it | **S** (174) | <!-- EXT-7.0.6-004 EXT-16.6.2-004 --> |
| 33 | GlobalSymbol | 37 Global | nothing; R1 ends | **S** (8342) | <!-- EXT-7.0.6-005 EXT-16.6.2-005 --> |
| 34 | PortSymbol | 23 Port | nothing | **S** (2135) | <!-- EXT-7.0.6-006 EXT-16.6.2-006 --> |
| 35 | OffPageSymbol | 38 OffPageConnector | nothing | **S** (6491) | <!-- EXT-7.0.6-007 EXT-16.6.2-007 --> |
| 64 | TitleBlockSymbol | 65 TitleBlock | nothing | **S** (443) | <!-- EXT-7.0.6-008 EXT-16.6.2-008 --> |
| 75 | ErcSymbol | 77 ErcObject | nothing | **S** (2066) | <!-- EXT-7.0.6-009 EXT-16.6.2-009 --> |

### 7.3 Transform word

The transform is a `u16` at S+0x10. **S** (all base records). <!-- EXT-7.1-012 -->

| Bits | Meaning | Values seen |
| --- | --- | --- |
| 0–7 | colour index | 48, 43, 8, ... (placed: 48 on 14325, 43 on 684) |
| 8–9 | rotation `r` | 0–3 |
| 10 | mirror | 0, 1 |
| 11–15 | unused | always 0 |

The transform is one word followed by the type echo, not a rotation byte, a mirror byte and two unknown bytes. **S** (placed: echo 13 on 15009/15009). <!-- INT-7.7-009 -->

### 7.4 PlacedInstance (13)

A PlacedInstance is a library part placed on the page, and the central record for netlist extraction. **E** (15009 records; the parser's components match Capture's exports 6360/6360 on the fixtures). <!-- EXT-7.3-001 INT-7.7-001 --> It has exactly 4 full prefixes (15009/15009), and its short prefix carries the `(name_idx, value_idx)` property pairs (15009/15009). **S**. <!-- INT-7.7-002 --> Its preamble is always present: the extension is empty on 11700 and 37, 39 or 40 bytes on the rest. **S** (15009/15009). <!-- INT-7.7-003 -->

| Offset | Type | Field | Meaning and values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| B+0x00 | u32 | name index | internal instance name: `INS` + decimal digits on 15001 (the digits are never the `db_id`), another string on 8; 0 and past-table values not seen | **O** | <!-- EXT-7.3-003 INT-7.7-004 --> |
| B+0x04 | u32 | library index | source library; non-zero on 15009/15009 | **O** | <!-- EXT-7.3-004 INT-7.7-004 --> |
| B+0x08 | lstr | symbol name | cached LibraryPart, for example `RES.Normal`; non-empty on 15009/15009, 14841 resolve to a cached part | **O** | <!-- EXT-7.3-005 INT-7.7-005 --> |
| S+0x00 | u32 | `db_id` | unique on the page, held by the Schematic registry | **S** | <!-- EXT-7.3-006 INT-7.7-006 --> |
| S+0x04 | 4 × i16 | bbox y1, x1, y2, x2 | all zero on 371; of 14638 non-zero boxes 14630 contain the location and every pin point, 8 do not (for example `CLAYR6.DSN` J3, J6) | **O** | <!-- EXT-7.3-007 INT-7.7-007 --> |
| S+0x0C | i16 | loc x | placement anchor (§7.7) | **O** | <!-- EXT-7.3-008 INT-7.7-008 --> |
| S+0x0E | i16 | loc y | | **O** | <!-- EXT-7.3-009 INT-7.7-008 --> |
| S+0x10 | u16 | transform (§7.3) | colour 48/43, rotation 0–3, mirror 0/1, bits 11–15 zero | **S** (15009) | <!-- EXT-7.3-010 --> |
| S+0x12 | u8 | type echo | 13 | **S** (15009/15009) | <!-- EXT-7.3-011 --> |
| S+0x13 | u8 | reserved | 0 ×7381, printable ×3259, other ×4369 | **O** | <!-- EXT-7.3-012 --> |
| S+0x14 | u16 | display count | 1–9 seen (0 not seen) | **S** | <!-- EXT-7.3-013 INT-7.7-010 --> |
| S+0x16 | records 39 | displays | | **S** (15009) | <!-- EXT-7.3-014 INT-7.7-010 --> |
| next | u8 | symbol kind | 24; R3 ends here | **S** (15009/15009) | <!-- EXT-7.3-015 INT-7.7-011 --> |
| next | lstr | reference designator | never empty, for example `R1`, `U5` | **E** (refdes match 6360/6360) | <!-- EXT-7.3-016 INT-7.7-012 --> |
| next | u32 | value index | string index of the part value; 0 on 2 of 15009 | **O** | <!-- EXT-7.3-017 INT-7.7-013 --> |
| +4 | u32 | contents library index | 0 on 15005 of 15009 | **O** | <!-- EXT-7.3-018 --> |
| +8 | u32 | contents view index | 0 on 14951 of 15009 (58 non-zero); never non-zero together with the contents library index | **O** (15009) | <!-- EXT-7.3-019 EXT-7.3-018 --> |
| +12 | u16 | primitive word (§7.4.1) | 0x0002, 0x8002, 0x0016, 0x0006, 0x0001 | **S** | <!-- EXT-7.3-020 --> |
| +14 | u16 | pin count `m` | 0 on 42; equals the cached symbol's pin-slot count on 14841/14841 cached instances | **O** | <!-- EXT-7.3-021 INT-7.7.1-002 --> |
| +16 | `m` × record 16/17 | pin instances (§7.5) | in cached-symbol pin order, ordinal = position 1..m (63616/63616); R2 ends after the last pin (15009/15009) | **S** | <!-- EXT-7.3-022 INT-7.7-015 --> |
| next | lstr | source package | cached Package; never empty | **E** (pin numbers 22234/22234) | <!-- EXT-7.3-023 INT-7.7-016 --> |
| next | u16 | device index | zero-based section within the package; 0–12 seen (0 ×14633 ... 12 ×1); R1 ends here | **E** (pin numbers 22234/22234) | <!-- EXT-7.3-024 INT-7.7-017 INT-7.7-022 --> |

- The 10 bytes between the value index and the pin count are the contents library index, the contents view index and the primitive word. **S**. <!-- INT-7.7-014 -->
- The device index is the 0-based section of a multi-section package: 0 for single-section parts, 0 to 7 for the eight sections of an `RPAK_10_8RES` pack, 0 and 1 for a dual transistor. It was found by correlating the eight RP3 instances of BeagleBoard-xM with the section order of that design's `pstxnet.dat`, where it reads 0 to 7 in order. **E** (pin numbers 22234/22234 on the fixtures). <!-- INT-7.7-022 INT-7.7-024 -->
- The reference, value index, source package, device index, symbol name, `db_id`, pins and property pairs are confirmed against Capture's exports (components 6360/6360, Value 6360/6360, pin numbers 22234/22234, nets 4601/4601). The location is checked structurally, since Capture does not export it. **E**. <!-- INT-7.7-018 -->

#### 7.4.1 Primitive word

The primitive word is a `u16` that ends the part-instance fields of both placed (13) and drawn (12) instances, just before the pin count. **S** (15009 placed, 174 drawn). <!-- EXT-7.3.1-001 EXT-16.6.3-001 -->

| Bits | Field | Values seen | Evidence | Ids |
| --- | --- | --- | --- | --- |
| 0–1 | IsPrimitive | 2 on 15177 of 15183 instances; 1 on 4 placed (word 0x0001, `ELEMENT-DVT.DSN` C84, C85); 0 on 2 drawn (word 0x0004, `EEM2TTL.DSN` IO1, IO2) | **O** | <!-- EXT-7.3.1-002 EXT-16.6.3-002 EXT-7.18-010 --> |
| 2–6 | contents view type | drawn: 1 on 174/174; placed: 0 ×14922, 1 ×29, 5 ×58 | **O** | <!-- EXT-7.3.1-004 EXT-16.6.3-004 EXT-16.5.7-002 EXT-16.5.7-003 --> |
| 7–14 | unused | always 0 (15183/15183) | **O** | <!-- EXT-7.3.1-006 EXT-16.6.3-005 --> |
| 15 | power pins visible (meaning by name only) | set on 81 placed, never on drawn | **O** | <!-- EXT-7.3.1-007 EXT-16.6.3-006 --> |

Words seen: placed 0x0002 ×14837, 0x8002 ×81, 0x0016 ×58, 0x0006 ×29, 0x0001 ×4; drawn 0x0006 ×172, 0x0004 ×2. **O**. <!-- EXT-7.3.1-008 EXT-7.3.1-009 EXT-16.6.3-007 --> EXT names the IsPrimitive values 0 explicit not primitive, 1 explicit primitive, 2 inherited from the design default, 3 unknown; the files cannot confirm these names (see Unverified).

#### 7.4.2 Part properties

The parser reads user properties from the short prefix's `(name_idx, value_idx)` pairs and resolves them in `component-builder.ts`. **T**. <!-- INT-7.7-025 -->

- Pairs are kept in the order Capture wrote them, and that order carries no precedence. The consumer applies precedence by scanning its key list as the outer loop and the record's pairs as the inner loop. **T**. <!-- INT-7.7-026 -->
- `mpn` comes from the first match of `Manufacturer PN`, `MANUFACTURER_PN`, `Manufacturer Part Number`, `Vendor Part Number`, `Vendor P/N`, `MF_PART_NUMBER`, `MPN`. **T**. <!-- INT-7.7-027 --> `MPN` is last because libraries often fill it by hand with whatever was nearby, commonly the symbol's own name, so every more specific spelling goes first. **T** (position verified; the rationale is design intent). <!-- INT-7.7-030 -->
- `internal_pn` comes from `PART_NUMBER`, `Part Number`, `PART NUMBER`, `PN`. **T**. <!-- INT-7.7-028 -->
- `manufacturer` comes from `Manufacturer`, `MANUFACTURER`, `Manufacture`; an MPN identifies a part only within a manufacturer. **T**. <!-- INT-7.7-029 -->
- A pair whose value is the empty string is skipped, not taken as a match. **T**. <!-- INT-7.7-031 -->
- `mpn`, `internal_pn` and `manufacturer` have no fallback to one another or to the source package; each is omitted when absent. **T**. <!-- INT-7.7-032 -->
- Distributor numbers (`Mouser Part Number`, `Arrow Part Number`, `Supplier Part Number`) feed none of the three. Verified by the key lists. <!-- INT-7.7-033 -->
- Value is resolved from, in order: the property pair named `Value`; the value index in the body; the LibraryPart's default value in its general properties. DNS markers in the resolved value are then stripped. **E** (Value 6360/6360, DNS 76/76). <!-- INT-7.7-035 INT-7.7-036 INT-7.7-037 INT-7.7-038 --> Only 2 of 15009 placed instances carry a `Value` pair at all, since the value normally lives in the body value index; on both, the pair and the body index name the same string. **O**. <!-- EXT-7.3-017 -->

### 7.5 Pin instances (16, 17)

A pin instance is nested inside a placed or drawn instance, one per cached-symbol pin, and is never a list record. **S** (63616 pin records; count equals the symbol's slots). <!-- EXT-7.4-001 --> Type 16 (ScalarPinInstance) holds 62620 pins. Type 17 (BusPinInstance) holds 996 pins, all on drawn instances, each matching a type-27 bus pin of the inline part at the same position; drawn instances also have 2304 type-16 pins matching type-26 pins, and placed instances 59179 type-16 pins matching type-26 cached pins plus 1137 type-16 pins on the 168 instances whose symbol is not cached (63616 in all). Both types have the same layout. **S**. <!-- EXT-7.4-002 INT-7.7.2-020 --> The preamble is always present and empty. **S**. <!-- INT-7.7.1-003 -->

| Offset | Type | Field | Meaning and values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u16 | pin word | pin ordinal and flag (below) | **E** (63616; pin numbers 22234/22234) | <!-- EXT-7.4-004 INT-7.7.1-004 --> |
| +0x02 | i16 | x | pin connection point, page coordinates | **S** (63616) | <!-- EXT-7.4-005 INT-7.7.1-005 --> |
| +0x04 | i16 | y | | **S** | <!-- EXT-7.4-006 INT-7.7.1-005 --> |
| +0x06 | u32 | `wire_id` | 0 ×4265; `0xFFFFFFFF` ×840; otherwise the `db_id` of a wire on the same page with an endpoint exactly at the pin point (×58511). No other value occurs. | **S** (63616) | <!-- EXT-7.4-007 --> |
| +0x0A | u32 | `net_id` | 0 on 62682; non-zero on 934, each a SchematicNet id of the same page | **S** | <!-- EXT-7.4-008 --> |
| +0x0E | u16 | display count | 0 ×62566, 1 ×1044, 2 ×6 | **S** | <!-- EXT-7.4-009 INT-7.7.1-008 --> |
| +0x10 | records 39 | displays | the record (R1) ends after them | **S** (63616/63616) | <!-- EXT-7.4-010 EXT-7.4-011 INT-7.7.1-008 --> |

**Pin word.** A word below 0x8000 is the ordinal; a word at or above 0x8000 sets the flag, and the ordinal is `0x10000 − word`. The ordinal is the 1-based position in the cached symbol's pin list: decoding this way gives ordinal = position on all 63616 pins (60374 below 0x8000, 3242 flagged), and pin numbers match Capture's `pstxnet.dat` 22234/22234 on the fixtures. **E**. <!-- EXT-2.4-005 EXT-7.4-004 INT-7.7.1-009 INT-7.7.1-010 INT-7.7.1-011 INT-13.4-002 --> The encoding comes from OpenOrCadParser; the parser treats both branches alike for the pin-map lookup and folds the flag away. **E** (pin numbers 22234/22234). <!-- INT-7.7.1-012 -->

**Pin-word flag.** The flag is neither "unconnected" nor "no-connect": 369 flagged pins have a wire ending at the pin point, and 1402 unwired pins (`wire_id` 0) are not flagged. **O**. <!-- EXT-7.4-018 --> Flagged pins are mostly unwired (2863 of 3242), and a pin with `wire_id = 0xFFFFFFFF` almost never has it (10 of 840). **O**. <!-- EXT-7.4-020 --> It is unrelated to the cached pin's shape flags: IsNoConnect (0x100) is never set on any cached pin (59179), and the shape mix of flagged pins (0x21 ×2607, 0x20 ×505, ...) mirrors that of unflagged pins (0x21 ×29850, 0x20 ×25234, ...). **O**. <!-- EXT-7.4-019 -->

| Pin-word flag | `wire_id` = wire ending at the pin | `wire_id` = 0 | `wire_id` = `0xFFFFFFFF` |
| --- | --- | --- | --- |
| clear | 58142 | 1402 | 830 |
| set | 369 | 2863 | 10 |

Scope of the table: all 63616 part and block pins on 451 pages in 105 files, with "wired" meaning `wire_id` names a wire ending at the pin. Chapter 11 counts 367 / 1401 / 3217 by the same definition over 104 of those files (62873 pins): its connectivity check skips `SENSORS EXPO DEMO_12MAY2016_1200.DSN`, whose root Hierarchy stream it cannot decode, and that file holds 743 pins, 25 flagged (2 flagged wired, 1 unflagged with `wire_id` 0). **S**.

**Connection fields.** `net_id` is non-zero only on pins with no wire in `wire_id`: the 840 pins with `wire_id = 0xFFFFFFFF` (every one of them) and 94 pins with `wire_id = 0`. Of these 934, 933 have no scalar wire at the pin point and 1 sits at a scalar wire end (`DECADECOUNTER.DSN` PAGE1, pin at (400,140)). **S**. <!-- EXT-7.4-008 --> No pin names a wire that does not end at it, and none holds a non-wire id in `wire_id`. **S**. <!-- EXT-7.4-007 --> `wire_id = 0` means no wire touches the pin on 4262 of 4265 such pins; the exceptions are that same `DECADECOUNTER.DSN` pin at a scalar wire end and 2 pins on a wire body (`reServer industrial J401 Carrier Board v11.DSN` pages 27 and 28). **S**.

A pin with no wire is on the SchematicNet its `net_id` names. Where a page wire carries that id, the pin is on that wire's net; where none does, the pins sharing the `net_id` form one net. **E** (Capture's exports on 31 corpus designs: every such pin on a multi-pin export net is on that net, including hidden power pins such as `SENSOR_BOARD.DSN` U1.18 on 5V and U1.20 on 3V3).

### 7.6 DrawnInstance (12)

A DrawnInstance is a hierarchical block drawn on a page, one placement of a child schematic. It sits in list 6 with the placed instances and shares their layout up to the display properties; where a placed instance goes on to its reference, a drawn instance embeds the block's symbol as an inline LibraryPart. **S** (174 records). <!-- INT-7.7.2-002 --> It has exactly 3 full prefixes (174/174). **S**. <!-- INT-7.7.2-003 --> Its preamble is always present: extension empty on 118, 39 bytes on 56. **S**. <!-- INT-7.7.2-004 -->

| Offset | Type | Field | Meaning and values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| B+0x00 | u32 | name index | block name; non-zero on 174/174 | **O** | <!-- EXT-7.5-003 INT-7.7.2-005 --> |
| B+0x04 | u32 | library index | 0 on 174/174 | **O** | <!-- EXT-7.5-004 INT-7.7.2-005 --> |
| B+0x08 | lstr | symbol name | empty on 174/174 | **O** | <!-- EXT-7.5-005 INT-7.7.2-006 --> |
| S+0x00 | u32 | `db_id` | unique on the page, held by the Schematic registry; the Hierarchy stream's block occurrence names it | **S** | <!-- EXT-7.5-006 INT-7.7.2-007 --> |
| S+0x04 | 4 × i16 | bbox y1, x1, y2, x2 | contains the location and every pin on 174/174; never all zero | **O** | <!-- EXT-7.5-007 INT-7.7.2-008 --> |
| S+0x0C | 2 × i16 | loc x, loc y | inside the box on 174/174 | **S** | <!-- EXT-7.5-008 INT-7.7.2-009 --> |
| S+0x10 | u16 | transform (§7.3) | rotation 0–3, mirror 0/1, colour 48 | **S** | <!-- EXT-7.5-009 INT-7.7.2-010 --> |
| S+0x12 | u8 | type echo | 12 on 174/174 | **O** | <!-- EXT-7.5-010 --> |
| S+0x13 | u8 | reserved | non-zero on 57 of 174 | **O** | <!-- EXT-7.5-010 --> |
| S+0x14 | u16 | display count | 2 on 154, 1 on 20 | **O** | <!-- EXT-7.5-011 INT-7.7.2-011 --> |
| S+0x16 | records 39 | displays | | **S** (174) | <!-- EXT-7.5-012 INT-7.7.2-011 --> |
| next | u8 | symbol kind | 24 on 174/174 | **S** | <!-- EXT-7.5-013 INT-7.7.2-012 --> |
| next | record 24 | inline LibraryPart | the block symbol, F = 5; its symbol pins stand for the hierarchical ports in pin order; R2 ends after it | **S** (174/174) | <!-- INT-7.7.2-013 --> |
| next | lstr | reference | the instance name, for example the `BLK1` of flat net name `N00439_BLK1`; non-empty on 174/174 | **S** | <!-- EXT-7.5-015 INT-7.7.2-014 --> |
| next | u32 | value index | non-zero on 173 of 174; 0 on `ROHM_SENSOR_PLATFORM_BASE_BOARD_SCH_REV02_20140918.DSN` `FTDI IC` | **O** | <!-- EXT-7.5-016 INT-7.7.2-015 --> |
| +4 | u32 | contents library index | 0 on 155; non-zero on 19 (for example `CLAYR6.DSN` IMU, I2C_PULL_UP), and on those 19 the contents view index is non-zero too | **O** | <!-- EXT-7.5-017 --> |
| +12 | u16 | primitive word (§7.4.1) | | **S** (174) | <!-- EXT-7.5-019 --> |
| +14 | u16 | pin count | equals the inline part's pin-slot count; pin record types match by position (16 with 26, 17 with 27) | **S** (174/174) | <!-- EXT-7.5-020 INT-7.7.2-019 --> |
| +16 | records 16/17 | pin instances (§7.5) | R1 ends after the last pin | **S** (174/174) | <!-- EXT-7.5-021 INT-7.7.2-017 --> |

- The 10 bytes after the value index are the contents library index, the contents view index and the primitive word. **S**. <!-- INT-7.7.2-016 -->
- Pin `i` stands for the `i`-th symbol pin of the inline part, which is how a pin is matched to the port it represents. **S** (174/174). <!-- INT-7.7.2-019 -->
- A drawn instance has no source package, no device index and no symbol name: R1 ends after the last pin on 174/174. The child schematic is named by the Hierarchy stream's block occurrence with the same `db_id` (not checked here). **S**. <!-- INT-7.7.2-022 -->

### 7.7 Placement of symbol points

A symbol point `(x, y)` reaches the page through the transform word (§7.3): mirror negates x first, then rotation `r = 1` maps the point to `(y, −x)`, `r = 2` to `(−x, −y)`, `r = 3` to `(−y, x)`. The page point is the transformed point plus an offset `(ox, oy)` that makes the transformed placement box start at the stored location: `ox = loc x − min x`, `oy = loc y − min y`, over the four transformed corners of the placement box. On each axis with box extent `(lo, hi)`, the placement extent is `(0, snap(lo + hi))` if `lo ≥ 0`, otherwise `(lo, lo + snap(hi − lo))`, where `snap` rounds up to a multiple of 10. **O (partial)**.

The box to use is the symbol's stored `bbox` field, not the box of its primitives. Both checks agree on that; their counts differ because they ran on different corpora:

| Box used | 2026-11-19 pass, 106 designs: connectors (pin lands on its trailer wire's endpoint) | 2026-11-19 pass: placed parts (every stored pin point reproduced) | 2026-11-20 page check, 105 files: placed parts with a cached symbol |
| --- | --- | --- | --- |
| Stored `bbox` field | 17,596 of 17,604 | 16,003 of 16,087 | 14757 of 14841 |
| Primitives | 17,212 of 17,604 | 15,261 of 16,087 | 14053 of 14841 (788 miss) |

A placed part's stored pin points follow this anchoring rule on 14053/14841 instances; 788 miss under the primitive box (84 miss under the stored box, which hits 14757/14841). **O**. <!-- EXT-2.5.2-010 EXT-7.3-008 --> Pins of a placed part are spaced by multiples of 10 coordinate units on both kinds of page, apart from 9 exceptions: 14014/14023 placed and 168/168 drawn instances with at least two pins. One unit is 254 µm, so the metric pin-to-pin pitch of 2540 µm is 10 units. **O**. <!-- EXT-2.5.1-011 -->

The rule is not fully verified: 8 connectors and 84 parts in the first pass, and 84 parts in the second, do not fit, and why is not established.

The page renderer places every symbol by this rule with the stored box, and the parser places each connector's single pin by it to find the connector's connection point (§11.4). A test (`render-page.test.ts`) puts every cached pin's hot point exactly on the page pin it draws for every placed part with a cached symbol on the `MULTIO.DSN` and `meta_carrier_sch_rev1.dsn` fixtures. **T**.

### 7.8 Wires (20, 21)

A wire is type 20 (scalar, 82605) or type 21 (bus, 2884). **S**. <!-- INT-7.6-001 --> Its preamble is always present, with an empty extension except on 32 bus wires (39 bytes). **S** (85489/85489). <!-- INT-7.6-002 -->

| Offset | Type | Field | Meaning and values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| B+0x00 | u32 | `db_id` | wire id, unique on the page, never equal to the net id | **S** (85489) | <!-- EXT-7.7-002 INT-7.6-003 --> |
| B+0x04 | u32 | net id | a SchematicNet (type 20, 82605/82605) or NetBus (type 21, 2884/2884) on the same page; its names are keyed in the net-name table | **E** (nets 4601/4601) | <!-- EXT-7.7-003 INT-7.6-004 --> |
| B+0x08 | u32 | colour index | 48 on 85469, 8 on 20 | **O** | <!-- EXT-7.7-004 INT-7.6-005 --> |
| B+0x0C | i32 | start x | page coordinates; every value fits in i16 | **S** (85489) | <!-- EXT-7.7-005 INT-7.6-006 --> |
| B+0x10 | i32 | start y | | **S** | <!-- EXT-7.7-006 INT-7.6-006 --> |
| B+0x14 | i32 | end x | | **S** | <!-- EXT-7.7-007 INT-7.6-006 --> |
| B+0x18 | i32 | end y | | **S** | <!-- EXT-7.7-008 INT-7.6-006 --> |
| B+0x1C | u8 | junction flags | bit 0 dot at start, bit 1 dot at end, bits 2–7 always 0 | **S** | <!-- EXT-7.7-009 INT-7.6-007 --> |
| B+0x1D | u16 | alias count `a` | 0 ×69379, 1 ×16055, 2 ×55 | **S** | <!-- EXT-7.7-010 INT-7.6-008 --> |
| B+0x1F | `a` × record 49 | aliases (§7.9) | 16165 records | **S** | <!-- EXT-7.7-011 INT-7.6-008 --> |
| next | u16 | display count `d` | 0 on most wires; 1 on 79, 2 on 30 | **S** | <!-- EXT-7.7-012 INT-7.6-009 --> |
| next | `d` × record 39 | displays | 139 records in 109 wires, 14-byte bodies | **S** | <!-- EXT-7.7-013 INT-7.6-009 --> |
| next | u32 | line width | 3 ×85463, 1 ×20, 0 ×6 | **S** | <!-- EXT-7.7-014 INT-7.6-010 --> |
| +4 | u32 | line style | 5 on 85489; R1 ends here | **S** | <!-- EXT-7.7-015 INT-7.6-011 --> |

- Wires store line width before line style; net headers (§6.6) store style before width. **S** (85489 wires, 27130 net headers). <!-- EXT-7.7-019 INT-7.6-010 INT-7.6-011 -->
- Junction flags: bits 2–7 are 0 on all 85489 wires. Scalar wires take 0 ×66733, 1 ×5501, 2 ×7717, 3 ×2654. Bus wires take 0 on 2882 of 2884 and 2 on 2 (wire 24022190 on page `09-PL BANKS 34 & 35` of `parallella_schematic.dsn` and `parallella_e16_z7020_schematic.dsn`). **S**. <!-- EXT-7.7-009 EXT-7.7-016 -->
- Geometry: scalar wires are horizontal (49100), vertical (33497) or diagonal (8); bus wires are horizontal (1992) or vertical (892, for example `HB1A-AAFM.DSN` wire 5267866). **O**. <!-- EXT-7.7-020 -->
- 109 wires carry type-39 display records (for example `trs80_power.dsn` PAGE1 wire 14138). **O**. <!-- EXT-7.7-017 -->

### 7.9 Alias (49)

An alias is a net-name label placed on a wire: its name is a net-name row of its wire's net on 15774 of 16165. **O**. <!-- INT-7.6.1-001 --> It has prefixes of type 49 (F = 2) on 16165 records. **S**. <!-- INT-7.6.1-002 --> Its preamble is always present with an empty extension. **S** (16165/16165). <!-- INT-7.6.1-003 -->

| Offset | Type | Field | Meaning and values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | i32 | x | label position, page coordinates; fits in i16 | **S** (16165) | <!-- EXT-7.8-003 INT-7.6.1-004 --> |
| +0x04 | i32 | y | | **S** | <!-- EXT-7.8-004 INT-7.6.1-004 --> |
| +0x08 | u32 | colour index | 0–48 (48 ×15910) | **S** | <!-- EXT-7.8-005 INT-7.6.1-005 --> |
| +0x0C | u32 | rotation (as §7.3) | 0 ×14375, 1 ×1790 | **S** | <!-- EXT-7.8-006 INT-7.6.1-006 --> |
| +0x10 | u32 | font word | low 16 bits are a font index (0, 1, 7–32 seen); the high 16 bits are non-zero on 9406 of 16165, so the full word exceeds 50 there | **O** | <!-- INT-7.6.1-007 --> |
| +0x14 | lstr | name | label text, never empty; ends the record | **S** (16165) | <!-- EXT-7.8-008 INT-7.6.1-008 --> |

### 7.10 Port (23)

A Port is a hierarchical port. Its body is the graphic-instance base (name index = port name, library index = source library, symbol name = cached PortSymbol), then a 9-byte trailer. **S** (2135/2135). <!-- EXT-7.9-004 INT-13.4-013 --> All ports use three full prefixes. **S** (2135). <!-- EXT-7.oq-010 --> In the base: symbol kind 34, colour 48, 1 display, and R2 ends after the kind byte on 2135/2135; rotation 0 or 2 on most, 1 on 92 and 3 on 36; mirror 1 on 391 (for example `meta_carrier_sch_rev1.dsn` TILE_AD9523 port 7671152). **O**. <!-- EXT-7.9-004 -->

| Trailer offset | Type | Field | Values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0 | u32 | `wire_id` | scalar wire ×1566, bus wire ×276, 0 ×293 | **S** | <!-- INT-13.3-010 --> |
| +4 | u8 | flag | 0 ×1773, 1 ×362 | **O** | <!-- EXT-7.9-006 --> |
| +5 | u32 | port type | 0 ×567, 1 ×642, 2 ×668, 4 ×196, 7 ×62; R1 ends here | **S** | <!-- EXT-7.9-007 --> |

The port flag is 1 on all 276 ports whose trailer wire is a bus wire and on 86 of the 293 ports with `wire_id` 0, and 0 on all 1566 ports whose trailer wire is scalar. **O** (new). <!-- EXT-7.9-006 -->

### 7.11 Global (37) and OffPageConnector (38)

A Global or off-page connector body is the graphic-instance base, and the record ends after the symbol-kind byte. **S** (8342 Globals and 6491 off-page connectors end at R1 right after it). <!-- EXT-7.10-003 --> The library index is the source library (non-zero, naming a non-empty string, on 14833/14833). **O**. <!-- EXT-7.10-005 --> The symbol name is the cached GlobalSymbol or OffPageSymbol (8342 and 6491 all found in the Cache). **O**. <!-- EXT-7.10-006 --> The kind is 33 for a Global (8342/8342) and 35 for an off-page connector (6491/6491). **S**. <!-- EXT-7.10-007 -->

Displays and colour: Globals have 0 or 1 displays and colour 48 (×8329) or 8 (×13); off-page connectors have 2 displays (×4941), 1 (×1116) or 0 (×434), and colour 48. **O**. <!-- EXT-7.10-008 -->

Each record in lists 8 and 9 is followed by 5 bytes outside its region. **S** (14833). <!-- EXT-7.10-011 EXT-3.7-015 INT-13.4-012 -->

| Tail offset | Type | Field | Globals (8342) | Off-page connectors (6491) | Evidence | Ids |
| --- | --- | --- | --- | --- | --- | --- |
| +0 | u32 | `wire_id` | scalar wire ×8127, 0 ×215 | scalar wire ×6239, bus wire ×226, 0 ×26 | **S** | <!-- INT-13.3-011 --> |
| +4 | u8 | flag | 0 on all | 1 on 226, exactly the connectors whose tail wire is a bus wire; 0 on the rest | **O** | <!-- EXT-7.10-013 --> |

Across ports, Globals and off-page connectors, a non-zero trailer `wire_id` always names a wire on the same page, and the flag is 1 on every one of the 502 connectors whose trailer wire is a bus wire and 0 on every one whose trailer wire is scalar. **O** (new). <!-- EXT-7.10-013 EXT-7.9-006 -->

### 7.12 BusEntry (29)

A bus entry body is exactly 28 bytes; it has F = 2, a short-prefix count of 0 and an empty extension. **S** (1688). <!-- EXT-7.11-011 -->

| Offset | Type | Field | Values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | header word | 48 on 1688/1688; meaning open | **O** | <!-- EXT-16.2.4-014 --> |
| +0x04 | i32 | first point x | | **S** (1688) | <!-- EXT-7.11-004 --> |
| +0x08 | i32 | first point y | | **S** | <!-- EXT-7.11-006 --> |
| +0x0C | i32 | second point x | | **S** | <!-- EXT-7.11-007 --> |
| +0x10 | i32 | second point y | | **S** | <!-- EXT-7.11-009 --> |
| +0x14 | 8 bytes | reserved | 0 on 1688/1688 | **S** | <!-- EXT-7.11-010 --> |

- A bus entry has no `db_id`; it is identified by geometry or position. **S** (body fully accounted for, 1688). <!-- EXT-7.11-011 -->
- Every bus entry is a 45° segment with `|dx| = |dy| = 10`. **O** (1688/1688). <!-- EXT-7.11-012 -->

### 7.13 TitleBlock (65)

A page has zero or one TitleBlock record in list 1 (0 on 8 pages, 1 on 443; 2 not seen). **S**. <!-- EXT-7.12-001 --> It uses three full prefixes (443). **S**. <!-- EXT-7.oq-010 --> The body is the graphic-instance base (name index = the `Name` property, library index = source library, symbol name = cached TitleBlockSymbol): symbol kind 64, mirror 0, colour 48, 5–12 displays, and R2 ends after the kind byte on 443/443; rotation 0 on all but one (`buddy_sch_rev1.dsn` DUT_PARALLEL, rotation 1); the `Name` equals the symbol name on 434 of 443. **O**. <!-- EXT-7.12-003 --> The TitleBlock's short prefix carries the title-block fields as `(name, value)` string-table pairs: the names resolve to field names on every title block, among them `RevCode` (417 of 417 distinct title blocks), `Page Count` (341), `Page Number` (335), `OrgName` (303), `Title` (281), `Cage Code` (243), `OrgAddr1` to `OrgAddr4` (about 235 each), `Doc` (169) and `Drawing` (116). **O** (new; 417 distinct pages, duplicate copies counted once).

A 12-byte trailer follows:

| Trailer offset | Type | Field | Values | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0 | u32 | keep in lower-right corner | 1 ×423, 0 ×20; no other value | **S** | <!-- EXT-7.12-004 EXT-16.6.6-001 EXT-16.6.6-004 --> |
| +4 | u32 | page count | 0–33 seen | **S** | <!-- EXT-7.12-005 --> |
| +8 | u32 | page number | 0–32 seen; ≤ page count on 443/443 | **S** | <!-- EXT-7.12-006 --> |

The parser skips title blocks by their prefix chain; a full decode of all 443 confirms the skip lands on the next record. **S**. <!-- INT-7.1-001 INT-13.2-006 -->

### 7.14 ErcObject (77)

An ErcObject body is the graphic-instance base followed by three `lstr`. **S** (2066). <!-- EXT-7.13-003 -->

- Base: symbol name = cached ErcSymbol, never empty; symbol kind 75; no displays; rotation 0, mirror 0, colour 48; bbox all zero on 1; library index names a non-empty string; R2 ends after the kind byte. All on 2066/2066. **S**. <!-- EXT-7.13-003 --> All ERC objects use three full prefixes (2066). **S**. <!-- EXT-7.oq-010 -->
- Then: `lstr` error message (empty on 30), `lstr` detail text (empty on 30), `lstr` location text (empty on 107); R1 ends after the location on 2066/2066. **S**. <!-- EXT-7.13-004 EXT-7.13-005 EXT-7.13-006 -->

### 7.15 Net headers as records

SchematicNet (52) and NetBus (53) are specified in §6.6 and §6.7. As records:

- They start with one full prefix and have no short prefix and no preamble; the body fills the region exactly, and a NetBus continues with its member list after that boundary. **S** (27130 + 1212). <!-- EXT-9.7.1-001 EXT-9.7.1-008 EXT-3.7-014 INT-7.4-002 --> The full-prefix layout is: `u8` type 52 (`0x34`), `u32` length, `u32` 0. **S** (27130). <!-- INT-7.3-002 INT-7.3-003 INT-7.3-004 -->
- Fields: `u32` net id at +0x09; `lstr` name at +0x0D, always empty; `u32` reserved 0; `u32` colour 48; `u32` line style 5; `u32` line width 3, which ends the record. **S** (28342 headers). <!-- EXT-9.7.1-002 EXT-9.7.1-003 EXT-9.7.1-004 EXT-9.7.1-005 EXT-9.7.1-006 EXT-9.7.1-007 EXT-9.7.1-009 EXT-16.2.4-011 INT-7.3-005 INT-7.3-006 INT-7.3-007 INT-7.3-008 INT-7.3-009 INT-7.3-010 -->
- A NetBus has the same fields, then `u16` member count and 4 bytes per member: each entry is a SchematicNet id (12130/12130). **S**. <!-- INT-7.4-001 INT-7.4-003 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| Type 52 is a simple graphical primitive outside the prefix system | INT §7.3 | It is the scalar net header, with one full prefix (§6.6) | **S** | <!-- INT-7.3-001 --> |
| NetBus trailing data is coordinates | INT §7.4 | 4 bytes per entry hold, but each entry is a member SchematicNet id (12130/12130) | **S** | <!-- INT-7.4-003 --> |
| Pin +0x06 is the net id; pin +0x0A is unknown | INT §7.7.1 | +0x06 is a wire `db_id` (58511), 0 (4265) or `0xFFFFFFFF` (840); +0x0A is the SchematicNet id on unwired pins (934) (§7.5) | **S** | <!-- INT-7.7.1-006 INT-7.7.1-007 --> |
| Pin-word bit 15 is a no-connect flag | INT §7.7.1, after OpenOrCadParser | 369 flagged pins are wired; 1402 unwired pins are unflagged (§7.5) | **O** | <!-- INT-7.7.1-009 INT-7.7.1-011 --> |
| Only type 16 pin instances occur | EXT §7.4 | 996 type-17 pins on drawn instances (§7.5) | **S** | <!-- EXT-7.4-002 --> |
| The 4 bytes before the displays are rotation, mirror and 2 unknown bytes | INT §7.7 | A `u16` transform (colour, rotation bits 8–9, mirror bit 10), then the type echo and a reserved byte (§7.3) | **S** | <!-- INT-7.7-009 --> |
| The bbox is four i16 as x1, y1, x2, y2 | INT §7.7 | The order is y1, x1, y2, x2: read that way 14630/14638 placed boxes contain the location and every pin; read as INT says, 63 do | **S** | <!-- INT-7.7-020 --> |
| PlacedInstance has 1..N full prefixes; DrawnInstance has 1..N | INT §7.7, §7.7.2 | Always 4 for placed (15009/15009) and 3 for drawn (174/174) | **S** | <!-- INT-7.7-002 INT-7.7.2-003 --> |
| Wire, pin, alias, placed and drawn preambles are optional | INT §7.6, §7.6.1, §7.7, §7.7.1, §7.7.2 | Always present on every record | **S** | <!-- INT-7.6-002 INT-7.6.1-003 INT-7.7-003 INT-7.7.1-003 INT-7.7.2-004 --> |
| Drawn S+0x12 is the word 0x000C (echo 12, reserved 0) | EXT §7.5 | The echo is 12, but the reserved byte is non-zero on 57 of 174 (for example `meta_carrier_sch_rev1.dsn` db 9396350, word 0x370C) | **O** | <!-- EXT-7.5-010 --> |
| A wire's display count is always 0 | EXT §7.7 | 1 on 79 wires, 2 on 30 (for example `trs80_power.dsn` wire 14138) | **S** | <!-- EXT-7.7-012 --> |
| Wire display records are not seen in real files | EXT §7.7 | 109 wires carry 139 of them | **O** | <!-- EXT-7.7-017 --> |
| Port trailer byte +4 is always 0 | EXT §7.9 | 1 on 362 of 2135 ports, tied to bus trailer wires (§7.10) | **O** | <!-- EXT-7.9-006 --> |
| Global/off-page tail byte +4 is always 0 | EXT §7.10 | 1 on the 226 off-page connectors with a bus tail wire (§7.11) | **O** | <!-- EXT-7.10-013 --> |
| Junction flags are always 0 on bus wires | EXT §7.7 | 2 on 2 bus wires (§7.8) | **S** | <!-- EXT-7.7-009 EXT-7.7-016 --> |
| Bus wires are horizontal | EXT §7.7 | 892 of 2884 are vertical | **O** | <!-- EXT-7.7-020 --> |
| A placement box comes from the symbol's primitives | EXT §11.1.4 | The stored `bbox` field fits far better (§7.7) | **O** | carried from the previous golden spec |

Partial claims whose value lists the corpus exceeds are stated with the values seen in the tables above: IsPrimitive "always 2" and the known primitive words (§7.4.1); placed bits 2–6 values 0 and 1 (5 also occurs); port rotation 0 or 2 and mirror 0 (§7.10); title-block rotation 0 (§7.13); off-page display counts 1–2 and Global colour 43 (§7.11); drawn display count 2, value index non-zero and contents library index 0 (§7.6); placed bbox containing every pin (§7.4); pin points following the anchoring rule (788 of 14841 miss, §7.7); drawn all-zero bbox fallback (never observed); the font word as a plain index (§7.9). <!-- EXT-7.3.1-002 EXT-7.3.1-004 EXT-7.3.1-008 EXT-7.3.1-009 EXT-16.6.3-002 EXT-16.6.3-007 EXT-16.5.7-003 EXT-7.18-010 EXT-7.9-004 EXT-7.12-003 EXT-7.10-008 EXT-7.5-011 EXT-7.5-016 EXT-7.5-017 EXT-7.5-007 EXT-7.3-007 EXT-2.5.1-011 EXT-2.5.2-010 EXT-7.3-008 EXT-6.4.1-006 INT-7.6.1-007 -->

### Parser divergences

Resolved: the parser reads pin +0x06 as `wireId` and +0x0A as `netId` (`structures.ts`). A pin no wire reaches joins the net its `net_id` names (the golden table `pin-net` in `docs/decision-tables/dsn-net-assignment`, replayed by `net-assignment.table.test.ts`): the net a page wire with that id carries, or for `wire_id = 0` a net shared with the pins of the same `net_id`; a sentinel pin with no such wire keeps the pin-to-pin rule (§13). **E**: on the 31 corpus designs with Capture exports, every such pin the export puts on a multi-pin net is on a net (4 were left unconnected before, `SENSOR_BOARD` U1.18, U1.20, U1.38, U1.40 on 5V and 3V3); across all 192 corpus and fixture DSNs, 19 designs change, each only by pins leaving NC for a net, and no pin moves between nets. <!-- EXT-7.4-007 INT-7.7.1-006 -->

Resolved: `parseGraphicInstBase` (`structures.ts`) now reads the box corners y1, x1, y2, x2 and then the location x, y, so ports, Globals and off-page connectors carry their stored box and true location. `symbol-attachment.ts`, `net-pins.ts` and `page-groups.ts` therefore test the stored box. **E**: netlist coverage against Capture's exports is unchanged by the fix (fixtures 100% on every measure; corpus designs with exports unchanged). <!-- EXT-7.1-006 EXT-7.1-007 EXT-7.1-010 EXT-7.1-011 --> |

### Unverified

- *Unverified.* On a Port, the 7-byte preamble extension `05 00 00 00 00 00 00` means locked. No port has a non-empty extension (2135/2135 empty). <!-- EXT-3.4-020 -->
- *Unverified* (reader guidance). A name index of a placed instance or connector can exceed the string table and should then be treated as unresolved, not as an error. No such index occurs: all resolve. <!-- EXT-7.0.5-002 EXT-7.3-025 -->
- *Unverified.* If a Global or off-page connector had symbol kind 2, one inline record would follow. No connector has kind 2 (14833). <!-- EXT-7.10-010 -->
- *Unverified* (reader guidance). If a title block's first trailer word is not 0 or 1, treat all three words as unknown. No such trailer occurs (443). <!-- EXT-7.12-008 -->
- *Unverified.* The title-block corner flag means 0 = no, 1 = yes. Only 0 (20) and 1 (423) occur; the meaning needs Capture. <!-- EXT-7.18-013 EXT-16.6.6-002 EXT-16.6.6-003 -->
- *Unverified.* ErcObject (77) is an ERC marker. The records decode as error, detail and location strings; the meaning needs Capture. <!-- EXT-7.13-001 -->
- *Unverified.* Primitive word bit 15 means power pins visible (0 hidden, 1 visible). It is set on 81 placed instances; the meaning needs Capture. <!-- EXT-7.18-011 -->
- *Unverified.* A drawn instance's pins carry the block's connection points on the parent page, and their net field is the parent net's id as on a part pin. Drawn pins decode like part pins; parent-net equality is a hierarchy check. <!-- INT-7.7.2-018 -->
- *Unverified.* A bus port's symbol pin carries the bus name with its range (such as `DATA[7:0]`), and its members bind by name. This is a hierarchy and bus check. <!-- INT-7.7.2-021 -->
- *Unverified* (listed values never seen). These listed values occur in no file, so each claim is partial: graphic-instance types 57 (arc) and 88 (bezier) with symbol kind 2; placed name index 0 and an index past the string table; placed display count 0; pin display count 3; wire line style 0, 1, 2; alias rotation 3; title blocks per page 2; title-block page count 34-74 and page number 33-74. <!-- EXT-7.1-001 EXT-7.0.6-002 EXT-16.6.2-002 EXT-7.3-003 EXT-7.3-013 EXT-7.4-009 EXT-7.7-015 EXT-7.8-006 EXT-7.12-001 EXT-7.12-005 EXT-7.12-006 -->

### Open questions

- **Pin-word flag.** What the high bit means. It is set on 3242 pins, 88% of them unwired, and is unrelated to cached shape bits (§7.5). <!-- EXT-7.oq-001 EXT-7.4-017 -->
- **Pin `net_id`.** Whether it is the net of a wireless connection (pin on pin, symbol on pin). It is non-zero only on pins with no wire in `wire_id` (840 `0xFFFFFFFF`, 94 `wire_id` 0); 1 of them sits at a scalar wire end (`DECADECOUNTER.DSN`). <!-- EXT-7.oq-002 -->
- **Placed contents fields.** Whether bits 2–6 of a placed instance's primitive word, and its contents library and view indices, mean what they mean on a drawn instance. Placed bits 2–6 = 5 on 58 records, exactly the 58 placed records with a non-zero contents view index; the contents library index is non-zero on 4 placed records. <!-- EXT-7.oq-003 EXT-7.3.1-005 EXT-7.3-027 EXT-7.3-028 EXT-16.5.7-004 -->
- **IsPrimitive value 3.** Its meaning; it never occurs. <!-- EXT-7.3.1-003 EXT-16.6.3-003 -->
- **Short-prefix count −1.** What −1 means against 0. It is −1 on every type 39, 49 and 6 record and on 385 GraphicObjects; 0 or positive elsewhere. <!-- EXT-7.oq-004 -->
- **Lock-form sub-records.** What the `(0, 2)` lock form means on placed instances, display properties and graphics. The exact form occurs only on 2 type-55 boxes; type-13 extensions are 37, 39 or 40 bytes. Port lock state with any extension is likewise unknown: all 2135 port extensions are empty. <!-- EXT-7.oq-005 EXT-7.9-003 -->
- **Display anchor.** How the (6, 6) anchor point is placed for rotated displays. No data. <!-- EXT-7.oq-007 -->
- **Title-block box.** Why the location lies outside the box, and what the box measures. The location is below the box on 443/443. <!-- EXT-7.oq-008 -->
- **Bookmark instance.** The layout of type 78 and where it is stored. No type 78 occurs in 451 pages. <!-- EXT-7.oq-009 EXT-7.14-001 -->
- **Two-prefix encoding.** Whether ports, title blocks and ERC objects may use two full prefixes. All 2135, 443 and 2066 use three. <!-- EXT-7.oq-010 -->
- **Placed bbox derivation.** How a placed instance's box follows from its symbol, transform, pins and text. 8 of 14638 boxes miss a pin (`CLAYR6.DSN` J3, J6); the claim that the box is larger than the transformed symbol box was not checked. <!-- EXT-7.oq-011 EXT-7.3-026 EXT-18.oq-002 -->
- **Bus-entry header and ends.** Whether the header word (48 on 1688/1688, the default colour value) is a colour, and whether the first point is the bus end. The first point lies on a bus wire and the second on a scalar wire end on 1311; reversed on 375; neither on 2. <!-- EXT-7.oq-006 EXT-7.11-002 EXT-7.11-003 EXT-7.11-005 EXT-7.11-008 EXT-16.2.4-015 -->
- **Reserved byte S+0x13.** Whether it is uninitialised padding. Every record type mixes 0, printable and other values. <!-- EXT-7.1-019 -->
- **Fields INT listed as unknown, now identified.** The 8 bytes before the placed symbol name are the name and library indices; the 8 bytes after the `db_id` are the bbox; the 4 bytes before the displays are the transform, type echo and reserved byte; the byte after the displays is the symbol kind; the 10 bytes after the value index are the contents library index, contents view index and primitive word; the 2 bytes after the source package are the device index; pin `unknown_int` is the `net_id`; the base's second `u32` is the library index (its constancy per design was not tested); the Port's 9 trailer bytes and the Global/off-page 5 tail bytes are as in §7.10 and §7.11. <!-- INT-7.7-019 INT-7.7-021 INT-13.3-001 INT-13.3-002 INT-13.3-003 INT-13.3-004 INT-13.3-005 INT-13.3-006 INT-13.3-007 INT-13.3-008 INT-13.3-009 INT-13.3-010 INT-13.3-011 -->

<!-- meta: INT-7.7.1-001 INT-7.7.2-001 INT-7.7-023 INT-7.7-034 -->

Parser coverage: the parser reads placed and drawn instances (name and symbol strings, `db_id`, location, displays, reference, value index, pins with ordinal, point and +0x06, source package, device index, property pairs), wires (scalar or bus, ids and end points; colour, junction byte, displays, width and style read and discarded) with their aliases, the base of ports, Globals and off-page connectors with their trailers, the bbox and transform (rotation and mirror) of placed instances and connectors, title blocks (property pairs and the page count and number of the trailer) and bus entries; it skips pin +0x0A, the primitive word and ERC objects, and does not read page graphics. <!-- INT-7-015 INT-13.2-007 INT-13.2-010 -->

---

## 8. Graphic primitives

A graphic primitive is one drawable shape: a rectangle, line, arc, ellipse, polygon, polyline, Bezier curve, comment text, bitmap, OLE object or named group of shapes. Primitives live in primitive lists. A primitive list is the drawing of a cached or library symbol (types 24, 33, 34, 35, 64, 75, 76), and the single shape of a page graphic, where the list sits inside a nested GraphicObject (type 2). <!-- EXT-3.11-001 -->

Primitive entries are not framed records. Each entry starts with a one-byte kind code from its own code space (40-48, 87, 90), separate from the structure type ids: kind codes sit only where no framed record is read, and the values 87 and 90 coincide with structure ids 87 and 90 by value alone. **S** (38,841 entries in 11,820 lists in the Cache, `Packages/*`, `Symbols/*`, the inline parts of drawn instances and page GraphicObjects, each decoded by kind-byte framing to the exact list boundary). The count excludes 36 unframed `Packages/*_pDboPackage_Copy_*` streams (17 in each BeagleBoard-xM_ORCAD.DSN copy, 1 in each of two parallella files), which the check could not decode ("no full prefix type 6 @2"). <!-- EXT-3.11-001 EXT-3.11-002 -->

Kind 48 is the one exception: its entry is the byte 48 followed by a framed SymbolVector record of structure type 48 (§8.7). **S** (all 15 kind-48 entries: F = 2, short count -1, E = 0, ending at their first-prefix stop) <!-- EXT-3.11-003 -->

Offsets in this chapter are relative to the first byte of the entry or record described.

### 8.1 Kind codes

| Kind | Hex | Name | Body | Entries | Evidence | ids |
| --- | --- | --- | --- | --- | --- | --- |
| 40 | `0x28` | Rect, axis-aligned rectangle | §8.4.1 | 4,982 | **S** | <!-- EXT-8.2-002 --> |
| 41 | `0x29` | Line, straight segment | §8.4.2 | 20,388 | **S** | <!-- EXT-8.2-003 --> |
| 42 | `0x2A` | Arc, elliptical arc | §8.4.3 | 1,722 | **S** | <!-- EXT-8.2-004 --> |
| 43 | `0x2B` | Ellipse, given by its corner box | §8.4.1 | 2,410 | **S** | <!-- EXT-8.2-005 --> |
| 44 | `0x2C` | Polygon, point outline with fill | §8.4.4 | 963 | **S** | <!-- EXT-8.2-006 --> |
| 45 | `0x2D` | Polyline, open point chain | §8.4.5 | 318 | **S** | <!-- EXT-8.2-007 --> |
| 46 | `0x2E` | CommentText, free text | §8.4.6 | 7,986 | **S** | <!-- EXT-8.2-008 --> |
| 47 | `0x2F` | Bitmap, raster image | §8.4.7, §8.5 | 45 | **S** | <!-- EXT-8.2-009 --> |
| 48 | `0x30` | SymbolVector, named group of child primitives | §8.7 | 15 | **S** | <!-- EXT-8.2-010 --> |
| 87 | `0x57` | Bezier curve (the name is per name only) | §8.4.5 | 3 | **S** | <!-- EXT-8.2-011 --> |
| 90 | `0x5A` | OLE object | §8.4.8 | 9 | **S** | <!-- EXT-8.2-012 --> |

- No other kind code occurs. **S** (38,841 entries; the reader rejects any other code and never did in a primitive list) <!-- EXT-8.2-013 -->
- A kind code is a plain byte with no flag bits. The kind byte equals the kind-repeat byte on every top-level entry. Bit `0x8000` ("power pins visible") belongs to the placed-instance primitive word, not to a primitive. **S** (38,796 top-level entries) <!-- EXT-8.3-001 -->
- Kind 90 occurs only as the single primitive of an OLE page graphic (type 89). **S** (9 of 9) <!-- EXT-8.2-014 EXT-8.6.8-001 -->

### 8.2 Primitive lists

A primitive list has one layout wherever it occurs: a `u32` colour in front, a `u16` count, the entries, and an 8-byte box. **S** (one decoder reads all 11,820 decodable lists to the exact boundary; the 36 unframed `_pDboPackage_Copy_` streams are excluded) <!-- EXT-8.1-001 -->

| Offset | Type | Field | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| -0x04 | u32 | colour | Colour (§9.4) of the list's owner, stored by the container just before the list. 48 on all 5,680 symbol bodies and all 6,140 GraphicObjects; 0 never occurs. | **S** | <!-- EXT-8.5-001 EXT-16.2.4-012 --> |
| +0x00 | u16 | count | Number of entries. | **S** (11,820 lists) | <!-- EXT-8.5-002 --> |
| +0x02 | var | entries | `count` entries back to back, no padding (§8.3). | **S** (11,820) | <!-- EXT-8.5-003 --> |
| after entries | i16 x 4 | bbox | x1, y1, x2, y2 of the owner. | **S** | <!-- EXT-8.5-004 --> |

- The box ends exactly at a boundary of the container: the third of the five boundaries of a LibraryPart (24) body, the second of the four boundaries of a type 33, 34, 35, 64, 75 or 76 body, and the outer boundary of a GraphicObject. **S** (type 24: 4,387 lists including packages and drawn parts; terminal symbols: 1,293; GraphicObjects: 6,140) <!-- EXT-8.5-005 -->
- The boundary and the decoded entry lengths always agree, so a reader can skip a list by its boundary without decoding it. **S** (11,820 lists) <!-- EXT-8.5-008 -->
- In a LibraryPart body the box contains every Line and Rect coordinate of the list, and equals their extent in most symbols. **O** (contains: 4,039 of 4,039 symbols with such primitives; equal: 2,765) <!-- EXT-8.5-006 -->
- In a GraphicObject the count is always 1 and the box is always 0, 0, 0, 0. **S** (6,140) <!-- EXT-8.5-007 -->

Where lists occur:

| Owner | Stored in | Kinds seen (count) | Evidence | ids |
| --- | --- | --- | --- | --- |
| LibraryPart (24) | Cache (2,604), `Packages/*` (1,609), inline part of a DrawnInstance (12) (174) | 40, 41, 42, 43, 44, 45, 46, 47, 48, 87 | **S** | <!-- EXT-8.1-002 --> |
| GlobalSymbol (33) | Cache; no type-33 `Symbols/*` stream exists in the corpus | 41 (938), 43 (61), 46 (1) | **S** | <!-- EXT-8.1-003 --> |
| PortSymbol (34) | Cache only | 41 (646) | **S** | <!-- EXT-8.1-004 --> |
| OffPageSymbol (35) | Cache and `Symbols/*` | 41 (775), 46 (20) | **S** | <!-- EXT-8.1-005 --> |
| TitleBlockSymbol (64) | Cache and `Symbols/*` | 40, 41, 43 (11), 46, 47 | **S** | <!-- EXT-8.1-006 --> |
| ErcSymbol (75) | Cache and `Symbols/*` | exactly one 43 (549 bodies) or one 44 (28) | **S** | <!-- EXT-8.1-007 --> |
| GraphicObject (2) in a page graphic | `Views/<schematic>/Pages/<page>` | exactly one entry, of the kind matching the instance type (§8.9), in absolute page coordinates | **S** (6,140) | <!-- EXT-8.1-009 --> |

The kind lists above are what the corpus holds. GlobalSymbol also holds a CommentText (1) beyond EXT's 41, 43; OffPageSymbol holds CommentText (20) and no Polygon; TitleBlockSymbol holds Ellipses (11) and no Polygon. <!-- EXT-8.1-003 EXT-8.1-005 EXT-8.1-006 -->

### 8.3 Entry framing: two forms

Every top-level entry starts with a 10-byte header, and its body always begins at +0x0A. **S** (38,826 non-vector entries, both forms) <!-- EXT-8.6-001 -->

| Offset | Type | Field | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u8 | kind | Kind code (§8.1). | **S** | <!-- EXT-8.6.8-002 --> |
| +0x01 | u8 | kind_repeat | Equal to `kind`. | **S** (38,796 top-level entries) | <!-- EXT-8.6.8-003 --> |
| +0x02 | u32 | length | Entry length; its meaning depends on the form (below). | **S** | <!-- EXT-8.6.8-004 --> |
| +0x06 | u32 | reserved | Always 0. | **S** (38,826) | <!-- EXT-8.6.8-005 --> |
| +0x0A | var | body | Per-kind body (§8.4). | **S** | |

Two entry forms exist. Both have the header above and the same per-kind body; they differ only in what follows the body and in what `length` counts.

- **Wrapped form.** After the body comes an extension wrapper: the 4-byte `PREAMBLE` `FF E4 5C 39`, a `u32 E`, then E extension bytes. `length` counts the body plus the wrapper (body + 8 + E). **S** (27,318 entries)
- **Bare form (new).** Nothing follows the body: no `PREAMBLE`, no `E`, and for CommentText no extension. `length` counts the body only. The next entry, or the list's box, starts right after the body. **S** (11,508 of 38,826 entries) <!-- EXT-8.1-001 EXT-8.5-003 -->
- **Common end rule (new).** In both forms an entry ends at `+0x02 + length + 8`. **S** (38,826 entries) <!-- EXT-8.6.6-013 -->

Telling the forms apart: read the 4 bytes right after the body (for CommentText, right after its text). They are `PREAMBLE` in the wrapped form. In the bare form they are the next entry's kind byte or the list box, never `FF E4 5C 39`. **S** (every list then ends exactly at its boundary)

| Kind | Body bytes | Wrapped `length` | Wrapped entries | Bare `length` | Bare entries | ids |
| --- | --- | --- | --- | --- | --- | --- |
| Rect (40) | 32 | 40 | 3,027 | 32 | 1,955 | <!-- EXT-8.6.1-010 --> |
| Ellipse (43) | 32 | 40 | 1,793 | 32 | 617 | <!-- EXT-8.6.1-010 --> |
| Line (41) | 24 | 32 | 15,355 | 24 | 5,033 | <!-- EXT-8.6.2-008 --> |
| Arc (42) | 40 | 48 | 1,368 | 40 | 354 | <!-- EXT-8.6.3-012 --> |
| Polygon (44) | 18 + 4n | 26 + 4n | 830 | 18 + 4n | 133 | <!-- EXT-8.6.4-008 --> |
| Polyline (45) | 10 + 4n | 18 + 4n | 210 | 10 + 4n | 108 | <!-- EXT-8.6.5-006 --> |
| Bezier (87) | 10 + 4n | 18 + 4n | 3 | none seen | 0 | <!-- EXT-8.6.5-006 --> |
| CommentText (46) | 31 + n | 39 + n + E | 4,682 | 31 + n | 3,304 | <!-- EXT-8.6.6-012 --> |
| Bitmap (47) | 36 + dib_length | 44 + dib_length | 41 | 36 + dib_length | 4 | <!-- EXT-8.6.7-012 --> |
| OLE (90) | 36 + dib_length | 44 + dib_length | 9 | none seen | 0 | <!-- EXT-8.6.8-004 --> |

Each fixed length above is exact: the stated wrapped length holds on every wrapped entry and the bare length on every bare entry. **S** (counts in the table) <!-- EXT-8.6.1-010 EXT-8.6.2-008 EXT-8.6.3-012 EXT-8.6.4-008 EXT-8.6.5-006 EXT-8.6.6-012 EXT-8.6.7-012 -->

Where the bare form occurs (new):

- Only in files with Library version 3.2. Version-3.3 files hold only wrapped entries. **S** (version 3.2: 11,508 bare and 15,597 wrapped; version 3.3: 11,721 wrapped, 0 bare; 98 files of version 3.2, 7 of version 3.3)
- In every kind of container that holds lists: Cache type 24 (3,370 bare / 13,824 wrapped), 33 (265 / 735), 34 (160 / 486), 35 (204 / 585), 64 (358 / 1,344), 75 (62 / 441); `Packages/*` (5,681 / 4,711); `Symbols/*` type 75 (15 / 59); page GraphicObjects (1,393 / 4,747). Inline parts of drawn instances hold only wrapped entries (276). **S**
- Both forms can share a file and even one symbol record. **S** (symbol records in version-3.2 files: 1,701 bare only, 2,673 wrapped only, 2 mixed, the 2 mixed in the Cache; version 3.3: 1,113 wrapped only)
- A reader must therefore decide the form per entry, not per file or per record.

Inside a SymbolVector (§8.7) a child entry starts with a `u16` selector whose low byte equals the kind and whose high byte is 0, followed by the kind byte again; the length, reserved word and body follow as in a top-level entry, so every child offset is one byte later than the top-level offset. **S** (all 30 children) <!-- EXT-3.8-008 -->

### 8.4 Per-kind bodies

Common field types (all verified on every entry of the kinds named):

- Corner and point coordinates of Line, Rect, Arc, Ellipse, CommentText and Bitmap are `i32`; the point lists of Polygon, Polyline and Bezier are `i16`. **S** <!-- EXT-8.6-002 -->
- `line_style` and `line_width` are `u32` holding the LineStyle and LineWidth enums (§9.5); their values fit one byte. **O** (30,786 pairs, style at most 5, width at most 3) <!-- EXT-8.6-003 -->
- `fill` is a `u32` Fill value and `hatch` an `i32` Hatch value (§9.6). **S** (fill 0-2; hatch -1 occurs 132 times) <!-- EXT-8.6-004 EXT-8.6-005 -->

The "wrapper" row in each table exists only in the wrapped form (§8.3).

#### 8.4.1 Rect (40) and Ellipse (43)

Rect and Ellipse share one body. **S** (7,392 entries decode to their exact end)

| Offset | Type | Field | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x0A | i32 | x1 | First corner x. | <!-- EXT-8.6.1-001 --> |
| +0x0E | i32 | y1 | First corner y. | <!-- EXT-8.6.1-002 --> |
| +0x12 | i32 | x2 | Opposite corner x. | <!-- EXT-8.6.1-003 --> |
| +0x16 | i32 | y2 | Opposite corner y. | <!-- EXT-8.6.1-004 --> |
| +0x1A | u32 | line_style | LineStyle. | <!-- EXT-8.6.1-005 --> |
| +0x1E | u32 | line_width | LineWidth. | <!-- EXT-8.6.1-006 --> |
| +0x22 | u32 | fill | Fill. | <!-- EXT-8.6.1-007 --> |
| +0x26 | i32 | hatch | Hatch. | <!-- EXT-8.6.1-008 --> |
| +0x2A | 8 bytes | wrapper | `PREAMBLE`, `u32 E` = 0. Present on 4,820 entries; absent on the 2,572 bare entries (1,955 Rect, 617 Ellipse). | <!-- EXT-8.6.1-009 --> |

#### 8.4.2 Line (41)

**S** (20,388 entries decode to their exact end)

| Offset | Type | Field | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x0A | i32 | x1 | Start x. | <!-- EXT-8.6.2-001 --> |
| +0x0E | i32 | y1 | Start y. | <!-- EXT-8.6.2-002 --> |
| +0x12 | i32 | x2 | End x. The end equals the start on 539 lines. | <!-- EXT-8.6.2-003 --> |
| +0x16 | i32 | y2 | End y. | <!-- EXT-8.6.2-004 --> |
| +0x1A | u32 | line_style | LineStyle. | <!-- EXT-8.6.2-005 --> |
| +0x1E | u32 | line_width | LineWidth. | <!-- EXT-8.6.2-006 --> |
| +0x22 | 8 bytes | wrapper | `PREAMBLE`, `u32 E` = 0. Present on 15,355; absent on 5,033 bare Lines. | <!-- EXT-8.6.2-007 --> |

#### 8.4.3 Arc (42)

**S** (1,722 entries decode to their exact end)

| Offset | Type | Field | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x0A | i32 | x1 | Box of the full ellipse; square (a circular arc) on 1,644 of 1,722. | <!-- EXT-8.6.3-001 --> |
| +0x0E | i32 | y1 | | <!-- EXT-8.6.3-002 --> |
| +0x12 | i32 | x2 | | <!-- EXT-8.6.3-003 --> |
| +0x16 | i32 | y2 | | <!-- EXT-8.6.3-004 --> |
| +0x1A | i32 | start_x | Start point of the arc. | <!-- EXT-8.6.3-005 --> |
| +0x1E | i32 | start_y | | <!-- EXT-8.6.3-006 --> |
| +0x22 | i32 | end_x | End point; equals the start on 25 arcs. | <!-- EXT-8.6.3-007 --> |
| +0x26 | i32 | end_y | | <!-- EXT-8.6.3-008 --> |
| +0x2A | u32 | line_style | LineStyle. | <!-- EXT-8.6.3-009 --> |
| +0x2E | u32 | line_width | LineWidth. | <!-- EXT-8.6.3-010 --> |
| +0x32 | 8 bytes | wrapper | `PREAMBLE`, `u32 E` = 0. Present on 1,368; absent on 354 bare Arcs. | <!-- EXT-8.6.3-011 --> |

#### 8.4.4 Polygon (44)

**S** (963 entries decode to their exact end)

| Offset | Type | Field | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x0A | u32 | line_style | LineStyle. | <!-- EXT-8.6.4-001 --> |
| +0x0E | u32 | line_width | LineWidth. | <!-- EXT-8.6.4-002 --> |
| +0x12 | u32 | fill | Fill. | <!-- EXT-8.6.4-003 --> |
| +0x16 | i32 | hatch | Hatch. | <!-- EXT-8.6.4-004 --> |
| +0x1A | u16 | n | Point count. Values seen: 3, 4, 5, 6, 8, 10. | <!-- EXT-8.6.4-005 --> |
| +0x1C | 4n bytes | points | n x (`i16 y`, `i16 x`), y first. | <!-- EXT-8.6.4-006 --> |
| after points | 8 bytes | wrapper | `PREAMBLE`, `u32 E` = 0. Present on 830; absent on 133 bare Polygons. | <!-- EXT-8.6.4-007 --> |

- Points are stored y first. **O** (in 520 point lists where only one reading fits the stored symbol box, it is always the y-first reading) <!-- EXT-8.6.4-006 -->
- The last point repeats the first in most polygons. **O** (736 of 963) <!-- EXT-8.6.4-009 -->

#### 8.4.5 Polyline (45) and Bezier (87)

Polyline and Bezier share one body. **S** (318 Polylines and 3 Beziers decode to their exact end)

| Offset | Type | Field | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x0A | u32 | line_style | LineStyle. | <!-- EXT-8.6.5-001 --> |
| +0x0E | u32 | line_width | LineWidth. | <!-- EXT-8.6.5-002 --> |
| +0x12 | u16 | n | Point count. | <!-- EXT-8.6.5-003 --> |
| +0x14 | 4n bytes | points | n x (`i16 y`, `i16 x`), y first. | <!-- EXT-8.6.5-004 --> |
| after points | 8 + E bytes | wrapper | `PREAMBLE`, `u32 E`, E extension bytes. E = 0 on all 213 wrapped Polyline and Bezier entries (no end-shape record); 108 bare Polylines have no wrapper. | <!-- EXT-8.6.5-005 --> |

- Polyline point counts seen: 2 to 7. **O** (318) <!-- EXT-8.6.5-007 -->
- Bezier point counts are 3k + 1; the only count seen is 10 (k = 3). **O** (3 of 3) <!-- EXT-8.6.5-008 -->

#### 8.4.6 CommentText (46)

**S** (7,986 entries decode to their exact end)

| Offset | Type | Field | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x0A | i32 | bbox_x1 | Text box. | <!-- EXT-8.6.6-001 --> |
| +0x0E | i32 | bbox_y1 | | <!-- EXT-8.6.6-002 --> |
| +0x12 | i32 | bbox_x2 | | <!-- EXT-8.6.6-003 --> |
| +0x16 | i32 | bbox_y2 | | <!-- EXT-8.6.6-004 --> |
| +0x1A | i32 | loc_x | Text location; equals bbox_x1 on 7,984 of 7,986. | <!-- EXT-8.6.6-005 --> |
| +0x1E | i32 | loc_y | Equals bbox_y1 on the same 7,984 of 7,986. | <!-- EXT-8.6.6-006 --> |
| +0x22 | u32 | font | Bits 0-15: font reference (§9.3), 1 to F on all 7,986 (never 0, never above F). Bits 16-31 opaque: `0x0000` on 5,273, `0x8000` on 26, other values on 2,687. | <!-- EXT-8.6.6-007 --> |
| +0x26 | 2 + n + 1 | text | `lstr`: `u16 n`, n bytes, `00`. | <!-- EXT-8.6.6-008 --> |
| after text | 4 | `PREAMBLE` | Wrapped form only (4,682 entries). | <!-- EXT-8.6.6-009 --> |
| next | u32 | E | Wrapped form only; 0 on all 4,682. | <!-- EXT-8.6.6-010 --> |
| next | E bytes | extension | Empty on all 4,682 wrapped entries; the justification-record alternative never occurs. | <!-- EXT-8.6.6-011 --> |

- The extension (or, in the bare form, the text) ends the entry; no further wrapper follows. **S** (7,986) <!-- EXT-8.6.6-013 -->
- The two location exceptions are in one page of one design (location 20,370 against boxes starting 30,410 and 330,620). <!-- EXT-8.6.6-005 EXT-8.6.6-006 -->

#### 8.4.7 Bitmap (47)

**S** (45 entries decode to their exact end)

| Offset | Type | Field | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x0A | i32 | x1 | Placement first corner. | <!-- EXT-8.6.7-001 --> |
| +0x0E | i32 | y1 | | <!-- EXT-8.6.7-002 --> |
| +0x12 | i32 | x2 | Placement far corner, an absolute coordinate; x2 > x1 on 45 of 45. | <!-- EXT-8.6.7-003 --> |
| +0x16 | i32 | y2 | y2 > y1 on 45 of 45. | <!-- EXT-8.6.7-004 --> |
| +0x1A | i32 | raster_x | Raster wrapper location (§8.5). | <!-- EXT-8.6.7-005 --> |
| +0x1E | i32 | raster_y | | <!-- EXT-8.6.7-006 --> |
| +0x22 | u32 | pixel_width | Raster wrapper pixel size (§8.5). | <!-- EXT-8.6.7-007 --> |
| +0x26 | u32 | pixel_height | | <!-- EXT-8.6.7-008 --> |
| +0x2A | u32 | dib_length | Byte length of the DIB that follows. | <!-- EXT-8.6.7-009 --> |
| +0x2E | dib_length | dib | Windows DIB including any trailer (§8.5). | <!-- EXT-8.6.7-010 --> |
| after DIB | 8 bytes | wrapper | `PREAMBLE`, `u32 E` = 0. Present on 41; absent on 4 bare Bitmaps. | <!-- EXT-8.6.7-011 --> |

- The 20 bytes from `raster_x` to `dib_length` are the raster wrapper: location, pixel size and DIB length. **S** (45 of 45) <!-- EXT-8.6.7-013 EXT-8.6.7-012 -->
- Every bitmap in the corpus uses this corner layout. A bare-form Bitmap has length 36 + dib_length, which differs from the 24 + dib_length of the cornerless layout EXT also defines (see Unverified). **S** (45)

#### 8.4.8 OLE object (90)

**S** (9 of 9 for every row)

| Offset | Type | Field | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x00 | u8 | kind | 90. | <!-- EXT-8.6.8-002 --> |
| +0x01 | u8 | kind_repeat | 90. | <!-- EXT-8.6.8-003 --> |
| +0x02 | u32 | length | 44 + dib_length. | <!-- EXT-8.6.8-004 --> |
| +0x06 | u32 | reserved | 0. | <!-- EXT-8.6.8-005 --> |
| +0x0A | i32 x 4 | corners | Placement x1, y1, x2, y2; x2 > x1 and y2 > y1 on 9 of 9. | <!-- EXT-8.6.8-006 --> |
| +0x1A | u32 x 4 | opaque_words | Small integers (below 100,000), never all zero; words 2 and 3 equal the corner width and height on 6 of 9. **O** | <!-- EXT-8.6.8-007 --> |
| +0x2A | u32 | dib_length | Length of the rest of the body. | <!-- EXT-8.6.8-008 --> |
| +0x2E | u32 | hdr0 | Always 256. | <!-- EXT-8.6.8-009 --> |
| +0x32 | u32 | hdr1 | Values seen 1, 2, 3, 4. | <!-- EXT-8.6.8-010 --> |
| +0x36 | u32 | hdr2 | Always 1. | <!-- EXT-8.6.8-011 --> |
| +0x3A | u16 | hdr3 | Always 0. | <!-- EXT-8.6.8-012 --> |
| +0x3C | u32 | hdr4 | Always 1. | <!-- EXT-8.6.8-013 --> |
| +0x40 | u32 | object_length | Always dib_length - 22. | <!-- EXT-8.6.8-014 --> |
| +0x44 | object_length | object | An embedded compound file starting `D0 CF 11 E0 A1 B1 1A E1`; contents are OLE server data. | <!-- EXT-8.6.8-015 --> |
| after object | 8 bytes | wrapper | `PREAMBLE`, `u32 E` = 0. | <!-- EXT-8.6.8-016 --> |

- The bytes `5A 5A <u32 length> 00 00 00 00` also read as kind byte 90 followed by a full prefix of type 90 at +0x01; that prefix's stop (+0x0A + length) is the entry end. Both readings give the same extent. **S** (9 of 9) <!-- EXT-8.6.8-017 -->

### 8.5 Bitmap payload

The `dib` field of a Bitmap is a Windows device-independent bitmap, optionally followed by a CI_IMAGE trailer that carries the real picture.

- `dib_length` covers the whole DIB, trailer included: header, colour table, rows and trailer fill it exactly. **S** (45 of 45) <!-- EXT-8.7.1-001 -->
- The DIB starts with a 40-byte BITMAPINFOHEADER: `biSize` 40, planes 1. **S** (45 of 45) <!-- EXT-8.7.1-002 -->
- Values seen: compression 0, positive height (bottom-up rows), bit counts 1 (14 bitmaps), 8 (3) and 24 (28). **O** (45) <!-- EXT-8.7.1-003 -->
- When the bit count is 8 or less, a colour table follows the header: 4 bytes per colour, `biClrUsed` colours, or 2^bitcount when `biClrUsed` is 0. Pixel rows follow the colour table, each padded to a multiple of 4 bytes. **S** (rows end exactly at `dib_length` in 31 DIBs without a trailer and at the trailer marker in 14) <!-- EXT-8.7.1-004 -->
- To wrap a DIB in a BMP file, set the pixel-data offset to 14 + 40 + 4 x colours. **O** (40 + 4 x colours is where the rows start in all 45 DIBs) <!-- EXT-8.7.2-008 -->

CI_IMAGE trailer:

| Offset (from trailer start) | Type | Field | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0 | 12 bytes | marker | ASCII `~~CI_IMAGE~~`, starting exactly at the end of the pixel rows (DIB offset 40 + colour table + rows). | **S** (14 of 14) | <!-- EXT-8.7.2-002 --> |
| +12 | u8 | id | 0 on 14 of 14; meaning unknown (Open questions). | **O** | <!-- EXT-8.7.2-003 --> |
| +13 | u8 | digits | Number of ASCII digits that follow. | **S** (14) | <!-- EXT-8.7.2-004 --> |
| +14 | digits bytes | size | Payload size in decimal ASCII; equals the payload length. | **S** (14) | <!-- EXT-8.7.2-005 --> |
| +14 + digits | size bytes | payload | A complete PNG (6), JPEG (5) or little-endian TIFF (3) image, ending exactly at the end of the DIB. | **S** (14) | <!-- EXT-8.7.2-006 --> |

- A bitmap carries the trailer exactly when its DIB is 1 bit per pixel. **O** (14 trailers, all on 1-bpp DIBs; 31 bitmaps without a trailer are 8 or 24 bpp) <!-- EXT-8.7.2-001 -->
- The trailer occurs on page bitmaps (7) and on bitmaps in TitleBlockSymbol (64) bodies in the Cache (7). **O** <!-- EXT-8.7.2-001 EXT-8.9.4-003 -->
- When the trailer is present, take the picture from its payload: the raster wrapper's pixel size never equals the 1-bpp DIB's size. **O** (14 of 14) <!-- EXT-8.7.2-007 -->
- A DIB without a trailer has no bytes after its pixel rows. **O** (31 of 31) <!-- EXT-8.7.1-005 -->

Raster wrapper values:

- Bitmaps in symbol bodies (types 24 and 64): the raster location equals (x1, y1) and the placement size differs from the pixel size (the picture is scaled). **O** (34 of 34). Exceptions: one has raster location 0, 0; the 7 title-block bitmaps with a CI_IMAGE trailer have a pixel size that differs from the DIB's size and equals the trailer image's size (4 of 4 decodable trailers). <!-- EXT-8.7.1-006 -->
- Page bitmaps: the raster location never equals either corner, is non-zero, and has a positive x. **O** (11 of 11) <!-- EXT-8.7.1-007 EXT-8.6.7-023 EXT-8.9.4-002 -->
- Page bitmap pixel size: equals the DIB size without a trailer (4 of 4); with a trailer it never equals the DIB size (7 of 7) and equals the trailer image size (7 of 7). The placement size equals the pixel size on 6 of 11. **O** <!-- EXT-8.7.1-008 -->

### 8.6 Coordinates

- Primitives in cached and library symbol bodies use the symbol's own coordinates; primitives inside a page GraphicObject use absolute page coordinates (§8.9). <!-- EXT-8.1-002 EXT-8.1-009 -->
- Line and pin coordinates are multiples of the 10-unit grid. The physical unit is not fixed by the bytes (see Unverified). <!-- EXT-8-005 -->

### 8.7 SymbolVector (kind 48)

A SymbolVector groups child primitives under a name and an origin. Every one in the corpus is a top-level entry of a LibraryPart (24) body, has two Polyline children, and contains no nested SymbolVector. **S** (15 vectors: Cache 10, `Packages/*` 5) <!-- EXT-8.8-001 -->

| Offset | Type | Field | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x00 | u8 | kind | 48. | <!-- EXT-8.8-002 --> |
| +0x01 | 9 bytes | outer prefix | Full prefix of type 48; its boundary ends the vector. | <!-- EXT-8.8-003 --> |
| +0x0A | 9 bytes | base prefix | Full prefix of type 48; its boundary is the end of the preamble. | <!-- EXT-8.8-004 --> |
| +0x13 | 3 bytes | short prefix | Type 48, property count -1 (`FF FF`). | <!-- EXT-8.8-005 --> |
| +0x16 | 8 bytes | preamble | `PREAMBLE`, `u32 E` = 0. | <!-- EXT-8.8-006 --> |
| +0x1E | i16 | loc_x | Group origin x. | <!-- EXT-8.8-007 --> |
| +0x20 | i16 | loc_y | Group origin y. | <!-- EXT-8.8-008 --> |
| +0x22 | u16 | count | Number of children. | <!-- EXT-8.8-009 --> |
| +0x24 | var | children | `count` child entries (§8.3, selector form). | <!-- EXT-8.8-010 --> |
| after children | 2 + n + 1 | name | `lstr` group name, non-empty; ends exactly at the outer boundary. | <!-- EXT-8.8-011 --> |

- Every row holds on all 15 vectors, each decoded to its outer boundary. **S** (15)
- No extension wrapper follows a SymbolVector entry; the next entry starts at the vector's outer stop. **S** (15) <!-- EXT-8.8-012 -->
- In EXT's grammar a SymbolVector that is itself a vector child starts with the `u16` selector 48 in place of the kind byte; that case never occurs in the corpus. <!-- EXT-8.8-002 -->

### 8.8 Graphic-instance base

Placed instances (13), drawn instances (12), Ports (23), Globals (37), off-page connectors (38), title blocks (65), ERC objects (77) and page graphics (55-62, 88, 89) share one body layout, the graphic-instance base. **S** (all decode with one layout; 451 page streams consumed to the exact end) <!-- INT-7.8-002 -->

Each such record has prefixes of its own type and a preamble. The preamble is always present. **S** (16,968 Global, Port and off-page records; never omitted) <!-- INT-7.8-003 -->

B is the body start (after the preamble). S is the offset just after the symbol name.

| Offset | Type | Field | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| B+0x00 | u32 | name_index | String-table index (for Globals, Ports and off-page connectors, of the net name; see the connectivity chapter). | **S** | <!-- INT-7.8-004 --> |
| B+0x04 | u32 | lib_index | String-table index of the source library path. | **S** | <!-- INT-7.8-005 --> |
| B+0x08 | lstr | symbol | Symbol type name (for example `VCC_BAR`), resolving to a cached 33, 34 or 35 symbol for Globals, Ports and off-page connectors. | **S** | <!-- INT-7.8-006 --> |
| S+0x00 | u32 | db_id | Object id. | **S** | <!-- INT-7.8-007 --> |
| S+0x04 | i16 | bbox y1 | Box minimum y. | **S** | <!-- INT-7.8-008 --> |
| S+0x06 | i16 | bbox x1 | Box minimum x. | **S** | <!-- INT-7.8-009 --> |
| S+0x08 | i16 | bbox y2 | Box maximum y (y1 <= y2 on all 34,288 non-zero boxes). | **S** | <!-- INT-7.8-010 --> |
| S+0x0A | i16 | bbox x2 | Box maximum x. | **S** | <!-- INT-7.8-011 --> |
| S+0x0C | i16 | loc_x | Location x. | **S** | <!-- INT-7.8-012 --> |
| S+0x0E | i16 | loc_y | Location y. | **S** | <!-- INT-7.8-013 --> |
| S+0x10 | u8 | colour | Transform bits 0-7: colour (§9.4). 48 on off-page connectors and Ports; 48 or 8 on Globals. | **S** | <!-- INT-7.8-014 --> |
| S+0x11 | u8 | transform high | Transform bits 8-15: bits 0-1 rotation, bit 2 mirror, bits 3-7 zero (§9.7). | **O** | <!-- INT-7.8-015 --> |
| S+0x12 | u8 | type echo | Equals the record's structure type. | **O** (40,800 base records) | <!-- INT-7.8-016 --> |
| S+0x13 | u8 | opaque | Arbitrary value: non-zero on 4,952 Globals, 4,461 off-page connectors, 1,254 Ports. | **O** | <!-- INT-7.8-017 --> |
| S+0x14 | u16 | display_count | Count of SymbolDisplayProp records that follow (§9.1); Global 0-1, off-page 0-2, Port 1. | **S** | <!-- INT-7.8-018 --> |
| after displays | u8 | symbol_kind | Structure type of the symbol drawn: 33 on Globals, 34 on Ports, 35 on off-page connectors, 64 on title blocks, 75 on ERC objects, 2 on page graphics (a GraphicObject follows). | **S** | <!-- INT-7.8-019 INT-7.8-020 --> |

- The location lies inside the box on every non-zero box when the fields are read in the order above. **S** (placed 14,638, Global 8,342, off-page 6,491, Port 2,135, drawn 174) <!-- INT-7.8-008 INT-7.8-009 INT-7.8-012 INT-7.8-013 -->
- S+0x10 and S+0x11 together are the `u16` transform word (§9.7). <!-- INT-7.8-014 INT-7.8-015 -->
- The `symbol_kind` byte is followed by a checkpoint on Globals, Ports and off-page connectors. The value 2 never occurs on them, so nothing nested follows there; on page graphics (6,140) the value 2 is followed by one GraphicObject. **S** <!-- INT-7.8-019 -->
- A Port carries 9 more bytes between its second and first boundary stops, inside the record. **S** (2,135 of 2,135) <!-- INT-7.8-021 -->
- Each Global and off-page connector in the page list is followed by 5 bytes outside the record. **S** (8,342 Globals, 6,491 off-page connectors; 451 pages consumed to the exact end) <!-- INT-7.8-022 -->
- Ports have no 5-byte trailer outside the record; their only extra bytes are the 9 inside it. **T**, and **S** (2,135 Ports, nothing after them) <!-- INT-7.8-023 -->

### 8.9 Page graphic instances (55-62, 88, 89)

A page graphic is a framed record (F = 2) in the page-graphics list (list 12) of a page stream. Its body is the graphic-instance base (§8.8) whose `symbol_kind` is 2, followed by exactly one GraphicObject record (type 2) holding one primitive. **S** (6,140 records in 451 pages consumed to the exact end) <!-- EXT-8.9.1-001 EXT-7.15-013 -->

| Type | Name | Primitive | Records | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| 55 | GraphicBoxInst | 40 Rect | 435 | **S** | <!-- EXT-7.15-001 EXT-8.9.1-025 --> |
| 56 | GraphicLineInst | 41 Line | 1,427 | **S** | <!-- EXT-7.15-002 EXT-8.9.1-026 --> |
| 57 | GraphicArcInst | 42 Arc (unverified) | 0 | none | <!-- EXT-7.15-003 EXT-8.9.1-027 --> |
| 58 | GraphicEllipseInst | 43 Ellipse | 119 | **S** | <!-- EXT-7.15-004 EXT-8.9.1-028 --> |
| 59 | GraphicPolygonInst | 44 Polygon | 1 | **S** | <!-- EXT-7.15-005 EXT-8.9.1-029 --> |
| 60 | GraphicPolylineInst | 45 Polyline | 31 | **S** | <!-- EXT-7.15-006 EXT-8.9.1-030 --> |
| 61 | GraphicCommentTextInst | 46 CommentText | 4,107 | **S** | <!-- EXT-7.15-007 EXT-8.9.1-031 --> |
| 62 | GraphicBitMapInst | 47 Bitmap | 11 | **S** | <!-- EXT-7.15-008 EXT-8.9.1-032 --> |
| 88 | GraphicBezierInst | 87 Bezier (unverified) | 0 | none | <!-- EXT-7.15-009 EXT-8.9.1-033 --> |
| 89 | GraphicOleEmbedInst | 90 OLE | 9 | **S** | <!-- EXT-7.15-010 EXT-8.9.1-034 --> |

The GraphicObject holds exactly one primitive, of the kind listed for the instance type. **S** (6,140 of 6,140) <!-- EXT-8.9.1-035 -->

Page-graphic body (graphic-instance base with page-graphic values):

| Offset | Type | Field | Value in page graphics | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| B+0x00 | u32 | name_index | 0 on all 6,140. | **O** | <!-- EXT-8.9.1-006 EXT-7.15-015 --> |
| B+0x04 | u32 | library_index | 0 on all 6,140. | **O** | <!-- EXT-8.9.1-007 --> |
| B+0x08 | lstr | symbol_name | Empty on all 6,140. | **O** | <!-- EXT-8.9.1-008 --> |
| S+0x00 | u32 | db_id | Object id. | **S** | <!-- EXT-8.9.1-009 --> |
| S+0x04 | i16 | y1 | Box, y before x. | **S** | <!-- EXT-8.9.1-010 --> |
| S+0x06 | i16 | x1 | | **S** | <!-- EXT-8.9.1-011 --> |
| S+0x08 | i16 | y2 | | **S** | <!-- EXT-8.9.1-012 --> |
| S+0x0A | i16 | x2 | | **S** | <!-- EXT-8.9.1-013 --> |
| S+0x0C | i16 | loc_x | Instance location. | **S** | <!-- EXT-8.9.1-014 --> |
| S+0x0E | i16 | loc_y | | **S** (6,140) | <!-- EXT-8.9.1-015 --> |
| S+0x10 | u16 | transform | Bits 11-15 zero and mirror 0 on all 6,140; rotation 0 except CommentText. | **O** | <!-- EXT-8.9.1-016 --> |
| S+0x12 | u16 | type_echo | Low byte equals the structure type on all 6,140; high byte opaque, 0 on 3,955 (64%). | **O** | <!-- EXT-8.9.1-017 --> |
| S+0x14 | u16 | display_count | 0 on all 6,140, so no display records follow. | **O** / **S** | <!-- EXT-8.9.1-018 EXT-8.9.1-019 --> |
| next | u8 | symbol_kind | 2 on all 6,140. | **O** | <!-- EXT-8.9.1-020 --> |
| next | record | graphic_object | One GraphicObject; its first-prefix stop equals the instance's first-prefix stop, so the record ends right after it. | **S** (6,140) | <!-- EXT-8.9.1-021 EXT-7.15-014 --> |

- Library index 0, empty symbol name, no displays and symbol kind 2 hold together on every page graphic. **O** (6,140) <!-- EXT-7.15-016 -->
- Box: a non-zero box equals the extent of the nested primitive when read y1, x1, y2, x2. **S** (2,007 of 2,013; the 6 exceptions are Ellipses, for example box 1020,680,1110,700 against ellipse 1020,670,1110,690). The box is zero on all 4,107 CommentText, all 11 Bitmap and all 9 OLE graphics, and non-zero on every Line, Rect, Polygon, Polyline and on all 119 Ellipses. **O** <!-- EXT-8.9.1-010 EXT-8.9.1-011 EXT-8.9.1-012 EXT-8.9.1-013 EXT-7.15-017 -->
- Location: equals the primitive's first corner on 911 of 6,140 (Line 494 of 1,427, Ellipse 91 of 119, CommentText 244 of 4,107). It is 0, 0 on 150 CommentText graphics, 5 Rects and 2 OLE graphics, and on no Bitmap. **O** <!-- EXT-8.9.1-014 -->
- Transform: rotation 0 and mirror 0 on every non-text graphic; CommentText has rotation 0 (4,072), 1 (24) or 3 (11), never mirrored. **O** <!-- EXT-7.15-019 EXT-8.9.1-016 -->
- The nested primitive holds absolute page coordinates; the instance location and transform are not applied to it again. **O** (the instance box equals the primitive's own extent on 2,007 of 2,013 non-zero boxes while instance locations are non-zero; applying the location again would shift them) <!-- EXT-7.15-020 EXT-8.9.1-036 -->
- The GraphicObject colour is 48 on all 6,140 while instance transforms carry 12 distinct colours. That the drawn colour is the transform's colour is per name only. **O** <!-- EXT-8.9.1-037 -->

GraphicObject (type 2) nested in a page graphic:

| Offset | Type | Field | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | 9 bytes | prefix 1 | Full prefix of type 2; boundary = end of the object (after the box). | **S** (6,140) | <!-- EXT-8.9.2-001 --> |
| +0x09 | 9 bytes | prefix 2 | Full prefix of type 2; boundary = end of the two strings. | **S** (6,140) | <!-- EXT-8.9.2-002 --> |
| +0x12 | 9 bytes | prefix 3 | Full prefix of type 2; boundary = end of the preamble. | **S** (6,140) | <!-- EXT-8.9.2-003 --> |
| +0x1B | 3 bytes | short prefix | Type 2; property count 0 (5,755) or -1 (385). | **O** | <!-- EXT-8.9.2-004 --> |
| +0x1E | 8 bytes | preamble | `PREAMBLE`, `u32` 0. | **S** (6,140) | <!-- EXT-8.9.2-005 --> |
| +0x26 | lstr | name | Empty on all 6,140. | **O** | <!-- EXT-8.9.2-006 --> |
| next | lstr | source_library | Empty on all 6,140. | **O** | <!-- EXT-8.9.2-007 --> |
| next | u32 | colour | 48 on all 6,140. | **O** | <!-- EXT-8.9.2-008 --> |
| next | list | primitives | Primitive list (§8.2): count 1, one primitive, box 0, 0, 0, 0. | **S** (6,140) | <!-- EXT-8.9.2-009 --> |

The GraphicObject has 3 full prefixes, two empty strings, colour 48, one primitive and an all-zero box on every page graphic. **S** (6,140) <!-- EXT-7.15-021 -->

GraphicBitMapInst (62):

- Its GraphicObject holds one Bitmap in the corner layout (§8.4.7). **S** (11 of 11) <!-- EXT-8.9.4-001 -->
- The image payload, including any `~~CI_IMAGE~~` trailer, lies inside the Bitmap primitive's DIB. **S** (7 page bitmaps with a trailer) <!-- EXT-7.15-022 -->
- The raster location never equals the corners. **O** (11 of 11) <!-- EXT-8.9.4-002 -->

GraphicOleEmbedInst (89):

- Uses the page-graphic layout above. **S** (9) <!-- EXT-8.9.3-001 -->
- Transform `0x0030` (colour 48, rotation 0, no mirror), display count 0, symbol kind 2 and an empty symbol name on 9 of 9. **O** <!-- EXT-8.9.3-002 EXT-8.9.3-003 EXT-8.9.3-004 -->
- Its GraphicObject holds one kind-90 primitive carrying an embedded compound file; record lengths range from 131,650 to 4,626,498 bytes. **S** (9) <!-- EXT-8.9.3-006 EXT-7.15-023 -->
- The box is zero on 9 of 9; the location is 0, 0 on 2 of 9. **O** <!-- EXT-8.9.3-005 -->
- A reader that does not decode the OLE primitive can skip the record as one block bounded by its first full prefix. **S** (all 9 end exactly at their first-prefix stop) <!-- EXT-7.15-024 -->

### Unverified

- *unverified*: Listed values that never occur in the corpus: list colour 0 before a type-24 primitive list; OLE hdr1 5-10 and 12; DIB bit count 4; a SymbolVector with one child, and the u16-selector vector-child form; Polygon n 7, 9, 12; Polyline n 1, 8, 18, 29; Bezier n 4, 13; kind 44 in OffPageSymbol and TitleBlockSymbol lists. <!-- EXT-8.5-001 EXT-8.6.8-010 EXT-8.7.1-003 EXT-8.8-001 EXT-8.8-002 EXT-8.6.4-005 EXT-8.6.5-007 EXT-8.6.5-008 EXT-8.1-005 EXT-8.1-006 -->
- *unverified*: Type 57 GraphicArcInst carries one kind-42 Arc, and type 88 GraphicBezierInst carries one kind-87 Bezier. No type-57 or type-88 record exists in any of the 451 page streams; a fixture with a page Arc and a page Bezier graphic is needed. <!-- EXT-7.15-003 EXT-8.9.1-027 EXT-7.15-009 EXT-8.9.1-033 -->
- *unverified*: Coordinates (corners, points, locations, boxes) are in units of 1/100 inch. The unit cannot be shown from the bytes without Capture; coordinates are multiples of a 10-unit grid on lines and pins. <!-- EXT-8-005 -->
- *unverified*: BookMarkSymbol (76) holds a primitive list, stored in the Cache and `Symbols/*`, in symbol coordinates, with kind 40. No type-76 body exists in any Cache or `Symbols/*` stream; a fixture with a bookmark is needed. <!-- EXT-8.1-008 -->
- *unverified*: A cornerless Bitmap layout without placement corners: +0x0A `i32 raster_x` (also the placement location), +0x0E `i32 raster_y`, +0x12 `u32 pixel_width` (also the placement width), +0x16 `u32 pixel_height` (also the placement height), +0x1A `u32 dib_length`, +0x1E `dib`; length 24 + dib_length. A reader would tell it from the corner layout by the length rule (44 + dib_length against 24 + dib_length), not by comparing raster location with corners. No bitmap in the corpus uses it (45 of 45 use corners). <!-- EXT-8.6.7-014 EXT-8.6.7-015 EXT-8.6.7-016 EXT-8.6.7-017 EXT-8.6.7-018 EXT-8.6.7-019 EXT-8.6.7-020 EXT-8.6.7-021 EXT-8.6.7-022 -->
- *unverified*: SymbolVector nesting is limited to 64 levels. No nested SymbolVector exists in the corpus. <!-- EXT-8.8-013 -->
- *unverified*: Extension sub-record kind 8, version 6 (line endings) occurs only in primitive extensions, never in a preamble. Its text is three decimal `i32` values, `"<startShape> <endShape> <arrowHeadSize> "`, the Polyline end shapes; when all three are 0 (the default) the record is omitted. No kind-8 record exists in any of the 38,826 entries: every non-CommentText wrapper has E = 0, and all 318 Polylines have none. <!-- EXT-3.4-016 EXT-16.3.5-001 EXT-16.3.5-002 -->

### Open questions

- Arc sweep direction from start to end: not decidable from the bytes; needs rendering. <!-- EXT-8.6.3-013 EXT-8.oq-008 -->
- Whether a Polygon whose last point differs from its first is closed back to the first point: 227 of 963 polygons do not repeat the first point; closure is not decidable from the bytes. <!-- EXT-8.6.4-010 EXT-8.oq-008 -->
- Whether a Bezier is a start point followed by k cubic segments of two control points and an end point each: the 3 Beziers (n = 10) cannot decide the segment structure. <!-- EXT-8.6.5-009 -->
- Polyline end shapes: which numbers denote which arrow shapes, and whether other kinds may carry them. No end-shape record exists in the corpus. <!-- EXT-16.3.5-003 EXT-8.oq-001 -->
- Bytes after the pixel rows of a DIB without a CI_IMAGE trailer: EXT says such bytes may exist, start with zeros, and have unknown meaning. No DIB in the corpus has them (31 of 31). <!-- EXT-8.7.1-005 EXT-8.oq-010 -->
- The CI_IMAGE id byte: 0 on 14 of 14; meaning unknown. <!-- EXT-8.7.2-003 EXT-8.oq-009 -->
- The raster location of page bitmaps: never equal to the corners, non-zero, positive x (11 of 11); meaning unknown. <!-- EXT-8.7.1-007 EXT-8.oq-002 -->
- The OLE opaque words and `hdr1`: small integers, words 2 and 3 equal the corner width and height on 6 of 9; `hdr1` is 1 to 4. <!-- EXT-8.oq-003 -->
- The 19-byte kind-0 / version-2 sub-record with payload `05 00 00 00 00 00 00` on page graphics, which EXT reads as a lock flag: it occurs on 2 page Rects only (the other 433 Rects and all 1,427 Lines have none). <!-- EXT-7.15-012 EXT-8.9.1-005 EXT-8.oq-004 -->
- GraphicObject short-prefix count 0 against -1: both occur (5,755 and 385); no correlate tested. <!-- EXT-8.9.2-010 EXT-8.oq-005 -->
- The high byte of `type_echo`: non-zero on 36% of page graphics and on 30% to 69% of other base records; flag or stray memory is unknown. <!-- EXT-8.9.1-023 EXT-8.oq-006 -->
- The meaning of a page graphic's instance location beyond equalling the primitive's first corner on 911 of 6,140. <!-- EXT-8.9.1-022 EXT-8.oq-007 -->

### Refuted

| Claim | Source | What the files show | Evidence | ids |
| --- | --- | --- | --- | --- |
| A CommentText always has `PREAMBLE` after its text | EXT §8.6.6 | 3,304 CommentText entries (bare form, Library 3.2) end right after the text with length 31 + n; 4,682 have it (§8.3). | **S** | <!-- EXT-8.6.6-009 --> |
| A page graphic's location is non-zero except comment text and bitmaps | EXT §7.15 | Location 0, 0 on 150 CommentText, 5 Rects and 2 OLE graphics; on no Bitmap. | **O** | <!-- EXT-7.15-018 --> |
| An OLE instance has a non-zero location | EXT §8.9.3 | Location 0, 0 on 2 of 9 OLE instances (box zero on 9 of 9). | **O** | <!-- EXT-8.9.3-005 --> |
| Only page bitmaps carry a CI_IMAGE trailer | EXT §8.9.4 | 7 trailers sit in TitleBlockSymbol (64) bitmaps in the Cache, besides 7 page bitmaps. | **O** | <!-- EXT-8.9.4-003 --> |
| Base S+0x04 is `loc_y` and S+0x06 is `loc_x` | INT §7.8 | S+0x04 is bbox y1 and S+0x06 bbox x1. Read INT's way, the location lies outside the box on all 14,638 placed instances, 3,048 Globals, 3,463 off-page connectors, 1,141 Ports (§8.8). | **S** | <!-- INT-7.8-008 INT-7.8-009 --> |
| Base S+0x0C is bbox x1 and S+0x0E is bbox y1 | INT §7.8 | S+0x0C is loc_x and S+0x0E loc_y (§8.8). | **S** | <!-- INT-7.8-012 INT-7.8-013 --> |

### Parser divergences

Resolved: `parseGraphicInstBase` (`structures.ts`) now reads the box corners y1, x1, y2, x2 and then the location x, y, so ports, Globals and off-page connectors carry their stored box and true location. `symbol-attachment.ts`, `net-pins.ts` and `page-groups.ts` therefore test the stored box. **E**: netlist coverage against Capture's exports is unchanged by the fix (fixtures 100% on every measure; corpus designs with exports unchanged). <!-- INT-7.8-008 INT-7.8-009 INT-7.8-012 INT-7.8-013 --> |

<!-- meta: EXT-0.2-011 EXT-8-001 EXT-8-006 EXT-8.1-010 EXT-8.6.8-018 INT-7.8-001 -->

Parser coverage: the parser reads the graphic-instance base of Globals, Ports and off-page connectors (name and library indices, symbol name, db_id, box and location under INT's field names, display records, symbol kind) and the 9-byte Port and 5-byte Global/off-page tails; it reads a primitive list's count and skips the list by its boundary without decoding any primitive (INT-13.2-005), skips the transform word, and does not read page graphic instances, GraphicObjects, bitmaps, OLE objects or SymbolVectors (the page parser stops before list 12). <!-- INT-13.2-005 -->

Page rendering (`render_page`) additionally decodes every primitive kind it draws (Rect, Ellipse, Line, Arc, Polygon, Polyline, Bezier, CommentText, SymbolVector) in both entry forms by the common end rule, and the page-graphics list (list 12); Bitmap and OLE entries are skipped by length and not drawn.

---

## 9. Text, fonts, colours and display

This chapter covers how text and styling are stored: displayed property labels (SymbolDisplayProp, type 39), font references and the Library font table, colours, line styles and widths, fills and hatches, the transform word (colour, rotation, mirror), text justification, and the net style overrides kept as properties. Rendering a schematic needs all of them together with the primitives of §8.

### 9.1 SymbolDisplayProp (39)

A SymbolDisplayProp is a framed record that places one property label of its owner at an offset from the owner. The owner stores a `u16` count followed by that many type-39 records. **S** (76,941 display records, in every owner decoded) <!-- EXT-9.1-002 -->

Owners:

| Owner | Displays | Per owner | Evidence | ids |
| --- | --- | --- | --- | --- |
| Placed instance (13) | 43,313 | 1-9 | **S** | <!-- EXT-9.1-003 --> |
| Pin instance (16) | 1,056 | | **S** | <!-- EXT-9.1-003 --> |
| DrawnInstance (12) | 328 | 1-2 | **S** | <!-- EXT-9.1-004 --> |
| Global (37) | 3,745 | | **S** | <!-- EXT-9.1-005 --> |
| OffPageConnector (38) | 10,998 | | **S** | <!-- EXT-9.1-005 --> |
| Port (23) | 2,135 | | **S** | <!-- EXT-9.1-005 --> |
| TitleBlock (65) | 3,382 | | **S** | <!-- EXT-9.1-005 --> |
| Wire (20, 21) | 139 on 109 wires | 1-2 | **S** | <!-- EXT-7.2-001 --> |
| Page graphics (55-62, 88, 89) | count field present, always 0 | 0 | **O** (6,140) | <!-- EXT-9.1-006 --> |
| Cached LibraryPart (24) | 9,578 | | **S** | <!-- EXT-9.1-007 --> |
| GlobalSymbol (33) | 175 | | **S** | <!-- EXT-9.1-007 --> |
| PortSymbol (34) | 127 | | **S** | <!-- EXT-9.1-007 --> |
| OffPageSymbol (35) | 123 | | **S** | <!-- EXT-9.1-007 --> |
| TitleBlockSymbol (64) | 865 | | **S** | <!-- EXT-9.1-007 --> |
| ErcSymbol (75) | 0 | | **S** | <!-- EXT-9.1-007 --> |
| Cached symbol pin (26) | 977 | 0-2 | **S** | <!-- EXT-9.1-008 --> |

Wires carry displays too, which EXT's owner list omits. <!-- EXT-7.2-001 -->

#### 9.1.1 Frame

| Offset | Size | Field | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | 9 | outer prefix | Full prefix of type 39; boundary = end of the record. | **S** (76,941) | <!-- EXT-9.1.1-001 EXT-5.3.6-002 --> |
| +0x09 | 9 | base prefix | Full prefix of type 39; boundary = start of the body (end of the preamble). | **S** (76,941) | <!-- EXT-9.1.1-002 EXT-5.3.6-002 --> |
| +0x12 | 3 | short prefix | `27 FF FF`: type 39, property count -1. | **S** (76,941) | <!-- EXT-9.1.1-003 EXT-5.3.6-003 --> |
| +0x15 | 4 | magic | `PREAMBLE` `FF E4 5C 39`, always present. | **S** (76,941) | <!-- EXT-9.1.1-004 EXT-5.3.6-004 INT-7.9-002 --> |
| +0x19 | u32 | E | Extension size: 0, 16, 20, 21, 22 or 23. | **S** | <!-- EXT-9.1.1-005 --> |
| +0x1D | E | extension | Sub-records (§9.1.3). | **S** (76,941) | <!-- EXT-9.1.1-006 --> |
| +0x1D + E | 14 | body | §9.1.2. | **S** (76,941) | <!-- EXT-9.1.1-007 --> |

- F = 2, short count -1, a preamble with zero or one sub-record. **S** (76,941, of which 11,845 are symbol and pin displays in the Cache, `Packages/*`, `Symbols/*` and drawn parts) <!-- EXT-7.2-002 EXT-5.3.6-002 -->
- The record is always 43 + E bytes; the body is exactly 14 bytes and ends at the record end. **S** (76,941) <!-- EXT-9.1.1-008 EXT-7.2-012 EXT-5.3.6-016 -->
- E = 16 occurs on 112 Port displays with a one-number justification record (§9.8), outside EXT's list (0, 19, 20-25, 39-42). <!-- EXT-9.1.1-005 -->
- Extension sizes in the Cache: symbol displays 0, 20, 21, 23; pin displays 0 except 4 cached pin displays with E = 22 or 23 (justification records). **S** <!-- EXT-5.3.6-005 -->

#### 9.1.2 Body

Offsets from the body start (the end of the preamble). Every row holds on all 76,941 displays, each ending exactly at its first-prefix stop.

| Offset | Type | Field | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | name_index | Library string-table index of the property name; inside the string table on all records. | **S** | <!-- EXT-9.1.2-001 EXT-5.3.6-006 EXT-7.2-003 INT-7.9-003 --> |
| +0x04 | i16 | x | Text offset x from the owner's location. | **S** | <!-- EXT-9.1.2-002 EXT-5.3.6-007 EXT-7.2-004 INT-7.9-004 --> |
| +0x06 | i16 | y | Text offset y. | **S** | <!-- EXT-9.1.2-003 EXT-5.3.6-008 EXT-7.2-005 INT-7.9-004 --> |
| +0x08 | u16 | font_rotation | Bits 0-13: font reference, 0 to F, never above F (§9.3). Bits 14-15: rotation (§9.7), values 0 (74,400), 1 (2,531), 3 (10). | **S** | <!-- EXT-9.1.2-004 EXT-5.3.6-009 EXT-7.2-006 EXT-2.5.2-003 EXT-16.4.3-001 INT-7.9-005 INT-7.9-006 INT-7.9-007 --> |
| +0x0A | u8 | colour | Colour (§9.4); values 8, 22, 24, 28, 30, 32, 33, 36, 40, 48. | **S** | <!-- EXT-9.1.2-005 EXT-5.3.6-011 EXT-7.2-007 EXT-16.2.4-008 INT-7.9-008 --> |
| +0x0B | u8 | opaque | Any value: 0 on 42,208, printable ASCII on 24,946 (space alone 3,688), other on 9,787; all 256 values occur. | **S** / **O** | <!-- EXT-5.3.6-013 EXT-7.2-008 EXT-5.3.6-014 EXT-9.1.2-006 --> |
| +0x0C | u16 | display_mode | DisplayMode (below), unaligned. Values 0 (1,032), 1 (75,824), 2 (67), 3 (18); high byte (+0x0D) always 0. | **S** | <!-- EXT-9.1.2-009 EXT-5.3.6-015 EXT-7.2-009 EXT-16.4.1-001 INT-7.9-010 --> |

- Font-rotation bits 14-15 take only 0, 1 and 3. **O** <!-- EXT-16.2.2-007 -->
- Cache display rotations are 0 and 1 only (25 cached symbol displays and 74 cached pin displays with r = 1). **O** <!-- EXT-5.3.6-010 -->
- Cache display colours: symbol displays 22, 24, 28, 30, 32, 33, 36, 48; pin displays 48 only. **O** <!-- EXT-5.3.6-012 -->
- Whether the opaque byte repeats across one owner's displays, is independent of the justification, or differs between two copies of one definition was not tested. <!-- EXT-9.1.2-006 EXT-5.3.6-014 -->
- Bytes +0x0B..+0x0D are not one 2-byte visibility field followed by a zero byte: +0x0B varies freely while +0x0C..+0x0D is the display mode (see Refuted). <!-- INT-7.9-010 -->

DisplayMode (`u16` at body +0x0C):

| Value | EXT name | Count | Status | ids |
| --- | --- | --- | --- | --- |
| 0 | DoNotDisplay | 1,032 | value occurs; name unverified | <!-- EXT-9.1.4-001 EXT-5.3.6-017 EXT-16.4.1-002 --> |
| 1 | ValueOnly | 75,824 | value occurs; name unverified | <!-- EXT-9.1.4-002 EXT-5.3.6-018 EXT-16.4.1-003 --> |
| 2 | NameAndValue | 67 | value occurs; name unverified | <!-- EXT-9.1.4-003 EXT-5.3.6-019 EXT-16.4.1-004 --> |
| 3 | NameOnly | 18 | value occurs; name unverified | <!-- EXT-9.1.4-004 EXT-5.3.6-020 EXT-16.4.1-005 --> |
| 4 | BothIfValued | 0 | unverified | <!-- EXT-9.1.4-005 EXT-5.3.6-021 EXT-16.4.1-006 EXT-7.18-006 --> |

- Values 5 and above never occur, including 5 to 15. **O** (76,941) <!-- EXT-9.1.4-006 EXT-16.4.1-007 -->
- Cache display modes: symbol displays 1 and 2 (2 on 39 type-24 displays); pin displays 0 and 1. **O** <!-- EXT-5.3.6-023 EXT-16.4.1-011 -->

#### 9.1.3 Extension

A display extension holds at most one flag record and at most one justification record, in that order. **S** (76,941; only empty extensions and single justification records occur) <!-- EXT-9.1.3-001 -->

The justification record is a sub-record of kind 6, version 6. **S** (202 displays, only on type 39) <!-- EXT-9.1.3-013 EXT-3.4-014 -->

| Offset | Type | Field | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | record_length | 15 + text length; values 16, 20, 21, 22, 23. | **S** (202) | <!-- EXT-9.1.3-014 --> |
| +0x04 | u32 | kind | 6. | **S** (202) | <!-- EXT-9.1.3-015 --> |
| +0x08 | u32 | version | 6. | **S** (202) | <!-- EXT-9.1.3-016 --> |
| +0x0C | var | text | ASCII decimal integers separated by single spaces: `"<j> <anchor_x> <anchor_y>"` (90 records) or a lone `"<j>"` (112 records, all `3`, on Port displays of one design). | **S** | <!-- EXT-9.1.3-017 EXT-3.4-014 --> |
| after text | 3 | terminator | `00 00 00`. | **S** (202) | <!-- EXT-9.1.3-018 --> |

- The first number is the justification code (§9.8); the second and third, when present (90 of 202), are the anchor point. Codes seen: 0, 1, 3, 24. **O** <!-- EXT-9.1.3-019 -->
- A record whose first number is 0 occurs. **O** (19) <!-- EXT-9.1.3-021 -->
- 76,739 displays have no justification record. <!-- EXT-9.1.3-020 -->

### 9.2 Attribute-lock record

A placed instance (13) or DrawnInstance (12) carries one sub-record of kind 2, version 6 in its own preamble, never in its display records. **S** (3,309 placed, 56 drawn instances). That it records which displays the user edited is per name only. <!-- EXT-9.1.5-001 -->

- The payload is ASCII: a decimal row count, then per row `name`, `flags`, `owner`, `value`. **S** (3,365 payloads parse fully; the count is always 1) <!-- EXT-9.1.5-002 -->
- `name`, `owner` and `value` are written `<decimal length><space><bytes>`; `flags` is decimal; tokens are separated by spaces; the payload ends with three `00` bytes. **S** (3,365 of 3,365) <!-- EXT-9.1.5-003 -->
- Rows are almost always named `Reference` (3,364). A display matches a row of the same name only rarely (58 of 12,182 displays); the display property `Part Reference` matches the row `Reference`. **O** (3,307 of 3,308 `Part Reference` displays on instances with a lock record have exactly one `Reference` row; 1 has none) <!-- EXT-9.1.5-004 EXT-9.1.5-005 EXT-3.4-022 -->
- `flags` values: 0 (2,771), 128 (593), 13 (1). That bit 7 marks a user edit is per name only. **O** <!-- EXT-9.1.5-006 -->

### 9.3 Fonts

The Library stream holds the font table followed by `u16 24` and 24 default-font slots; the string table parses after them. **S** (105 Libraries) <!-- EXT-9.2.1-001 -->

- Font rows are numbered from 1; an explicit reference k selects row k. **O** (explicit references reach exactly F, the row count, on 138 displays and 66 CommentTexts, and never exceed it on 76,941 displays, 7,986 CommentTexts and 16,165 aliases) <!-- EXT-9.2.1-002 EXT-4.5-003 EXT-16.4.3-005 EXT-9.2.2-005 -->
- Each default slot holds a row number 0 to F. **O** (105 files) <!-- EXT-9.2.1-003 -->
- Zero slots are always slots 3, 4 and 17 to 23; every other slot is non-zero. **O** (105 of 105; EXT also lists "no slot" and "slot 10 only", which do not occur) <!-- EXT-9.2.1-004 -->

Where font references are stored:

| Field | Encoding | Values | Evidence | ids |
| --- | --- | --- | --- | --- |
| SymbolDisplayProp `font_rotation` (u16) | bits 0-13; bits 14-15 are rotation | 0 to F (0 on 66,705) | **S** (76,941) | <!-- EXT-9.2.2-001 --> |
| CommentText `font` (u32, §8.4.6) | bits 0-15; bits 16-31 opaque | 1 to F | **O** (7,986) | <!-- EXT-9.2.2-002 --> |
| Alias (49) `font` (u32) at +0x10 | bits 0-15; bits 16-31 opaque | low 16 bits 0 (13,484) or 1 to F (2,681); high 16 bits non-zero on 9,406 (`0x8000` on 4) | **O** (16,165) | <!-- EXT-9.2.2-003 EXT-7.8-007 --> |

- No display, CommentText or alias reference exceeds F. **O** <!-- EXT-9.2.2-006 -->
- The upper 16 bits of CommentText and alias references take `0x0000`, `0x8000` and many other values. **O**. Whether they change between saves without a font change was not tested. <!-- EXT-9.2.2-007 -->

### 9.4 Colour

A colour is a small integer 0 to 48 stored in two widths:

| Width | Fields | Evidence | ids |
| --- | --- | --- | --- |
| u8 | Transform word bits 0-7 (40,800 base records); SymbolDisplayProp body +0x0A (76,941) | **S** | <!-- EXT-2.5.3-002 EXT-16.2.4-007 EXT-7.0.4-001 --> |
| u32 | Wire colour (85,489); SchematicNet and NetBus colour (27,130 + 1,212); alias colour; the colour before every primitive list (§8.2) | **S** | <!-- EXT-2.5.3-003 --> |

- The Hierarchy net-format colour is a text property (`Color`, §9.9), not a `u32`. <!-- EXT-2.5.3-003 -->
- No colour field holds a value above 48. **O** (displays 76,941; transforms 40,800; wires 85,489; aliases 16,165; nets 28,342) <!-- EXT-2.5.3-007 EXT-9.3-007 EXT-16.2.4-006 EXT-2.5.3-004 EXT-7.18-003 -->
- Values seen across all fields: 1, 8, 9, 10, 15, 17, 18, 22, 24, 25, 26, 28, 30, 32, 33, 34, 36, 38, 40, 45, 47, 48. Page-object colour fields hold 1 to 48. 46 never occurs. **O** <!-- EXT-9.3-003 EXT-16.2.4-002 EXT-9.3-005 EXT-16.2.4-004 EXT-7.0.5-004 -->
- 48 is by far the most common value in every colour field (for example 66,239 of 76,941 displays). <!-- EXT-2.5.3-006 -->

Colour values per field:

| Field | Values seen | Evidence | ids |
| --- | --- | --- | --- |
| SymbolDisplayProp +0x0A | 8, 22, 24, 28, 30, 32, 33, 36, 40, 48 | **S** | <!-- EXT-9.3-008 --> |
| Placed instance (13) transform | 48 (14,325), 43 (684) | **O** | <!-- EXT-9.3-009 --> |
| Global (37) transform | 48 (8,329), 8 (13) | **O** | <!-- EXT-9.3-010 --> |
| OffPageConnector, Port, TitleBlock, ErcObject, DrawnInstance transform | 48 only (6,491 / 2,135 / 443 / 2,066 / 174) | **O** | <!-- EXT-9.3-011 --> |
| Page graphic instance transform | 8, 9, 15, 18, 24, 25, 26, 28, 34, 36, 40, 48 | **O** | <!-- EXT-9.3-012 --> |
| GraphicObject (2) list colour | 48 (6,140) | **O** | <!-- EXT-9.3-013 --> |
| Cached symbol body (24, 33, 34, 35, 64, 75) list colour | 48 (5,680); 0 not seen | **S** | <!-- EXT-9.3-014 --> |
| Wire (20, 21) | 48 (85,469), 8 (20) | **O** | <!-- EXT-9.3-015 --> |
| Alias (49) | 1, 8, 10, 17, 26, 28, 32, 38, 40, 45, 47, 48 | **O** | <!-- EXT-9.3-016 --> |
| SchematicNet (52), NetBus (53) | 48 (27,130 + 1,212) | **O** | <!-- EXT-9.3-017 --> |

### 9.5 Line style and line width

LineStyle and LineWidth are each stored as a `u32` whose value fits one byte. **S** <!-- EXT-9.4-013 EXT-16.3.1-001 EXT-16.3.2-001 -->

| Enum | Range seen | Never used | Evidence | ids |
| --- | --- | --- | --- | --- |
| LineStyle | 0-5 | 6 and above | **O** (primitives, wires, net headers) | <!-- EXT-9.4-007 EXT-16.3.1-008 --> |
| LineWidth | 0-3 | 4 and above | **O** | <!-- EXT-9.4-012 EXT-16.3.2-006 --> |

Fields: `line_style` and `line_width` of Rect, Ellipse, Line, Arc, Polygon, Polyline and Bezier (§8.4); the wire's line width and style; the net header's style and width. **S**. The page-settings outer line style and width were not checked here. <!-- EXT-16.3.1-009 EXT-16.3.2-007 -->

Field order:

- Primitives store style then width. **O** (over 30,786 primitives the first field reaches 4 and 5, the second never exceeds 3) <!-- EXT-9.4-014 EXT-16.3.2-009 -->
- Wires store width then style. **O** (85,489: first field 0, 1 or 3, second always 5) <!-- EXT-9.4-015 -->
- Net headers store colour, style, width. **O** (48 / 5 / 3 on 28,342 headers) <!-- EXT-9.4-016 -->

Values per owner:

| Owner | LineStyle | LineWidth | Evidence | ids |
| --- | --- | --- | --- | --- |
| Arc | 0 | 0, 1 | **O** | <!-- EXT-9.4-017 --> |
| Bezier | 0 | 0 | **O** | <!-- EXT-9.4-017 --> |
| Ellipse | 0 | 0, 1, 2 | **O** | <!-- EXT-9.4-018 --> |
| Polyline | 0, 1, 2, 4, 5 (2, 4, 5 on page Polylines) | 0, 1 | **O** | <!-- EXT-9.4-019 --> |
| Polygon | 0, 3 (3 on one page Polygon) | 0, 1 | **O** | <!-- EXT-9.4-020 --> |
| Rect | 0-3 | 0-3 | **O** | <!-- EXT-9.4-021 --> |
| Line | 0-4 | 0-3 | **O** | <!-- EXT-9.4-022 --> |
| Wire | 5 | 0, 1, 3 | **O** | <!-- EXT-9.4-023 --> |
| Net header | 5 | 3 | **O** | <!-- EXT-9.4-024 --> |

LineStyle 4 occurs on 3 page Lines and 2 page Polylines. <!-- EXT-16.3.1-012 -->

### 9.6 Fill and hatch

Fill (`u32`) and Hatch (`i32`) are stored on Rect, Ellipse and Polygon only; every other kind decodes without them. **S** <!-- EXT-9.5-001 EXT-9.5-002 EXT-9.5-008 EXT-16.3.3-001 EXT-16.3.4-001 -->

- Fill values: 0 (2,052), 1 (6,160), 2 (143); 3 and above never occur. **O** <!-- EXT-9.5-007 EXT-16.3.3-005 -->
- Fill 0 is solid and fill 1 hollow: drawing with that reading (the names EXT gives) reproduces the symbols as Capture shows them on the rendered fixture pages, with IC, connector and title-block outlines hollow and arrowheads and diode bodies filled, while the opposite reading fills every IC body. **O** (new; rendered pages of `MULTIO.DSN` and `meta_carrier_sch_rev1.dsn`). Fill 2 is drawn hollow; its meaning stays open.
- Fill 2 always pairs with hatch 3, 4 or 5 (2/3: 2, 2/4: 124, 2/5: 17). **O** (143 of 143). EXT's name "Hatched" for it is unconfirmed. <!-- EXT-16.3.3-004 -->
- Hatch values: -1 (132, with fill 0 or 1), 0 (8,069), 2 (4 Polygons in the Cache, fill 0), 3 (2), 4 (131), 5 (17); nothing outside -1 to 6, and 6 never occurs. **O** <!-- EXT-9.5-016 EXT-16.3.4-009 -->

| Kind | (fill, hatch) pairs seen | Evidence | ids |
| --- | --- | --- | --- |
| Rect | 0/0, 1/-1, 1/0, 2/3, 2/5 | **O** | <!-- EXT-9.5-017 EXT-16.3.4-010 --> |
| Ellipse | 0/-1, 0/0, 1/-1, 1/0, 2/4, 2/5 | **O** | <!-- EXT-9.5-018 EXT-16.3.4-011 --> |
| Polygon | 0/-1, 0/0, 0/2, 0/4, 1/-1, 1/0 | **O** | <!-- EXT-9.5-019 EXT-16.3.4-012 --> |

EXT's lists differ: Rect 2/3, Ellipse 2/5 and Polygon 0/2, 0/4 are pairs EXT does not list. <!-- EXT-9.5-017 EXT-9.5-018 EXT-9.5-019 -->

### 9.7 Transform word, rotation and mirror

The transform word is a `u16` at S+0x10 of the graphic-instance base (§8.8), carried by types 12, 13, 23, 37, 38, 55-62, 65, 77, 88 and 89; it has the same layout in every record type. **S** (40,800 words on types 12, 13, 23, 37, 38, 55, 56, 58-62, 65, 77, 89; types 57 and 88 have no records) <!-- EXT-16.2.1-001 EXT-9.6-001 EXT-7.0.4-005 -->

| Bits | Mask | Field | Values | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| 0-7 | `0x00FF` | colour | 0-48 (§9.4) | **S** (40,800) | <!-- EXT-7.0.4-001 EXT-16.2.1-002 --> |
| 8-9 | `0x0300` | rotation r | 0-3 | **O** | <!-- EXT-7.0.4-002 EXT-16.2.1-003 --> |
| 10 | `0x0400` | mirror | 0 or 1 | **O** | <!-- EXT-7.0.4-003 EXT-16.2.1-004 EXT-16.2.3-001 --> |
| 11-15 | `0xF800` | | always 0 | **O** (40,800) | <!-- EXT-7.0.4-004 EXT-16.2.1-005 --> |

Rotation r is a count of quarter turns: r x 90 degrees. With y pointing down the page a local point (x, y) maps to:

| r | Degrees | Maps (x, y) to | Placed instances matched (unmirrored + mirrored) | ids |
| --- | --- | --- | --- | --- |
| 0 | 0 | (x, y) | 8,330 unmirrored | <!-- EXT-16.2.2-002 --> |
| 1 | 90 | (y, -x) | 3,557 + 68 | <!-- EXT-16.2.2-003 --> |
| 2 | 180 | (-x, -y) | 674 + 180 | <!-- EXT-16.2.2-004 --> |
| 3 | 270 | (-y, x) | 572 + 194 | <!-- EXT-16.2.2-005 --> |

Mirror 1 negates x before the rotation. **O** (all 890 mirrored placed instances match only with x negated first) <!-- EXT-16.2.3-003 EXT-9.6-007 EXT-7.18-002 -->

How it was proven: for every placed instance with at least two distinct pins, the deltas between its page pin positions equal the deltas between its cached symbol's pin hot points after applying the rotation and mirror above. **O** (14,023 of 14,023 instances: r = 0 on 8,778, r = 1 on 3,625, r = 2 on 854, r = 3 on 766, mirrored ones included) <!-- EXT-7.0.4-002 EXT-7.0.4-003 EXT-9.6-005 EXT-9.6-006 EXT-16.2.2-001 EXT-7.18-001 -->

Rotation and mirror per owner:

| Owner | r seen | Mirror 1 seen | Evidence | ids |
| --- | --- | --- | --- | --- |
| Placed instance, Global, OffPageConnector | 0-3 | yes (Global 734, off-page 2,142) | **O** | <!-- EXT-9.6-002 EXT-16.2.2-006 INT-7.8-015 --> |
| Port | 0-3 | yes (391) | **O** | <!-- EXT-9.6-002 EXT-16.2.2-006 --> |
| DrawnInstance | 0-3 | yes (8) | **O** | <!-- EXT-9.6-002 --> |
| TitleBlock | 0, and 1 on one record | no | **O** | <!-- EXT-9.6-002 --> |
| ErcObject | 0 | no | **O** | <!-- EXT-9.6-002 --> |
| Page graphics | 0; CommentText 0, 1, 3 | no | **O** | <!-- EXT-9.6-002 EXT-16.2.2-006 --> |
| SymbolDisplayProp (font_rotation bits 14-15) | 0, 1, 3 | not stored | **O** | <!-- EXT-9.6-003 --> |
| Alias (49), `u32 rotation` | 0, 1 (3 never occurs) | not stored | **O** | <!-- EXT-9.6-004 EXT-16.2.2-008 --> |

### 9.8 Justification

The justification code is the first number of a kind-6 / version-6 sub-record (§9.1.3). All 202 such records sit in display preambles; no CommentText extension holds one (all are empty). **O** <!-- EXT-9.9-001 EXT-16.4.2-001 -->

| Code | EXT name | Records | Status | ids |
| --- | --- | --- | --- | --- |
| 0 | Default (also: no record) | 19 | value occurs; name per name only | <!-- EXT-9.9-002 EXT-16.4.2-002 --> |
| 1 | Start | 45 | value occurs; meaning unverified | <!-- EXT-9.9-004 EXT-16.4.2-003 --> |
| 2 | Centre | 0 | unverified | <!-- EXT-9.9-005 EXT-16.4.2-004 --> |
| 3 | End | 123 (112 of them one-number texts) | value occurs; meaning unverified | <!-- EXT-9.9-006 EXT-16.4.2-005 --> |
| 24 | none | 15 (one design: cached `'24 0 0'`, page `'24 20 0'`) | occurs | <!-- EXT-9.9-007 EXT-16.4.2-006 EXT-7.18-007 EXT-7.2-013 --> |

Anchor point (second and third numbers):

- Present in 90 of 202 records. Anchors equal the display's own (x, y) in 42 records, are 0 0 in 133, and hold other values in 27. **O** <!-- EXT-7.2-014 EXT-16.4.2-007 -->
- Rotation 0, code 1: the anchor is the display's (x, y). **O** (29 of 33 anchors; the other 4 are 0 0) <!-- EXT-9.9-012 -->
- Rotation 0, code 3: the 3 non-zero anchors lie at (x, y) plus positive offsets (76 are 0 0); whether the offsets equal the text size was not checked. **O** <!-- EXT-9.9-014 -->
- Rotation-0 anchors are zero or follow these rules; the 24 anchors of rotated (r = 1) displays are neither zero nor covered by any stated rule. **O** <!-- EXT-9.9-008 -->

### 9.9 Net colour and style overrides

Hierarchy nets carry their display overrides as text properties, not as binary fields. In the corpus: 13 `Color` properties, all `Default`; `Line Width` values `Thin` (2 nets) and `Default` (11); `Line Style` values `Solid` (2 Hierarchy nets) and `Default` (11). `Wide`, `Medium`, `Dash`, `Dot`, `Dash Dot` and `Dash Dot Dot` never occur. Every page net header keeps style 5 and width 3 regardless, so no text-to-enum mapping is testable. **O** <!-- EXT-16.8.4-007 EXT-16.8.4-010 EXT-16.8.4-011 EXT-16.8.4-012 EXT-16.8.4-013 -->

### Unverified

- *unverified*: Listed values that never occur in the corpus: symbol-body colour 0; display extensions with two sub-records; display E 19, 24, 25, 39-42; justification record lengths 24, 25; justification code 2; cached symbol display colours 8, 37 and pin display colours 36, 47; cached symbol display modes 0, 3, 4; display colours 5, 13, 15, 18, 19, 25-27, 29, 31, 35, 37-39, 43-45, 47; placed-instance colours 2, 3, 5, 8, 18, 26; Global colour 43; page-graphic colours 0-5, 7, 10-14, 17, 20-23, 27, 29-33, 35, 37-39, 41-44, 47; wire colours 15, 16, 23-29, 31-34, 37, 40, 44; alias colours 3, 5, 15, 24, 25, 30, 31; net-header colours 0, 2-20, 22-26, 28, 29, 31-34, 36-41, 44; LineStyle 2, 5 on Ellipses, 5 on Rects and Lines, 1, 2 on Polygons, 0, 1, 2 on wires, 0, 1 on net headers; LineWidth 2 on Polygons and 0, 1 on net headers; fill/hatch pairs Rect 0/-1, 0/5, Ellipse 0/6, 1/6, 2/3, Polygon 2/3; default-font zero-slot patterns 'none' and 'slot 10 only'; transform words on types 57 and 88. <!-- EXT-9.3-014 EXT-7.2-002 EXT-9.1.1-005 EXT-9.1.3-014 EXT-7.2-013 EXT-5.3.6-012 EXT-5.3.6-023 EXT-16.4.1-011 EXT-9.3-008 EXT-9.3-009 EXT-9.3-010 EXT-9.3-012 EXT-9.3-015 EXT-9.3-016 EXT-9.3-017 EXT-9.4-018 EXT-9.4-021 EXT-9.4-022 EXT-9.4-023 EXT-9.4-024 EXT-9.4-020 EXT-9.5-017 EXT-9.5-018 EXT-9.5-019 EXT-16.3.4-010 EXT-16.3.4-011 EXT-16.3.4-012 EXT-9.2.1-004 EXT-16.2.1-001 -->
- *unverified*: A display record draws one property of its owner (name, value or both) at a position relative to the owner. What is drawn needs Capture; the position fields hold small relative values. <!-- EXT-9.1-001 INT-7.9-001 -->
- *unverified*: Display body x, y is the position of the text box's first corner relative to the owner's location. The field layout holds; "first corner" is per name only. <!-- EXT-9.1.2-002 -->
- *unverified*: DisplayMode names 0 DoNotDisplay (nothing drawn), 1 ValueOnly (value drawn), 2 NameAndValue (`name=value` drawn), 3 NameOnly (name drawn), 4 BothIfValued (`name=value` only when the value is non-empty). Meanings per name only; mode 4 never occurs. <!-- EXT-9.1.4-001 EXT-9.1.4-002 EXT-9.1.4-003 EXT-9.1.4-004 EXT-9.1.4-005 EXT-5.3.6-017 EXT-5.3.6-018 EXT-5.3.6-019 EXT-5.3.6-020 EXT-5.3.6-021 EXT-16.4.1-002 EXT-16.4.1-003 EXT-16.4.1-004 EXT-16.4.1-005 EXT-16.4.1-006 EXT-7.18-006 -->
- *unverified*: DisplayMode values 16 and above occur on a few placed-instance displays (known 96, 258, `0x2022`, `0x2298`, `0x6361`, `0xC6A0`, `0xEAA0`, `0xF2BC`) and must be kept unchanged; more generally, values other than 0-4 occur and must be preserved. No mode outside 0-3 occurs in 76,941 displays. <!-- EXT-9.1.4-007 EXT-16.4.1-008 EXT-7.2-011 -->
- *unverified*: DisplayMode 4 almost always carries the value-if-exists flag record; with ValueOnly and that flag, nothing is drawn when the value is empty. Neither mode 4 nor the flag record occurs. <!-- EXT-9.1.4-010 EXT-16.4.1-010 EXT-9.1.4-011 EXT-7.2-015 -->
- *unverified*: The flag record (kind 0, version 2) in a display extension: +0x00 `u32 record_length` always 19, +0x04 `u32 kind` 0, +0x08 `u32 version` 2, +0x0C `u8 mode` (known 0, 5), +0x0D `u16 reserved` 0, +0x0F `u32 flag` (known 1, 0). Payload (+0x0C..+0x12) `00 00 00 01 00 00 00` on types 39 and 77 means value-if-exists: draw the display only when the property has a value. Flag 0 with mode 0 (off) is defined but never stored. No kind-0/version-2 record exists on any of the 76,941 displays or 2,066 ERC objects; a fixture using "value only if value exists" is needed. <!-- EXT-9.1.3-002 EXT-9.1.3-003 EXT-9.1.3-004 EXT-9.1.3-005 EXT-9.1.3-006 EXT-9.1.3-007 EXT-9.1.3-008 EXT-9.1.3-009 EXT-9.1.3-010 EXT-3.4-017 EXT-3.4-018 -->
- *unverified*: With no justification record the justification is 0. 76,739 displays have no record; the default is semantic. <!-- EXT-9.1.3-020 -->
- *unverified*: Justification 1 anchors the text box at its first corner (left, top), 2 at its centre, 3 at its far corner (right, bottom). Code 2 never occurs; the others need rendering. <!-- EXT-9.9-004 EXT-9.9-005 EXT-9.9-006 EXT-16.4.2-003 EXT-16.4.2-004 EXT-16.4.2-005 -->
- *unverified*: Display with rotation 0 and justification 2: anchor at (x, y) plus about half the text width and height. No display has code 2. <!-- EXT-9.9-013 -->
- *unverified*: CommentText justification anchors: code 1 at (bbox_x1, bbox_y1), code 2 at the text box centre rounded to a whole unit, code 3 at (bbox_x2, bbox_y2). No CommentText carries a justification record. <!-- EXT-9.9-009 EXT-9.9-010 EXT-9.9-011 -->
- *unverified*: A font reference of 0 is implicit and resolves through a default slot; the item takes the row in its category's slot, and if that slot is also 0 no stored font applies. References of 0 are common (66,705 displays, 13,484 aliases), but the bytes cannot show which slot a text uses; the relevant slots are non-zero in all 105 files. <!-- EXT-9.2.2-004 EXT-16.4.3-004 EXT-16.13.2-004 EXT-4.6-003 EXT-9.2.3-007 -->
- *unverified*: A font reference greater than F is unresolved. No reference exceeds F. <!-- EXT-16.4.3-006 -->
- *unverified*: Default slot consumers: slot 10 display-property text; slot 12 net alias text; slot 13 comment text in page graphics and in symbol bodies other than title blocks; slot 14 comment text in title-block symbols (type 64). Per name only; slot 10 is non-zero in all 105 files, and every CommentText reference is explicit (all 873 title-block ones included), so no implicit comment text exists to test. <!-- EXT-4.6-005 EXT-4.6-007 EXT-4.6-008 EXT-4.6-009 EXT-9.2.3-001 EXT-9.2.3-002 EXT-9.2.3-003 EXT-9.2.3-004 -->
- *unverified*: The LOGFONT escapement is a separate field in tenths of a degree, distinct from rotation. Escapement is 0 in the default-slot font rows of every file, so no link to rotation is testable. <!-- EXT-16.2.2-009 -->
- *unverified*: A colour is an index into a fixed 48-entry palette (0-47), and 48 is Default: no explicit colour, the owner's default applies (on a net header no override; on a wire the net's colour). The file stores no palette; the RGB value of each index is not part of the format. Index semantics and palette absence cannot be proven from the bytes; all colour fields hold 0-48 and 48 dominates. Whether each value 0-47 is one fixed palette colour is per name only, and 46 never occurs, so its meaning is untested. <!-- EXT-2.5.3-004 EXT-7.18-003 EXT-9.3-003 EXT-9.3-005 EXT-16.2.4-002 EXT-16.2.4-004 --> <!-- EXT-2.5.3-001 EXT-2.5.3-006 EXT-9.3-001 EXT-9.3-002 EXT-9.3-006 EXT-16.2.4-001 EXT-16.2.4-005 EXT-16.13.2-005 -->
- *unverified*: The only RGB values stored in a file are the texts of Hierarchy net `Color` properties, `RGB(r, g, b)`, with no palette mapping them to an index; `Default` is the default colour. All 13 `Color` properties are `Default`. <!-- EXT-9.3-018 EXT-16.8.4-003 EXT-16.8.4-004 -->
- *unverified*: LineStyle names 0 Solid, 1 Dash, 2 Dot, 3 DashDot, 4 DashDotDot, 5 Default (the owner's default; on a net header no override; on a wire the net's style). Per name only. <!-- EXT-7.18-004 EXT-9.4-001 EXT-9.4-002 EXT-9.4-003 EXT-9.4-004 EXT-9.4-005 EXT-9.4-006 EXT-16.3.1-002 EXT-16.3.1-003 EXT-16.3.1-004 EXT-16.3.1-005 EXT-16.3.1-006 EXT-16.3.1-007 -->
- *unverified*: LineWidth names 0 Thin, 1 Medium, 2 Wide, 3 Default (owner's default, as for LineStyle). Per name only. <!-- EXT-7.18-005 EXT-9.4-008 EXT-9.4-009 EXT-9.4-010 EXT-9.4-011 EXT-16.3.2-002 EXT-16.3.2-003 EXT-16.3.2-004 EXT-16.3.2-005 -->
- *unverified*: LineStyle 5 and LineWidth 3 mean Default. Net headers hold 5 / 3 on all 28,342 and wires hold style 5 on all 85,489; the meaning is semantic. <!-- EXT-16.13.2-006 -->
- *unverified*: Net `Line Width` text values map to LineWidth: `Thin` 0, `Medium` 1, `Default` 3; `Line Style` text `Default` maps to LineStyle 5. Untestable: page net headers stay 5 / 3. <!-- EXT-16.8.4-005 EXT-16.8.4-006 EXT-16.8.4-008 EXT-16.8.4-014 -->
- *unverified*: Fill 0 = Solid (filled), Fill 1 = None (not filled). Per name only. <!-- EXT-9.5-003 EXT-9.5-004 EXT-16.3.3-002 EXT-16.3.3-003 -->
- *unverified*: Mirror 0 means not mirrored. Consistent with 13,909 placed instances matching with no negation. <!-- EXT-16.2.3-002 -->

### Open questions

- The opaque display byte at body +0x0B: padding or a packed field. It takes all 256 values, 55% zero, 32% printable ASCII; no correlation with the display mode was found, which fits EXT's theory of uninitialised alignment padding. <!-- EXT-7.2-010 EXT-9.1.2-007 EXT-9.1.2-008 EXT-9.oq-001 -->
- The flag payload `05 00 00 00 00 00 00` (EXT's theory: locked): it never occurs on displays or placed instances; it occurs on 2 page Rects only. <!-- EXT-9.1.3-011 EXT-9.1.3-012 EXT-9.oq-002 -->
- How the flag record's `mode` byte relates to the value-if-exists flag: no flag record exists. <!-- EXT-9.oq-003 -->
- Display modes of 16 and above, their meaning and whether they are stray values: none exist in the corpus. <!-- EXT-9.1.4-008 EXT-9.oq-004 -->
- Which text categories default-font slots 0-9, 11 and 15-23 serve. Slots 3, 4 and 17-23 are 0 in all 105 files; slots 0-2, 5-9, 11, 15 and 16 are non-zero. <!-- EXT-4.6-004 EXT-4.6-006 EXT-4.6-010 EXT-4.oq-001 EXT-9.2.3-005 EXT-9.oq-006 -->
- The upper 16 bits of CommentText and alias font references: many distinct values on both. <!-- EXT-9.oq-007 -->
- The RGB value of each colour index: no palette is stored in any of the 105 files. <!-- EXT-2.5.3-005 EXT-2.oq-002 EXT-9.3-004 EXT-9.oq-008 EXT-16.2.4-003 EXT-16.oq-006 -->
- Whether the LOGFONT character set identifies the code page: not examined. <!-- EXT-16.oq-006 -->
- Whether the anchor of justification 0 equals that of 1 (j = 0 anchors are zero on 17, own x, y on 2), and the anchor rules for rotated displays (none of the stated rules covers them). <!-- EXT-9.9-003 EXT-9.oq-010 -->
- Hatch meanings: -1 (132 shapes; EXT's theory: no pattern), 0 (8,069), 3 (2), 4 (131), 5 (17), 6 (never occurs); and whether fill 2 means filled with the hatch pattern (it always pairs with hatch 3, 4 or 5). <!-- EXT-9.5-005 EXT-9.5-006 EXT-9.5-009 EXT-9.5-010 EXT-9.5-012 EXT-9.5-013 EXT-9.5-014 EXT-9.5-015 EXT-16.3.4-002 EXT-16.3.4-003 EXT-16.3.4-005 EXT-16.3.4-006 EXT-16.3.4-007 EXT-16.3.4-008 EXT-16.oq-001 EXT-9.oq-005 -->

### Refuted

| Claim | Source | What the files show | Evidence | ids |
| --- | --- | --- | --- | --- |
| Display body +0x0B..+0x0C is a 2-byte visibility field | INT §7.9 | +0x0B is an opaque byte taking all 256 values; the display mode is the `u16` at +0x0C..+0x0D (low byte 0-3, high byte always 0). | **S** (76,941) | <!-- INT-7.9-009 --> |
| Pin displays always have E = 0 | EXT §5.3.6 | 4 cached pin displays have E = 22 or 23 (justification records). | **S** | <!-- EXT-5.3.6-005 --> |
| Justification values 4 and above are never used | EXT §9.9, §16.4.2 | Code 24 on 15 displays of one design. | **O** | <!-- EXT-9.9-007 EXT-16.4.2-006 --> |
| Net `Line Style` value `Solid` does not occur | EXT §16.8.4 | `Solid` occurs on 2 Hierarchy nets (its mapping to LineStyle 0 stays untestable). | **O** | <!-- EXT-16.8.4-009 --> |
| Mirror 1 occurs only on placed instances, Globals and off-page connectors | EXT §16.2.3 | Also on 391 Ports and 8 DrawnInstances. | **O** | <!-- EXT-16.2.3-004 --> |
| LineStyle 4 occurs on Line primitives only | EXT §16.3.1 | Also on 2 page Polylines (besides 3 page Lines). | **O** | <!-- EXT-16.3.1-012 --> |
| Hatch values 1 and 2 are never used | EXT §9.5, §16.3.4 | Hatch 2 on 4 Polygons in the Cache (fill 0). | **O** | <!-- EXT-9.5-011 EXT-16.3.4-004 --> |

### Parser divergences


Resolved: `parseSymbolDisplayProp` reads +0x0B as an opaque byte and +0x0C as the `u16` display mode, which the page renderer uses. <!-- INT-7.9-009 --> |

<!-- meta: EXT-16.4.1-009 EXT-4.6-011 EXT-5.3.6-001 EXT-5.3.6-022 EXT-7.0.5-003 EXT-9.1.2-010 EXT-9.1.4-009 EXT-9.1.5-007 EXT-9.2.2-008 EXT-9.2.2-009 EXT-9.2.3-006 EXT-9.9-015 EXT-9.9-016 EXT-16.2.1-006 EXT-16.2.4-016 EXT-16.3.1-011 -->

Parser coverage: the parser decodes every SymbolDisplayProp (name index, x, y, font reference, rotation, colour) and attaches it to its owner, but nothing downstream reads those fields; it does not read the display mode, extensions, attribute-lock records, the transform word, wire or net style and width fields, the Library font table or default slots, or any fill and hatch. <!-- INT-13.2-012 -->

Page rendering (`render_page`) additionally reads the display mode and draws a display's value (mode 1), `name=value` (mode 2) or name (mode 3) at the owner's location plus the display offset, turned by its rotation; mode 0 is not drawn.

---

## 10. Schematics, hierarchy and occurrences

A design is a set of schematic folders under `Views/`, each an ordered list of pages, with one folder as the root. The root folder's `Hierarchy` stream is Capture's flattened occurrence tree: one occurrence per placed part, per placement of a hierarchical block and per pin, plus the design net list and the title-block and off-page occurrences. <!-- EXT-10-001 EXT-10-003 INT-8-002 -->

Evidence in this chapter: **S** means the connectivity check's decoder, built from the layout below, read the Hierarchy stream to its exact last byte. It did so on 108 of 109 Hierarchy streams in 105 readable files; the one failure (`SENSORS EXPO DEMO_12MAY2016_1200.DSN`) holds a type-76 record inside a pin list and defeats both our parser and the check. <!-- EXT-3.7-011 EXT-10.5-001 INT-8-037 --> **E** counts compare against `pstxnet.dat` / `pstxprt.dat` exports or Allegro netlists; **T** is a universal-netlist test; **O** is an observed count.

### 10.1 Folders, `Views Directory` and the Schematic stream

- Each folder `Views/<s>/` holds a `Schematic` stream whose first record is a SchematicHeader (type 9). Its R1 ends at the end of the preamble and the header body runs to the end of the stream. The stored schematic name equals the folder name on 162 of 162 folders. **S** (162 folders) <!-- EXT-3.7-008 --> The full tail layout belongs to the directories chapter.
- A folder holds at most one Hierarchy stream, at `Views/<s>/Hierarchy/Hierarchy`; no other stream name occurs under `Hierarchy/`. **S** (162 folders) <!-- EXT-1.2.3-005 EXT-1.2.3-012 -->
- The root folder always has a Hierarchy stream. **S** (105 of 105 files) <!-- EXT-10.1-009 -->
- Most other folders have none. 53 listed folders have no Hierarchy stream; 46 of them are child schematics placed by blocks, and 5 are placed by no block (for example `SENSOR_BOARD`'s test-point sheet). **S** <!-- EXT-10.1-010 EXT-10-002 -->
- A non-root folder can carry a Hierarchy stream of its own: 3 files list 2 or 3 folders with one (`EEM2TTL.DSN`: TOP and IO; `nixie.dsn`: NIXIE and SIM1; `trs80_power.dsn`: PSUPPLY, PSUPPLY-REV2 and SCHEMATIC1). Each such extra stream is the stale tree of a schematic that was once a root, or the tree of another root candidate (§10.2). **S** (102 files with one stream, 2 with two, 1 with three) <!-- INT-8-007 -->
- Every folder of every readable file is listed in `Views Directory`; no file has an unlisted folder. **S** (105 files)
- A child schematic placed by several blocks is stored once (`EEM2TTL`: BUFFER placed 8 times; `SEQUENTIALTIMER`: monostable placed twice). **S** <!-- EXT-10.8-010 -->

Reader rule: accept a file with more than one Hierarchy stream; the design's occurrence tree is the one in the root folder. With only the root stream read, `EEM2TTL` (two listed streams) matches its export on 100% of nets. **E** <!-- EXT-1.2.3-016 EXT-10.1-015 EXT-4.12-011 -->

### 10.2 Choosing the root

- The root is the schematic the `Library` stream's design suffix names. The suffix name is never empty and matches a folder (case-insensitively, after the folder-name mapping) in 105 of 105 files; that folder exists, is listed in `Views Directory` and carries `Hierarchy/Hierarchy` in all 105. **S** <!-- EXT-1.2.3-013 EXT-10.4-001 -->
- The suffix name usually equals the first `Views Directory` entry: 98 of 105 files. The 7 others list it later (for example `HB1A-AAFM`, root `TOP-LEVEL` listed fifth). **S** <!-- EXT-10.4-002 -->
- The Hierarchy stream's own `name` field equals its folder name. **S** (108 of 108) <!-- EXT-10.4-003 EXT-13.5.2-003 -->
- A folder that another folder's occurrence tree places as a block is a child schematic; its own Hierarchy stream is a stale former root and is not read (`EEM2TTL`'s IO is placed by TOP; reading TOP alone matches the export 100%). **E** <!-- INT-8-007 -->
- Several unplaced folders can be root candidates: earlier revisions and simulation sheets (`trs80_power.dsn` holds PSUPPLY, SCHEMATIC1 and PSUPPLY-REV2). Capture netlists only the suffix-named one; reading all would list each revision's parts over the others' (one refdes on two nets). When the suffix names none of the candidates, every candidate is read. **S** <!-- INT-8-008 -->
- From the earlier golden pass: on every fixture with an export, the export's `C_PATH='@design.<schematic>(sch_1):…'` starts from the suffix-named schematic, including designs with 2 to 6 folders. One design that differs was saved after its export with a simulation sheet made root. **E**
- The root scope's pages are the root folder's `Pages`. **S** (105 of 105) <!-- INT-12.6-003 -->
- A folder no root reaches is a sheet the design no longer uses and is left out, as Capture's netlist leaves it out; only a file with no usable root has every page read as is. 5 listed folders are reached by no block; no export covers them, so the rule is **S** for the structure and unconfirmed against an export. <!-- INT-12.6-006 -->
- A design with no Hierarchy stream is read flat, pages unchanged. Every decoded design has a root stream; the parser's flat path is covered by a test. **S** <!-- EXT-10.10-003 -->

### 10.3 Hierarchy stream framing and record types

The Hierarchy stream is a sequence of framed records (record framing chapter), read after a 9-byte stream header that is the root record's full prefix. **S** (108 of 108) <!-- INT-8-010 EXT-16.8.1-001 -->

| Type | Name | Role | Count | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| 66 (0x42) | Occurrence: root frame | First record: root name, lists, root data | 108 | S | <!-- EXT-10.5.1-001 EXT-16.8.1-002 --> |
| 66 | Occurrence: link frame | Instance occurrence with properties, `occurrence_id`, `instance_id` | 18,321 | S | <!-- EXT-16.8.1-003 INT-8-019 --> |
| 66 | Occurrence: derived frame | Second frame of each instance occurrence | 18,321 | S | <!-- EXT-16.8.1-004 --> |
| 67 (0x43) | HierarchyNet | One design net | 16,430 | S | <!-- EXT-10.5.1-002 EXT-16.8.1-005 --> |
| 68 (0x44) | Scalar pin occurrence; header port record | Pin occurrence, and the header port list | 83,393 pins; 630 ports | S | <!-- EXT-10.5.1-003 EXT-16.8.1-006 --> |
| 69 (0x45) | Bus member pin occurrence | One bus member, after a type-68 head | 10,258 | S | <!-- EXT-10.5.1-004 --> |
| 82 (0x52) | TitleBlockOccurrence | One per title block | 104 files | S | <!-- EXT-10.5.1-005 EXT-16.8.1-008 --> |
| 91 (0x5B) | OffPageOccurrence | One per off-page connector | 104 files | S | <!-- EXT-10.5.1-006 EXT-16.8.1-009 --> |

Type 69 does not mark the bus pin itself: it marks each member after the bus pin's type-68 head (§10.10). <!-- EXT-10.5.1-004 -->

Frame forms:

| Record | Full prefixes | Short prefix | Preamble | First prefix region ends | Evidence | ids |
| --- | --- | --- | --- | --- | --- | --- |
| Root (66) | 1 | none | none | At the end of root data; where root data is absent (78 of 104 root streams), right after the off-page list | S (108) | <!-- EXT-10.5.2-001 EXT-3.2.4-011 EXT-3.7-009 --> |
| Header port (68) | 1 | yes | yes, `m = 0` | End of preamble | S (630) | <!-- EXT-10.5.2-002 --> |
| Design net (67) | 1 | yes: `n = 0` on 15,078, `n = 1` on 1,348, `n = 3` on 4 | yes, `m = 0` | End of preamble | S | <!-- EXT-10.5.2-003 --> |
| Title-block occurrence (82) | 1 | yes, `n` in {0, 4, 11, 16} | yes, `m = 0` | End of preamble | S | <!-- EXT-10.5.2-004 --> |
| Off-page occurrence (91) | 1 | yes, `n = 0` on all 6,147 | yes, `m = 0` | End of preamble | S | <!-- EXT-10.5.2-005 --> |
| Occurrence link (66) | 1 | yes, `n` 0 to 18 | yes, `m` in {0, 37, 39} | End of preamble | S (18,321) | <!-- EXT-10.5.2-006 --> |
| Occurrence derived (66) | 1 | none | none | End of `trailing_data`, just before the `u16 child_count` | S (18,321) | <!-- EXT-10.5.2-007 EXT-3.2.4-012 --> |
| Pin occurrence (68, 69) | 1 | yes, `n` in {0, 1} | yes, `m = 0` | End of preamble | S (83,393 + 10,258) | <!-- EXT-10.5.2-008 --> |

For every record except the root and the derived frame, the first full prefix bounds only the framing; the record's own fields start after that boundary, which is not the end of the record. **S** (every 66 link, 67, 68, 69, 82 and 91) <!-- EXT-10.5.2-009 -->

### 10.4 Stream header and root scope

| Offset | Type | Name | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | 9 bytes | root prefix | Full prefix, type 66, zero word | S (108) | <!-- EXT-10.5.3-001 EXT-3.3-003 --> |
| +0x09 | lstr | `name` | Root schematic name, equal to the folder name | S (108) | <!-- EXT-10.5.3-002 INT-8-011 --> |
| | 7 bytes | reserved | Always zero | S (108) | <!-- EXT-10.5.3-003 INT-8-012 --> |
| | u16 | `port_count` | Header port records that follow; non-zero on 32 of 108 streams | S | <!-- INT-8-013 --> |
| | port[] | `ports` | §10.5 | S (630) | <!-- EXT-10.5.3-005 --> |
| | u16 | `net_count` | | S (108) | <!-- EXT-10.5.3-006 INT-8-015 --> |
| | net[] | `nets` | Type-67 records, §10.6 | S (108) | <!-- EXT-10.5.3-007 --> |
| | u16 | `title_count` | | S (108) | <!-- EXT-10.5.3-008 INT-8-016 --> |
| | link82[] | `title_blocks` | §10.7 | S (108) | <!-- EXT-10.5.3-009 --> |
| | u32 | `offpage_count` | 32 bits wide, unlike the other counts; the u16 alternative never fits | S (108) | <!-- EXT-10.5.3-010 INT-8-017 --> |
| | link91[] | `offpage_connectors` | §10.7 | S (108) | <!-- EXT-10.5.3-011 --> |
| | bytes | `root_data` | Absent, or one preamble, up to the root boundary (§10.8) | S | <!-- EXT-10.5.3-012 --> |
| | u16 | `root_occurrence_count` | Root-level occurrences; the u32 alternative never fits | S (108) | <!-- EXT-10.5.3-013 INT-8-018 --> |
| | occurrence[] | `instances` | Occurrence tree to the end of the stream (§10.9) | S (108) | <!-- EXT-10.5.3-014 INT-8-014 --> |

- The counts `net_count`, `title_count`, `offpage_count` form a **scope**. The same three-list scope appears again inside each block occurrence (§10.9). **S** <!-- INT-8-029 -->
- The layout is fixed: on all 108 streams the off-page count is u32 and the root occurrence count u16. The only variation is whether the root-data preamble is present (26) or absent (78). **S** <!-- INT-8-001 -->
- Our parser tries eight layouts and keeps the one that reads the stream to its last byte, throwing when none does; exactly one layout fits each of the 108 streams. **S** <!-- INT-8-036 -->
- A stream that fails leaves its view flat: pages parse with their inline references and no placement is expanded. **T** <!-- INT-8-038 -->
- Guard: an `offpage_count` larger than the stream length divided by 8 is invalid. Applied on 108 streams without a false trigger. **S** <!-- EXT-10.5.3-015 -->

### 10.5 Header port list

| Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| frame | 68 | Full prefix, short prefix, preamble | S (630) | <!-- EXT-10.5.4-001 --> |
| `id` | u32 | `0xFFFFxxxx`, counting down by one per port (`EEM2TTL`: 4294967191, 4294967190, …); not an occurrence id | S (630) | <!-- EXT-3.9-003 --> |
| `name` | lstr | Port name | S (630) | <!-- EXT-10.5.4-004 --> |

- The port list sits before the net list and does not shift the occurrence tree. **S** <!-- EXT-10.5.4-005 -->
- The list holds the names of the hierarchical ports on the root folder's own pages on 29 of 32 streams with ports; each port name also appears in the net list on 626 of 630 records. **S** <!-- EXT-10.5.4-006 -->

### 10.6 Design nets (type 67)

| Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| frame | 67 | Short-prefix pairs are net properties (§10.12) | S (16,430) | <!-- EXT-10.5.5-001 --> |
| `id` | u32 | Net id in the occurrence id space: unique among all occurrence ids of the stream, never equal to a page SchematicNet id, referenced by nothing else | S (104 streams) | <!-- EXT-10.5.5-002 INT-8-040 --> |
| `name` | lstr | Flattened design-level net name | E | <!-- EXT-10.5.5-003 --> |

- The field order is id then name; a page net-name row is name then id. **S** <!-- EXT-10.5.5-009 -->
- Ids are unique; names are non-empty and unique case-insensitively. **S** (104 of 104) <!-- EXT-10.5.5-005 --> Ids never equal a page SchematicNet id. **S** (104 of 104) <!-- EXT-10.5.5-006 -->
- The list is in ascending id order on 94 of 104 streams; it is alphabetical only on 3 tiny lists. **O** <!-- EXT-10.5.5-007 -->
- Names include generated `N<digits>` names (89 files) and suffixed `<BASE>_<digits>` copies (19 files); chapter 11 gives both rules. **O** <!-- EXT-10.5.5-008 -->
- On flat designs the root scope's names are the design's flat net list: every export net name is in it except the pseudo-net `NC`, 5,437 names. Pin-to-pin nets are named in it by `N<digits>` (23 nodes). On hierarchical designs each placement's local nets live in that placement's nested scope, not in the root list. **E** <!-- INT-8-003 EXT-18.10.2-010 -->
- Names are compared upper-cased, as page net names are. **E** <!-- INT-8-039 -->

### 10.7 Title-block and off-page occurrences (types 82 and 91)

Both use the occurrence link layout. **S** (104 streams) <!-- EXT-10.5.6-001 -->

| Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| frame | 82 or 91 | Full prefix, short prefix of occurrence properties, preamble | S | <!-- EXT-10.5.6-002 --> |
| `occurrence_id` | u32 | In the occurrence id space | S (104) | <!-- EXT-10.5.6-003 --> |
| `instance_id` | u32 | `db_id` of the title block or off-page connector on a page | S (104) | <!-- EXT-10.5.6-004 --> |

- The 8 bytes INT called unknown after each 0x52 and 0x5B structure are these two ids. **S** (104 of 104) <!-- INT-13.3-017 -->
- There is exactly one type-82 record per title block on the root folder's pages, and exactly one type-91 record per off-page connector; the `instance_id` multisets equal the page `db_id`s. **S** (104 of 104 files) <!-- EXT-10.5.6-005 EXT-10.5.6-007 -->
- Both lists are normally in ascending `occurrence_id` order, not page order: type 82 on 102 of 104, type 91 on 104 of 104. **O** <!-- EXT-10.5.6-009 -->
- Type-82 properties seen: `Page Number`, `Page Count`, `Schematic Page Number`, `Schematic Page Count`, `Title`, `Name`, `Color`, `Doc`, `OrgName`, `OrgAddr1` to `OrgAddr4`, `RevCode`, `Cage Code`, `Page Contents:`. **O** <!-- EXT-10.5.6-006 EXT-10.6-004 -->
- No type-91 record carries a property: all 6,147 have `n = 0`. **S**

### 10.8 Root data

Root data is the bytes between the end of the off-page list and the root boundary. Three forms occur. **S** (104 root streams) <!-- EXT-10.5.7-001 EXT-16.8.2-001 -->

| Form | Content | Count | ids |
| --- | --- | --- | --- |
| Absent | 0 bytes; the off-page list ends at the root boundary | 78 | |
| 1 | Empty preamble, 8 bytes `FF E4 5C 39 00 00 00 00` | 25 | <!-- EXT-10.5.7-002 EXT-16.8.2-002 --> |
| 2 | Reference-range envelope: one preamble holding one kind-5 / version-6 sub-record | 1 | <!-- EXT-10.5.7-003 EXT-16.8.2-003 --> |

Where present, the root data is one preamble whose u32 at +0x04 equals the remaining length. <!-- EXT-10.5.7-001 -->

Form 2 layout, all **S** on its one example:

| Offset | Type | Name | Meaning | ids |
| --- | --- | --- | --- | --- |
| +0x00 | 4 bytes | magic | `FF E4 5C 39` | <!-- EXT-10.5.7-004 --> |
| +0x04 | u32 | `length` | Total length minus 8 | <!-- EXT-10.5.7-005 --> |
| +0x08 | u32 | `length2` | Sub-record length, same value as `length` | <!-- EXT-10.5.7-006 --> |
| +0x0C | u32 | `kind` | 5 | <!-- EXT-10.5.7-007 --> |
| +0x10 | u32 | `version` | 6 | <!-- EXT-10.5.7-008 --> |
| +0x14 | 67 bytes | literal | ASCII `1 3 15 REFERENCE_RANGE 1 19 REFERENCE_RANGE_BAG 1 13 CDS_REF_RANGE ` (trailing space); each name follows its decimal length (15, 19, 13) | <!-- EXT-10.5.7-009 EXT-10.5.7-014 --> |
| +0x57 | ASCII | `payload_count` | Decimal byte count N of the payload, no leading zeros | <!-- EXT-10.5.7-010 --> |
| | 1 byte | | Space (0x20) | <!-- EXT-10.5.7-011 --> |
| | N bytes | `payload` | One JSON object; the opaque suffix after it is empty in the only example | <!-- EXT-10.5.7-012 --> |
| | 4 bytes | `final_marker` | `20 00 00 00`, ending exactly at the root boundary | <!-- EXT-10.5.7-013 --> |

The kind-5 sub-record never occurs on an occurrence link: all 972 non-empty link extensions are kind 2. **S** <!-- EXT-3.4-013 -->

JSON payload, **O** on one example (keys `IsDataMigrated` and `page`): <!-- EXT-10.5.7-016 EXT-16.8.2-004 -->

| Key | Content | ids |
| --- | --- | --- |
| `page` | Array of one-key objects, each keyed by a page name | <!-- EXT-10.5.7-017 EXT-16.8.2-005 --> |
| `<page>` → `global` | Object of ranges for that page, keyed by reference prefix (page level seen; top level not seen) | <!-- EXT-10.5.7-018 EXT-16.8.2-006 --> |
| `<prefix>` | Array of ranges; only `*` observed (7 ranges) | <!-- EXT-10.5.7-019 EXT-16.8.2-007 --> |
| `start`, `end` | Canonical decimal strings, `start <= end` (7 of 7) | <!-- EXT-10.5.7-020 EXT-16.8.2-008 --> |
| `IsDataMigrated` | Integer 1 | <!-- EXT-10.5.7-021 EXT-16.8.2-009 --> |

Our parser accepts the root-data preamble as optional.

### 10.9 Occurrence tree and instance occurrences

After `root_occurrence_count` the stream holds the occurrence tree in depth-first pre-order. Each occurrence ends with its own `child_count` k; when k > 0 the next k subtrees are its children, before the parent's next sibling. The root-level record count equals `root_occurrence_count`. **S** (108 of 108) <!-- EXT-10.5.8-001 EXT-10.5.8-002 -->

A part occurrence and a block occurrence are one record type; which it is follows from `contents` being empty or not. A block's scope holds that placement's nets, and its children are the parts and blocks placed inside it, to any depth. **S** (336 blocks, nested to depth 2) <!-- INT-8-030 -->

| Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| `link` | frame 66 | Full prefix, short prefix of occurrence properties, preamble | S (18,321) | <!-- EXT-10.5.8-003 INT-8-020 --> |
| `occurrence_id` | u32 | Unique | S (18,321) | <!-- EXT-10.5.8-004 INT-8-021 --> |
| `instance_id` | u32 | `db_id` of the PlacedInstance or DrawnInstance on a page | S | <!-- EXT-10.5.8-005 INT-8-022 --> |
| `derived` | 9 bytes | Full prefix: type 66, `u32` length to the child count, zero word; no short prefix, no preamble | S (18,321) | <!-- EXT-10.5.8-006 EXT-3.3-004 --> |
| `contents` | lstr | Child schematic for a block; empty for a part | S (17,985 empty, 336 named) | <!-- EXT-10.5.8-007 INT-8-025 --> |
| `reference_length` | u16 | | S | <!-- EXT-10.5.8-008 --> |
| `reference` | bytes | Occurrence reference designator, 8-bit text; with its length and terminator an lstr | E | <!-- EXT-10.5.8-009 --> |
| `terminator` | u8 | Always 0 | S (18,321) | <!-- EXT-10.5.8-010 --> |
| `designator_index` | u32 | 0 = none; otherwise a Library string index (§10.13) | S (24 non-zero) | <!-- EXT-10.5.8-011 INT-8-027 EXT-16.13.2-011 --> |
| `pin_count` | u16 | Pin occurrences that follow | S | <!-- EXT-10.5.8-012 --> |
| `pins` | pin[] | §10.10 | S (93,651 records) | <!-- EXT-10.5.8-013 --> |
| `trailing_data` | scope | Part: 8 zero bytes (the three scope counts at zero). Block: the placement's nested scope, `u16` nets (67), `u16` type-82 links, `u32` type-91 links, ending exactly at the derived boundary; lengths 127 to 27,445 bytes | S (17,985 parts, 336 blocks) | <!-- EXT-10.5.8-014 INT-8-029 --> |
| `child_count` | u16 | At the derived boundary | S (18,321) | <!-- EXT-10.5.8-016 --> |

- The type byte 0x42 and the two u32 INT reads after `instance_id` are the derived frame's full prefix (type, length, zero word). **S** (18,321) <!-- INT-8-023 INT-8-024 -->
- The 8 bytes INT called unknown after `db_id` are that prefix, and the 4 after the two strings are `designator_index`. **S** <!-- INT-13.3-016 -->
- Block occurrences carry references too (`EEM2TTL`: BUFFER2, SW6). `reference` is empty only when the occurrence was never annotated. **S** <!-- INT-8-026 -->
- The occurrence id and the instance id sit next to each other in the link, which is how a CIS entry ties to a placed instance. **S** (18,321) <!-- EXT-14.14.1-002 -->
- A part occurrence has empty `contents` and `child_count = 0` (17,933 of 17,933). **S** <!-- EXT-10.5.8-017 --> A block occurrence has non-empty `contents` and `child_count > 0` (336 of 336). **S** <!-- EXT-10.5.8-018 -->
- Root-level occurrences follow neither page order nor id order: ascending by id on only 12 of 104 streams. **O** <!-- EXT-10.5.8-020 -->
- A non-empty link preamble extension holds one kind-2 sub-record: 972 extensions, `m = 37` on 3 and `m = 39` on 969; `m = 0` on 17,349. **S** <!-- EXT-16.8.3-001 EXT-16.8.3-002 EXT-16.8.3-003 EXT-10.5.8-019 --> Its meaning is under §Unresolved conflicts.
- The body after the link preamble is read relative to the preamble's length field, not at a fixed offset from its magic (record framing rule). **S** (972 non-empty extensions) <!-- INT-8-031 -->

### 10.10 Pin occurrences

| Field | Type | Meaning | Evidence | ids |
| --- | --- | --- | --- | --- |
| frame | 68 or 69 | Full prefix, short prefix of pin properties, preamble | S | <!-- EXT-10.5.8-021 --> |
| `occurrence_id` | u32 | Unique | S (93,651) | <!-- EXT-10.5.8-022 --> |
| `pin_index` | u16 | Zero-based pin position | S | <!-- EXT-10.5.8-023 INT-8-028 --> |

- A pin occurrence records pin identity only: occurrence id, index and properties, never a net. **S** <!-- EXT-11.1.7-003 -->
- **Bus pins** (new layout order): one type-68 record, then one type-69 record per bus member, all with the bus pin's `pin_index`. The member count equals the range width of the block pin name on 1,212 of 1,212 bus pins. **S** <!-- EXT-11.6-005 -->
- **Part occurrences.** `pin_count` equals the placed part's pin count on 17,653 of 17,685; the 32 others are in `reServer industrial J401` (for example 13 against 14). **S** <!-- EXT-10.5.8-024 EXT-18.10.2-006 -->
- `pin_index` is the page pin's ordinal minus 1: page pins are stored in ordinal order on 17,685 of 17,685 parts, and the indices form a permutation of 0..n-1 on 17,671 of 17,685 (14 fail in `CLAYR6`, for example 0, 1, 2, 3, 8). **S** <!-- EXT-10.5.8-025 INT-8-033 EXT-18.10.2-011 -->
- Pin occurrences are in ascending `pin_index` order on 17,589 of 17,685 parts; the other orders have no known meaning. **O** <!-- EXT-10.5.8-027 -->
- **Block occurrences.** With bus members folded (a 68 head plus its 69 members count as one), the logical pin count equals the block's port count and the indices are a permutation of 0..n-1 on 336 of 336. The raw `pin_count` differs on 63 blocks, all with bus ports. **S** <!-- EXT-10.5.8-028 EXT-10.8-004 -->
- A pin whose number the occurrence assigns carries a `Number` property with that number (27 records); it overrides the device pin map for that occurrence only (§10.15). **S** <!-- INT-8-032 -->

### 10.11 Occurrence ids and the watermark

- Occurrence ids of design nets, title-block, off-page, instance and pin occurrences form one id space and are unique within the stream. **S** (104 of 104) <!-- EXT-10.5.9-001 EXT-3.9-003 --> The header port ids (`0xFFFFxxxx`) are not part of it.
- That space is separate from page `db_id`s: values collide with some page `db_id` in 43 of 104 files, with no meaning. Occurrence ids are neither an instance's `db_id` nor the `INSnnn` of a PST path (export `INS` names are string-table names). **S** <!-- EXT-10.3-019 EXT-10.5.9-002 INT-8-041 -->
- Two allocator watermarks are stored: the Schematic header `max_id` (162 folders) and the Library occurrence-id watermark (105 files). **S** <!-- EXT-3.9-005 -->
- The occurrence watermark is the u32 at Library design suffix +0x04, after a reserved word that is 0 on 105 of 105. Observed range 1 to 188,680. **S** <!-- EXT-4.12-003 -->
- It is one u32; its upper 16 bits are non-zero on 15 of 104. **O** <!-- EXT-4.12-005 -->
- It is at least the largest root occurrence id on 100 of 104 files (equal on 67, greater on 33) and below it on 4 (for example BeagleBoard-xM: watermark 128,608, largest id 128,907). **O** <!-- EXT-4.12-007 EXT-10.5.9-003 EXT-18.10.2-012 -->
- The root schematic's `max_id` exceeds every occurrence id of its Hierarchy stream on 103 of 104 (`nixie`: `max_id` 1,238 against id 1,961). Every listed schematic's `max_id` exceeds the watermark on 147 of 162 (15 fail, for example `SENSOR_BOARD` LDR-D-Unit 5,308 against 6,404). **S** <!-- EXT-10.3-020 -->
- Writer rule: the watermark can lag the ids present (4 of 104 files), so allocate a new occurrence id above both the watermark and every id in use, then store the last id allocated. **O** <!-- EXT-4.12-008 EXT-10.5.9-004 -->

### 10.12 Occurrence properties

- Every framed Hierarchy record can carry properties in its short prefix as `(u32 name_index, u32 value_index)` pairs into the Library string table; all 10,743 pairs on 66, 67, 68, 82 and 91 records resolve. **S** <!-- EXT-10.6-001 -->
- Occurrence properties are values of that occurrence layered over the page object's own: the pin `Number` property overrides the pin number, and with it our parser matches export pin numbers 100% on the fixtures. **E** <!-- EXT-10.6-002 -->
- Design net (67) properties seen: `DIFFERENTIAL_PAIR` (1,338), `VOLTAGE` (10), `Color`, `Line Width`, `Line Style` (4 each). **O** <!-- EXT-10.6-003 -->
- Instance link (66) properties seen include `Value` (35) and `PCB Footprint`, with many user properties (`BuildOptions`, `Assembly`, `Part Number`, `Manufacturer`, `DNP`, …). **O** <!-- EXT-10.6-006 -->
- Pin occurrence (68) properties seen: only `Number` (27). **S** <!-- EXT-10.6-007 -->
- **Net format properties.** A design net carrying one of `Color`, `Line Width`, `Line Style` carries all three as short-prefix pairs (4 of 4 nets). **O** <!-- EXT-9.7.2-001 EXT-16.8.4-001 EXT-16.8.4-002 -->
  - `Color` is `RGB(r, g, b)` (decimal channels, spaces allowed) or `Default`; the file stores no palette mapping RGB text to a colour index. All 4 values seen are `Default`. **O** <!-- EXT-9.7.2-002 -->
  - `Line Width` values seen: `Thin`, `Default`. **O** <!-- EXT-9.7.2-003 -->
  - `Line Style` values seen: `Solid`, `Default`. **O** <!-- EXT-9.7.2-004 -->

### 10.13 Reference designators per occurrence

A part has an instance reference in its page record and an optional occurrence reference in its Hierarchy occurrence. **S** <!-- EXT-10.7-001 -->

Displayed reference, in order:

1. If `designator_index` is non-zero, the Library string at that index. All 24 non-zero indices are in range and name a non-empty string, and that string differs from both `reference` and the instance reference (24 of 24). **S** for the structure; no export covers these 24. <!-- EXT-10.7-002 EXT-10.7-005 -->
2. Else, a non-empty `reference`. This reproduces the export refdes on 7,199 of 7,203 parts; the 4 others differ only in case (`ONYXPSU`). **E** <!-- EXT-10.7-003 EXT-0.4-006 -->
3. Else, the page instance reference: 6,998 of 7,002 empty occurrence references (4 case-only). **E** <!-- EXT-10.7-004 -->

- Annotation by instance: the drawing carries the reference (R5, BLK1) and the occurrence carries the same or nothing. Annotation by occurrence: the drawing keeps a placeholder (R?, BLK?) and only the occurrence carries the reference, for parts and blocks alike. Our parser reads the occurrence reference first and the drawing's where the occurrence has none. **E** (7,199 of 7,203) <!-- INT-8-009 -->
- A non-empty `reference` equals the instance reference on 135 occurrences, replaces a `?` reference on 4,190, and differs otherwise on 1,129. **O** <!-- EXT-10.7-006 -->
- In a design without block occurrences, a part's occurrence reference applies to its page instance by `instance_id`, and all sections of a multi-section part carry the same value; component lists match the exports 100% on the fixtures. **E** <!-- EXT-10.7-007 EXT-10.10-004 -->
- Each scope's part occurrences carry the references that placement annotates, and each placement's pin numbers where they differ from the drawing. **S** <!-- INT-8-004 -->

### 10.14 Hierarchical blocks and ports

- A hierarchical block is a DrawnInstance (type 12), drawn on the parent page with inline artwork and kept in list 6 with the placed instances. **S** (336 blocks) <!-- EXT-7.5-001 EXT-10.8-001 -->
- After its kind byte it holds one inline type-24 LibraryPart with 5 full prefixes, ending inside the record (R2 ends there). Its primitives are the block artwork; its symbol pins are the block's ports, with hotpoints relative to the block location. Pin slots match the block's pin instances by position. **S** <!-- EXT-7.5-014 -->
- The u32 at +0x08 of the block record is the string index of its contents view, the child schematic; non-zero and naming the occurrence's child schematic on 336 of 336 (case-insensitive). **S** <!-- EXT-7.5-018 -->
- A block's occurrence is an instance occurrence with `instance_id` equal to the block's `db_id`; its `contents` equals, case-insensitively, a folder name and the block's contents name. **S** (336 of 336) <!-- EXT-10.8-002 EXT-10.8-003 -->
- A child schematic is drawn once and placed by DrawnInstances on parent pages, possibly several times or inside another block; page streams hold the drawing once and the Hierarchy stream holds one occurrence per placement. Block occurrences sit at depth 0 (110), depth 1 (50) and depth 2 (176). **S** <!-- INT-12.6-002 -->
- `instance_id` resolution: a root-level part resolves to a placed part on the root folder's pages (13,274 of 13,274); a block resolves to a hierarchical block on the parent folder's pages (336 of 336); a block's child part resolves to a placed part on the child folder's pages on 4,411 of 4,659. The 248 failures are in `CLAYR6`, whose blocks name the root's own schematic, a schematic of another design file. **S** <!-- EXT-10.5.9-005 -->
- Every placed part and every block on the root folder's pages has exactly one root-level occurrence (multiset equality). **S** (104 of 104) <!-- EXT-10.5.9-006 -->
- A block occurrence's direct children equal, as a multiset of `instance_id`, the placed parts (and blocks) of the child folder's pages on 317 of 336 blocks; the 19 others are the `CLAYR6` blocks above. **S** <!-- EXT-10.8-005 EXT-10.10-005 -->
- Child schematic pages carry hierarchical ports (type 23) whose names equal the block's port names as a set on 303 pages, form a subset on 35, and are absent on 22. **S** <!-- EXT-10.8-006 -->
- **Block pin positions.** For an unrotated, unmirrored block, a port's connection point is the block location plus the stored port hotpoint: 4,548 of 4,548 pins. For rotated or mirrored blocks the plain sum fails on 134 of 136 pins (for example `buddy_sch_rev1.dsn`, transform 0x730); location plus the transformed hotpoint matches 34 of them. **S** <!-- EXT-2.5.2-011 EXT-10.8-007 EXT-11.1.5-001 -->
- Block pins carry wire ids as part pins do: 3,096 wired (900 of them on bus wires) and 204 unwired. An unwired block pin binds nothing, and the port's net stays local. **S** <!-- INT-12.6-024 -->
- A block pin's `net_id` (+0x0A, §7.4) is always 0, wired or not: 4,462 wired and 222 unwired block pins across the expanded pages of the 106 readable corpus and fixture designs (`private/m2/block-pins.ts`). An unwired block pin therefore names no SchematicNet, and the parser binds a port from the block pin's `wire_id` alone. **S**
- **Port type** (the u32 in the port trailer): values 0 (555), 1 (624), 2 (579), 4 (196) and 7 (62); 3, 5 and 6 never occur on 2,016 ports. **O** <!-- EXT-7.9.1-006 --> It equals the same-named block pin's type on 4,368 of 4,412, and the pin type of the port's cached PortSymbol on only 1,240 of 2,016. **S**

### 10.15 Expanding blocks: page copies and placement-local nets

A child schematic is stored once; each block occurrence instantiates all of its pages. Our parser copies the child's pages once per block occurrence; `EEM2TTL` and `SEQUENTIALTIMER` (repeated blocks) match their exports 100%. **E** <!-- EXT-10.10-001 -->

Expansion (INT §12.6, verified one level and three levels deep against Allegro netlist exports, and for bus members and nested ports against the designs' own root net lists): **T** <!-- INT-12.6-001 -->

- For each DrawnInstance on a page, the block occurrence of the current scope whose `instance_id` equals the block's `db_id` names the child schematic and opens its scope; the child's pages are copied once per placement and the copy's DrawnInstances are expanded in turn. **E** (`EEM2TTL`, `SEQUENTIALTIMER` 100%) <!-- INT-12.6-004 -->
- Two blocks are passed over: one with no occurrence in the stream, and one whose schematic is already open above it on the same path (a reference to another design file's schematic of the same name; `CLAYR6`'s 19 blocks name its root `SCHEMATIC1`). **S** <!-- INT-12.6-005 -->

A placement's page copies differ from the drawing in four ways: <!-- INT-12.6-007 -->

1. Reference designators are those the placement's scope annotates; an instance whose occurrence annotates none keeps its inline reference. **E** (flat: 7,199 of 7,203; hierarchical: `EEM2TTL`, `SEQUENTIALTIMER` components 100%) <!-- INT-12.6-008 -->
2. Pin numbers are those the placement's occurrence assigns through its pins' `Number` properties where it assigns any; otherwise the page's pin map answers. **T** <!-- INT-12.6-009 --> A multi-section part shared by several placements is drawn once in one section, so its page record holds only that section's pin numbers; annotation gives each placement its own section, and the pin record holds that assignment. A hex inverter drawn once in a block placed twice is one component, reporting pins 1 to 4 from one placement and 5 to 9 from the other, as Capture's netlist does. **T** <!-- INT-8-034 INT-12.5-002 -->
3. Pin net ids move into a range of their own, a multiple of 2^32 above the file's 32-bit ids, so a pin drawn once never shares a net-id group across placements; the two sentinel values are left alone. **T** <!-- INT-12.6-010 -->
4. Hierarchical ports bind to the parent page: the child's port symbol, named through `strLst[pairingId]`, is matched by name to the DrawnInstance's symbol pin, and that pin's position and net id on the parent page are recorded on the copy. **T** <!-- INT-12.6-011 -->

Net classification in a placement:

- A wire group attached to a bound hierarchical port takes the parent's net (its pins join the parent's net-id group under the parent page and block pin coordinate); nothing is reported under the port's own name. **T** <!-- INT-12.6-012 -->
- A group named as a member of a bound bus port is on that port's member: port `DATA[7:0]` has groups `DATA7` to `DATA0`. Capture joins bus members by name, so bus entries are not needed. **T** <!-- INT-12.6-013 -->
- A group attached to a Global keeps its bare name, so a power net is one net across the design (`SEQUENTIALTIMER`: `GND`, `VCC` unsuffixed in the export). **E** <!-- INT-12.6-014 -->
- Every other group is local to the placement and is suffixed with `_` plus the placement path, so two placements of one drawing report two nets (`SEQUENTIALTIMER`: `N00439_MV1`, `N00439_MV2`; `EEM2TTL`: `DIR_BUFFER1` to `DIR_BUFFER8`). This holds for every placement, repeated or not. **E** <!-- INT-12.6-015 -->
- In EXT's terms: on the parent page the net at a block port's connection point is the port's outside net; on the child page the net at a hierarchical port's connection point is its inside net, ports matching block ports by trimmed, case-insensitive name. The inside net takes the outside net's name on that occurrence's child pages, and a child net that only shares a name with a parent net is not joined to it. **T** <!-- EXT-11.5.5-001 EXT-11.5.5-002 EXT-11.5.5-003 --> When the outside net is unknown (an unwired block pin), the inside net stays local with the placement suffix; EXT writes `<inside>_<occurrence path>` only for copies of repeated blocks, while INT and the exports suffix every placement, and the two agree where the path is the occurrence reference. **E** <!-- EXT-11.5.5-004 -->
- A pin on a port symbol with no wire, marked with the sentinel net id, is on that port's group; a pin on a Global is on the Global's net. **T** <!-- INT-12.6-016 -->

Placement path:

- The suffix is `_` plus the path elements from the root down, joined with `_`, upper-cased: `_BLK1` one level down, `_BLK1_SUB2_UNIT3` three levels down. One level is **E** (`_MV1`, `_BUFFER7` in the exports); three levels is **T** against an Allegro export. <!-- INT-12.6-017 INT-12.6-018 -->
- Each path element is the reference the block occurrence annotates, or the name drawn on the block where the occurrence annotates none: `EEM2TTL`'s export names `DIR_BUFFER7`, `DIR_BUFFER8` after the references BUFFER7, BUFFER8, not the block names BUFFER14, BUFFER15. **E** <!-- INT-12.6-019 INT-8-005 -->

Chains and buses across ports:

- A placement's parent may itself be a placement, and the group at the block pin may be on one of the parent's ports; a pin on a port follows the chain of ports upward to the first page-local group and joins it. A design nested three deep reports one top-level net carrying the pins of parts three placements down. **T** <!-- INT-12.6-020 -->
- A bus port's member binds by position, not by name: member *i* of the port's range binds to member *i* of the parent bus's range, read from that bus wire's alias or net-name row at the pin. Member counts equal range widths on 1,212 of 1,212 bus pins. **T** <!-- INT-12.6-021 -->
- When no wire on the parent page carries a member (a bus running straight from one block pin to another), the parent bus passes it on: the member gets a net id of its own under the parent, named as the parent's member, and the chain continues upward. **T** <!-- INT-12.6-022 -->
- A block pin that is not wired, or is wired to something other than a bus, leaves the port's members local to the placement. **T** <!-- INT-12.6-023 -->

Repeated-block naming in EXT's terms agrees: a copy of a child schematic instantiated more than once follows these page-copy rules (`EEM2TTL`, `SEQUENTIALTIMER` 100%). **E** <!-- EXT-11.5.6-001 --> Every page net name that is not a port or Global name on the page gets `_<occurrence path>`; Global and port names keep design scope. **E** <!-- EXT-11.5.6-003 --> Generated `N<digits>` names take the same suffix (`N00439_MV1`, `N00454_MV1`). **E** <!-- EXT-11.5.6-004 -->

### Refuted

| Claim | Source | What the files show | Evidence | ids |
| --- | --- | --- | --- | --- |
| With several folders listed, only the root's folder has a Hierarchy stream | EXT §1.2.3 | 3 of 16 such files have 2 or 3 listed streams (`EEM2TTL`, `nixie`, `trs80_power`) | S | <!-- EXT-1.2.3-014 --> |
| A second Hierarchy stream lives in an unlisted folder that is never root | EXT §10.1 | Second streams exist only in listed folders; no unlisted folder in 105 files | S | <!-- EXT-10.1-011 --> |
| Of two Hierarchy streams, the other belongs to a folder neither suffix-named nor listed | EXT §10.4 | Both folders listed in the two-stream files; `trs80_power` has three listed | S | <!-- EXT-10.4-004 --> |
| Every schematic folder has a Hierarchy stream | EXT §13.1 | 53 listed folders have none | S | <!-- EXT-13.1-006 --> |
| Header `port_count` is always 0 | EXT §10.5.3 | Non-zero on 32 of 108 streams (630 records) | S | <!-- EXT-10.5.3-004 --> |
| Header port `id` is `0xFFFFFFFF` | EXT §10.5.4, §16.13.2 | 0 of 630; all `0xFFFFxxxx`, counting down per port | S | <!-- EXT-10.5.4-002 EXT-16.13.2-010 --> |
| Block occurrence `trailing_data` is opaque | EXT §10.5.8 | It is the placement's nested scope, decoded exactly on 336 of 336 (§10.9) | S | <!-- EXT-10.5.8-015 --> |
| A bus pin is one type-69 record followed by type-68 members | EXT §10.5.8 | Reversed: one type-68 head, then one type-69 per member (1,212 bus pins) | S | <!-- EXT-10.5.8-029 --> |
| Type 69 never occurs in real files | EXT §16.8.1 | 10,258 records (for example `parallella-meta-carrier` LINK4) | S | <!-- EXT-16.8.1-007 --> |
| Blocks occur only at the root level | EXT §10.8 | 226 block occurrences below root level (depth 1: 50, depth 2: 176) | S | <!-- EXT-10.8-008 --> |
| The occurrence path is the block name, else `<contents>#<occurrence_id>` | EXT §10.10 | Exports use the occurrence reference (`DIR_BUFFER7` from BUFFER7, block named BUFFER14) | E | <!-- EXT-10.10-006 --> |
| Port type always equals its cached PortSymbol's pin type and the block pin's type | EXT §7.9.1 | PortSymbol match on 1,240 of 2,016 (608 failures with a single candidate); block pin match on 4,368 of 4,412 | S | <!-- EXT-7.9.1-001 --> |
| Port types 3 to 7 do not occur | EXT §7.18 | Types 4 (196) and 7 (62) occur | O | <!-- EXT-7.18-012 --> |
| The top-level scope varies with file version (0x5B count 2 or 4 bytes, optional 8-byte block, occurrence count 2 or 4 bytes) | INT §8 | All 108 streams use a u32 off-page count and a u16 occurrence count; only the root-data preamble varies | S | <!-- INT-8-035 --> |

### Unverified

- *unverified*: A folder not listed in `Views Directory` may carry its own Hierarchy stream and is never the root; its pages are not part of the design's connectivity. No readable file has an unlisted folder. <!-- EXT-1.2.3-015 EXT-10.2-012 -->
- *unverified*: The watermark is the last occurrence id allocated, the next id being watermark + 1. Allocator semantics need Capture; the data show equality on 67 of 104. <!-- EXT-4.12-006 -->
- *unverified*: Reader rule: when the suffix name matches no Schematic header, use the single Hierarchy stream if there is exactly one. The suffix always matched a folder (105 of 105). <!-- EXT-10.4-005 -->
- *unverified*: Port type meanings 0 = Input, 1 = Bidirectional, 2 = Output, 3 = Open collector (3 never occurs). Value meanings need Capture. <!-- EXT-7.9.1-002 EXT-7.9.1-003 EXT-7.9.1-004 EXT-7.9.1-005 -->
- *unverified*: The design-net format property and the page net header are separate stored values that can disagree; the page header usually keeps its defaults (colour 48, style 5, width 3) while the design net carries the setting. Not compared (4 nets). <!-- EXT-9.7.2-005 EXT-9.7.2-006 -->
- *unverified*: Net format overrides apply to the page SchematicNets of that design net whose own value is the default (colour 48, width 3, style 5), with `Line Width` Thin = 0, Medium = 1, Wide = 2, Default = 3 and `Line Style` Solid = 0, Dash = 1, Dot = 2, Dash Dot = 3, Dash Dot Dot = 4, Default = 5; property names match trimmed and case-insensitively. Reader: find the page nets of a design net through the page net-name table, comparing trimmed upper-cased names, and apply the property only to header fields at their default. Display semantics; not exercised. <!-- EXT-9.7.2-007 EXT-9.7.2-008 EXT-10.6-008 EXT-10.6-009 -->
- *unverified*: Type-91 and pin-occurrence (68) properties include `IREF`. No type-91 record carries any property, and pin occurrences carry only `Number`. <!-- EXT-10.5.6-008 EXT-10.6-005 -->
- *unverified*: IREF is a text property on off-page connectors and hierarchical ports and an occurrence property on off-page and pin occurrences. Its stored form is a comma-separated list of decimal page numbers, optionally enclosed in `[..]`, `<..>` or `(..)`; an entry may end in `!`, a trailing `^` means the parent page (not seen in real files), and a few values hold other text. The page value and the occurrence value of one connector normally agree but can differ. Reader: treat IREF as display text; to extract page numbers strip one pair of enclosing delimiters, split on `,`, trim, drop a trailing `!` or `^`, read the decimal number and keep non-decimal entries as text. No occurrence IREF exists in the 104 root streams; the page-record IREF belongs to the page chapter. <!-- EXT-10.9-001 EXT-10.9-002 EXT-10.9-004 EXT-10.9-005 EXT-16.8.5-002 EXT-16.8.5-003 EXT-16.8.5-006 -->
- *unverified*: A link extension of 153 to 201 bytes holds one kind-5 reference-range sub-record laid out as root-data form 2. Never seen on a link. <!-- EXT-16.8.3-004 -->
- *unverified*: Root-data JSON may hold a top-level `global` object of design-wide ranges keyed by prefix; the payload may be `{}`; key order is significant and kept as stored. Neither seen. <!-- EXT-10.5.7-023 EXT-10.5.7-024 -->
- *unverified*: Part references on a page normally fall inside that page's ranges for their prefix, and a `<page>` key need not name a current page. One example only. <!-- EXT-10.5.7-025 -->
- *unverified*: Suffix bytes after the JSON object carry no defined content and may hold JSON fragments or binary. The one example has none. Reader: parse only the first JSON value; an object with duplicate endpoint keys, non-string or non-canonical numbers, or a missing endpoint has no usable ranges, and its bytes are kept. <!-- EXT-10.5.7-026 EXT-10.5.7-028 -->
- *unverified*: `pin_index` is also the index into the device's pin map, which has one entry per symbol pin in the same order. The device pin-map cross-check belongs to the packages chapter. <!-- EXT-10.5.8-026 -->
- *unverified*: Bus pin members are listed in the declared direction of the bus range. Member records carry no names. <!-- EXT-10.5.8-030 -->
- *unverified*: Flat page list ordering: sort page definitions by stream path; output pages of unreferenced views first with root-level references; then, for each referenced view in ascending case-insensitive order and each of its block occurrences sorted by (sort key, upper-cased path), emit a copy of every page with its occurrence path, block `instance_id`, a repeated flag, and that occurrence's child references. Natural reference order splits a reference at its last digit run into (upper-cased prefix, number, upper-cased whole), a reference without digits sorting with number = maximum, so `U2A < U10B`. Page order is not observable in the exports. <!-- EXT-10.10-002 EXT-10.10-007 EXT-10.10-008 EXT-10.10-009 -->
- *unverified*: Listed values that never occur: title-block occurrence short counts other than 0, 4, 11 and 16 within 0 to 19; off-page occurrence short count 1; link extensions of 153 to 201 bytes; `Color` in `RGB(r, g, b)` form; `Line Width` `Medium` and `Wide`; `Line Style` `Dash`, `Dot`, `Dash Dot` and `Dash Dot Dot`; port types 5 and 6; root-data range prefixes other than `*`. <!-- EXT-10.5.2-004 EXT-10.5.2-005 EXT-10.5.2-006 EXT-10.5.8-019 EXT-9.7.2-002 EXT-9.7.2-003 EXT-9.7.2-004 EXT-7.9.1-006 EXT-10.5.7-019 EXT-16.8.2-007 -->
- *unverified*: The occurrence ids the CIS variant store names resolve in the Hierarchy stream. Belongs to the CIS chapter. <!-- INT-8-006 -->

### Unresolved conflicts

- **Link preamble extension (37 or 39 bytes).** INT reads it as a display-property block for the occurrence reference; EXT reads it as a kind-2 attribute-lock sub-record. The data fix only the layout (972 kind-2 sub-records, `m = 37` on 3 and 39 on 969) and that the body follows the preamble length. Settled by locking or moving a reference's display in Capture and diffing the extension. <!-- INT-8-020 EXT-10.5.8-019 -->

### Open questions

- Content of block `trailing_data`: answered, it is the nested scope (§10.9). <!-- EXT-10.oq-004 -->
- Nested hierarchy: answered, blocks nest (226 occurrences below root level; §10.14, §10.15). <!-- EXT-10.oq-010 EXT-10.8-009 -->
- Whether a Hierarchy stream in an unlisted folder is a stale root: no file has one; the multi-stream files hold listed stale roots. <!-- EXT-1.oq-003 -->
- Whether the net list of an unlisted folder's Hierarchy stream follows the same naming rules: no unlisted folder exists. <!-- EXT-11.oq-006 -->
- What the reference ranges of a kind-5 link extension apply to: none exists. <!-- EXT-10.oq-005 -->
- The meaning of the header port record `id`: values are `0xFFFFxxxx`, counting down by one per port; the list equals the root's own page ports on 29 of 32 streams. <!-- EXT-10.oq-006 EXT-10.5.4-003 -->
- The meaning of the literal's leading `1 3` and the `1` before each length, of `IsDataMigrated`, and why `<page>` keys need not name current pages: one example only. <!-- EXT-10.oq-007 EXT-10.5.7-015 EXT-10.5.7-022 EXT-16.8.2-010 -->
- Whether suffix bytes after the JSON object are leftovers of an earlier, longer payload: no suffix bytes observed. <!-- EXT-10.5.7-027 -->
- Which page numbers an IREF lists, what its `!` marker means, and whether the enclosure reflects a display option: no occurrence IREF exists. <!-- EXT-10.oq-008 EXT-10.9-003 EXT-10.9-006 EXT-16.8.5-004 EXT-16.8.5-005 -->
- The order of root-level occurrences: not id order on 92 of 104 streams, not page order. <!-- EXT-10.oq-009 -->
- Which ids the Schematic `id_registry` holds beyond page objects: belongs to the directories chapter. <!-- EXT-18.oq-003 -->
- DrawnInstance unknown bytes (INT counts 30): EXT §7.5 names them; the page chapter owns the layout. <!-- INT-13.3-015 -->
- INT heuristics, with what the data now show:
  - Top-level layout chosen by reading to the exact end: holds on 108 of 109 streams, and only one layout ever fits. <!-- INT-13.4-004 -->
  - Pin ordinal = `pin_index` + 1: page pins are in ordinal order on 17,685 of 17,685 parts; indices are a permutation on 17,671 of 17,685. <!-- INT-13.4-005 -->
  - Bus members matched by position: member counts equal range widths on 1,212 of 1,212 bus pins; member order is not checkable. <!-- INT-13.4-006 -->
  - A schematic no root reaches is left out: 5 listed folders are unreached; no export covers them. <!-- INT-13.4-007 -->
  - Only the suffix-named root is read among several unplaced roots: `trs80_power` and `nixie` hold several. <!-- INT-13.4-008 -->
  - A view another view places is not a root: `EEM2TTL`'s IO is placed by TOP, and reading TOP matches the export 100%. <!-- INT-13.4-009 -->

### Parser divergences

None in this chapter: no verdict found the parser contradicting the files here.

Resolved: a bus port member that follows the parent's member wire took the wire group's lowest SchematicNet id (`Wire.id`) as its net-group key, while every pin keys by the wire `db_id` its `wire_id` names (76,727 of 76,727 wired pins on the 106 readable designs match a page wire's `db_id`, none a `Wire.id`; `private/m2/key-space.ts`). The two id spaces overlap, so the member could join an unrelated wire's group. The group key is now the group's lowest wire `db_id` (`page-groups.ts`). **T** (`hierarchy-connectivity.test.ts`: the TOPCLK wire's `db_id` equals the X_D1 wire's SchematicNet id, and C6.1 lands on TOPCLK under the old key); nets are identical on every readable corpus and fixture design, so none hit the overlap. The same walk, when the parent's member has no wire, added the parent placement's offset to a block pin wire id the expander had already shifted; it now keeps that id (`net-pins.test.ts`).

<!-- meta: EXT-10.10-010 EXT-16.8.1-001 EXT-16.8.5-001 INT-12.6-007 INT-13.8-009 -->

Parser coverage: `hierarchy-parser.ts` reads the root name, header port names, the scope lists (design net ids and names; it skips 82 and 91 bodies), the occurrence tree with references, `contents`, pin occurrences and their `Number` properties, and the nested block scopes, and `hierarchy-expander.ts` implements root choice and §10.15; the parser skips `designator_index` as unknown, does not read root data, link extensions beyond their length, the watermark, header port ids, net format properties or IREF.

---

## 11. Connectivity and net naming

A `.DSN` file stores no pin-to-net netlist. Each page stores wire segments carrying a page-level net id, the names of those page nets, part pins with their connection points, named connectors (Globals, off-page connectors, hierarchical ports) and hierarchical blocks; the root's Hierarchy stream stores the design net names (§10.6). Connectivity is derived from coordinates and names. **S** <!-- EXT-11-001 EXT-11-002 EXT-0.4-007 -->

Evidence in this chapter: **S** counts come from the connectivity check over the 105 readable files; **E** counts compare against `pstxnet.dat` on the 30 designs that have one. 21 of those exports are **fresh** (our parser reproduces them 100%); 9 are older than their `.DSN` and are cited only where stated.

### 11.1 Page nets and net-name rows

| Record | Connectivity fields | Evidence | ids |
| --- | --- | --- | --- |
| SchematicNet (52), page list of schematic nets | `u32 id` (net id), `lstr name` (always empty; names live in the rows), `u32` reserved 0, `u32 colour`, `u32 line_style`, `u32 line_width` | S (15,168) | <!-- EXT-11.1.1-001 EXT-11.1.1-009 --> |
| NetBus (53), page list of net buses | The same six fields, then `u16 member_count`, `member_count × u32` scalar SchematicNet ids | S | <!-- EXT-11.1.1-002 --> |
| Net-name row, page list 4 | Unframed: `lstr name` (never empty), `u32 id`; `u16`-counted | S (25,414 rows) | <!-- EXT-11.1.1-003 EXT-6.8-001 EXT-6.8-002 EXT-6.8-004 INT-7.5-002 --> |

- A row's `id` is a page net id, the same value wires carry in `Wire.id`: a SchematicNet on 24,202 rows and a NetBus on 1,212 (a bus's name, such as `DATA[7:0]`). **S** <!-- EXT-6.8-005 INT-7.5-001 INT-7.5-003 EXT-18.10.2-008 -->
- The Hierarchy stream's design net (type 67) serves a similar purpose with the field order reversed (id, then name). **S** <!-- EXT-6.8-003 -->
- One id can have several rows with different names (303 ids); the same `(id, name)` pair never appears twice in 25,414 rows. **S** <!-- EXT-6.8-008 --> No two ids on one page share a first-row name, case-insensitively (25,081 of 25,081). **S** <!-- EXT-11.1.1-010 -->
- Together, an id's rows list the names the page net carries: its aliases and the names of attached connectors. An alias name is a row name of its wire's net on 15,772 of 16,163 aliases; 391 aliases have no matching row (for example BeagleBoard-xM `SDC_nCS0`). Tracing every row to an object was not done. **S** <!-- EXT-11.1.1-011 EXT-6.8-009 EXT-18.10.2-009 -->
- Rows follow neither id order nor the net header order (371 of 373 pages with more than two named nets). **O** <!-- EXT-6.8-012 -->
- Row order carries no precedence and no row is primary: where a net has several drawn names, the export never picks by row order (§11.6). **E** <!-- EXT-6.8-013 EXT-11.1.1-012 -->
- Our parser stores every name per id and picks the net's name later; that choice reproduces the exports. **E** <!-- INT-7.5-004 --> Net names are upper-cased, as the Cadence exports write them; parser output matches 4,601 of 4,601 fixture nets. **E** <!-- INT-7.5-005 -->
- A net with no row is unnamed (§11.6 step 4). **E** (1,072 of 1,072 nodes) <!-- EXT-6.8-007 EXT-11.1.1-013 -->
- NetBus member ids name scalar SchematicNets on the same page: 12,130 of 12,130. The member count equals the bus alias range width on 795 of 795. **S** <!-- EXT-11.1.1-015 -->

### 11.2 Wires and junctions

| Field | Meaning | Evidence | ids |
| --- | --- | --- | --- |
| type | 20 scalar, 21 bus; both share one page wire list (81,637 scalar, 2,884 bus) | S | <!-- EXT-11.1.1-005 --> |
| `u32 db_id` | Object id (segment id) | S | <!-- EXT-11.1.1-004 --> |
| `u32 id` | Net id | S | |
| `u32 colour` | | S | <!-- EXT-16.2.4-009 --> |
| `i32 × 4` | Start and end | S | |
| `u8` junction flags | Bit 0: dot at the start point; bit 1: dot at the end point; bits 2 to 7 always 0 (84,521 of 84,521) | S | <!-- EXT-16.6.5-001 EXT-16.6.5-002 EXT-16.6.5-003 EXT-16.6.5-004 EXT-7.18-008 --> |
| aliases (49) | Each with a name and a `u32 colour` | S | <!-- EXT-16.2.4-010 --> |
| displays, `u32 line_width`, `u32 line_style` | | S | |

- Every scalar wire's `id` is a SchematicNet on the same page (81,637 of 81,637), and a wire's `db_id` never equals its `id` (84,521 of 84,521). **S** <!-- EXT-11.1.1-006 --> A bus wire's `id` is a NetBus on the same page, never a SchematicNet (2,884 of 2,884). **S** <!-- EXT-11.1.1-014 -->
- All wires of one geometric node carry the same `id` (12,128 of 12,128 nodes); all wire segments sharing an `id` belong to one logical net. **S** <!-- EXT-11.1.1-007 INT-7.6-012 -->
- One SchematicNet id may span several geometric nodes (islands): 1,549 ids do. They are one page net sharing the id and its name; each fresh export puts them on one net. **E** <!-- EXT-11.1.1-008 -->
- Wire `db_id`s are named by pin wire ids (57,816), connector tails (14,478) and port trailers (1,725), all on the same page. Net ids are named by wires (84,521), pin net ids (910), bus member lists (12,130) and net-name rows (25,414). **S** <!-- EXT-7.17-003 EXT-7.17-004 -->
- An Alias (49) is a net-name label owned by one wire; its name is one of its net's row names on 15,772 of 16,163 aliases (391 have no row). **S** <!-- EXT-7.8-001 -->
- **Junctions.** There is no junction record; a dot is bit 0 or 1 of a wire's flags, at that wire's start or end. **S** <!-- EXT-7.16-001 EXT-7.16-002 --> At most one scalar wire owns a junction point on 18,125 of 18,243 points; 118 points are owned by two (`parallella-aafm` FMC). **S** <!-- EXT-7.16-003 --> Wire ends at flagged points: 3 on 16,624, 2 on 1,012, 4 on 607. **O** <!-- EXT-7.16-004 --> A flagged point has at least three connections (wire ends, pins, connector points) on 18,241 of 18,243, and a point where three or more wire ends meet is flagged on 17,231 of 17,235. **S** <!-- EXT-11.2-012 --> Bus wires have flags 0 on 2,882 of 2,884; 2 have value 2 (`parallella_schematic.dsn`, `parallella_e16_z7020_schematic.dsn`). **S** <!-- EXT-16.6.5-005 -->
- Junction flags are display data: naming by coincidence alone reproduces the exports. **E** <!-- EXT-11.2-013 EXT-16.6.5-006 -->

### 11.3 Pin connection fields

Each pin instance (type 16) stores a connection point (hotpoint), a `u16` pin word and two `u32` connection fields. **S** (62,873 pins) <!-- EXT-11.1.2-001 EXT-16.6.4-001 EXT-16.6.4-002 EXT-16.6.4-005 -->

**Pin word.** Below 0x8000 the pin ordinal is the word, with the high bit clear; at 0x8000 and above the ordinal is `0x10000 - word` and the high bit is set. A placed part's ordinals are 1..n in pin-list order on 17,685 of 17,685 parts (bit set on 3,217 pins). **S** <!-- EXT-11.1.2-002 EXT-16.6.4-003 -->

The high bit does not mark connection. Over 105 decoded design files (all pages of all folders, part and block pins) it is set on 367 wired pins, 2,840 isolated pins and 10 connector-only pins, and clear on 57,449 wired, 1,401 isolated and 806 connector-only pins. On flat designs with exports, isolated pins land in the export's `NC` whether flagged (1,291) or not (251), and 113 flagged pins on wired nodes sit on real export nets. **E** <!-- EXT-11.1.2-008 EXT-16.6.4-004 --> Decide connectivity from coordinates and the connection fields, never from the high bit. **E** <!-- EXT-11.1.2-010 -->

**`wire_id`** (pin +0x06):

| Value | Meaning | Evidence | ids |
| --- | --- | --- | --- |
| a wire `db_id` | A scalar wire on the same page ends exactly at the hotpoint; the pin's `net_id` is then 0 (57,816 of 57,816). Block pins also name bus wires ending at the pin (900). | S | <!-- EXT-16.6.4-008 EXT-18.10.2-007 INT-7.7.1-016 --> |
| `0xFFFFFFFF` | No wire touches the pin; a Global or off-page connector's connection point lies on it, or another pin's hotpoint equals it. Holds on 5,052 unwired pins; exceptions: 900 block pins name a bus wire ending at the pin, and 4 abutting part pins of `SPICE_DIFFCIRCUIT` have `wire_id` 0. Every such pin has a non-zero `net_id` (816 of 816). The pin's net is fixed by that coincidence; a sentinel pin never sits on a wire endpoint or wire body. | S | <!-- INT-7.7.1-018 EXT-11.1.2-006 EXT-16.6.4-007 EXT-16.13.2-009 EXT-7.4-015 --> |
| 0 | The pin touches nothing: no wire end, connector point or pin. One exception (`DECADECOUNTER`, a pin at a wire end). | S | <!-- EXT-11.1.2-007 EXT-16.6.4-006 --> |

- A pin is wired exactly when a scalar wire endpoint equals its hotpoint, and its `wire_id` then names such a wire: 59,572 of 59,573 part pins (1 exception: `DECADECOUNTER` pin at (400,140) has `wire_id` 0 at a wire end). **S** <!-- EXT-7.4-012 EXT-11.1.2-003 -->
- No pin hotpoint lies strictly inside a wire segment on 62,871 of 62,873 pins; the 2 exceptions are in `reServer industrial J401` at (1610, 290) and (1610, 300). **S** <!-- EXT-11.1.2-004 -->
- An unwired pin's `wire_id` is 0 (4,241) or `0xFFFFFFFF` (816). **S** <!-- EXT-11.1.2-005 -->
- Unwired-pin rule (`0xFFFFFFFF` exactly when a connector point or another pin is there, else 0): holds on 5,052 pins; 900 block pins instead name a bus wire ending at the pin (the bus extends the rule), and 4 part pins of `SPICE_DIFFCIRCUIT.DSN` (two corpus copies, at (140,350) and (140,390)) abut another pin yet have `wire_id` 0 with a non-zero `net_id`. **S** <!-- EXT-7.4-013 -->

**`net_id`** (pin +0x0A):

- When non-zero it names a SchematicNet on the same page (910 of 910): the same id space as `Wire.id`. **S** <!-- INT-7.7.1-015 EXT-16.6.4-009 -->
- It is non-zero only on pins that no wire touches, on 909 of 910; the exception is `DECADECOUNTER`. **S** <!-- EXT-7.4-014 -->
- It is set on wireless connections (pin on pin, connector on pin), and also on 89 pins that touch nothing at all (`wire_id` 0). **O** <!-- EXT-7.4-016 -->

### 11.4 Connectors: names and connection points

| Object | Name used for connectivity | Connection point | Evidence | ids |
| --- | --- | --- | --- | --- |
| Alias (49) | Its text | The wire it belongs to | E (3,646 of 3,646 fresh nodes) | <!-- EXT-11.1.3-001 --> |
| Global (37) | The `Name` string (`strLst[name_str_idx]`); EXT falls back to the symbol name when `Name` is empty, which never occurs | From its cached Global symbol (33) | E (3,837 of 3,837 fresh nodes) | <!-- EXT-11.1.3-002 INT-12.4-011 --> |
| Off-page connector (38) | As Global | From its cached off-page symbol (35) | E (2,921 of 2,921) | <!-- EXT-11.1.3-003 --> |
| Hierarchical port (23) | The port name | From its cached port symbol (34) | S | <!-- EXT-11.1.3-004 --> |
| Block port (inside 12) | The block port name | Block location plus port hotpoint for unrotated blocks (§10.14) | S | <!-- EXT-11.1.3-005 --> |

- Globals are power and ground symbols; off-page connectors join same-named nets across pages, and connectors sharing a `name_str_idx` are one net. **E** (2,921 of 2,921 fresh) <!-- EXT-7.10-001 INT-7.8-024 INT-12.4-006 -->
- The `Name` string differs from the symbol name on 6,475 of 6,491 off-page connectors, and on 3,660 of 8,212 Globals (equal on 4,552). **S** <!-- EXT-7.10-004 INT-7.8-025 --> A symbol drawn as `VDD_1v8` may carry `CAM_CORE`; two symbols drawn as `VCC_BAR` carry `VDD_PLL1` and `VDD_PLL2`. **T** <!-- INT-12.4-012 --> `pairingId` 17700 reads `GND_SIGNAL` on three Jetson carrier designs, a name absent from their exports. **S** <!-- INT-12.4-015 -->
- Trailer wire ids: a port's trailer wire id names a wire on the page (1,725 of 1,725 non-zero), and the port's connection point is that wire's endpoint (1,725 of 1,725). A Global or off-page tail wire id is 0 or names a wire on the page (8,013 of 8,013 Globals, 6,465 off-page). **S** <!-- EXT-7.9-005 EXT-7.10-012 -->
- A connector's stored location is the anchor of its symbol's placement box, not its connection point; the two never coincide in 16,719 connectors. The box is larger than the wire, so on rail fan-outs (rails one grid step apart, boxes two steps tall) the location often lands on a neighbouring rail's endpoint. **S** <!-- EXT-11.1.3-007 EXT-7.10-009 INT-12.4-017 -->

**Computing a connection point** (EXT §11.1.4):

1. Candidates are Cache symbols of the kind the connector's symbol-kind byte gives (33 Global, 35 off-page, 34 port) whose name equals the connector's symbol name. **S** <!-- EXT-11.1.4-001 -->
2. If exactly one candidate's source library equals (case-insensitively) the connector's, use it; else if there is exactly one candidate, use it; else there is no symbol. For ports with several candidates this picks a symbol with the right pin type on 440 of 444. **S** <!-- EXT-11.1.4-002 -->
3. Placement box: the bounding box of the symbol's primitives. Lines, rectangles, ellipses and arcs contribute their two corners; polygons, polylines and Béziers every point; bitmaps `(raster_x, raster_y)` and `(raster_x + pixel_width, raster_y + pixel_height)`; nested vectors their own box offset by their location; text nothing. **S** <!-- EXT-11.1.4-003 -->
4. Per axis with extent (lo, hi): if lo ≥ 0 the placement extent is (0, snap(lo + hi)), else (lo, lo + snap(hi - lo)), where snap rounds up to a multiple of 10. **S** <!-- EXT-11.1.4-004 -->
5. Transform the four corners; `ox = loc_x - min x`, `oy = loc_y - min y`. **S** <!-- EXT-11.1.4-005 -->
6. Transform a symbol point: mirror negates x first; rotation 1 maps (x, y) to (y, -x), 2 to (-x, -y), 3 to (-y, x). **S** <!-- EXT-11.1.4-007 -->
7. Connection point = transformed hotpoint of the symbol's single pin + (ox, oy). **S** <!-- EXT-11.1.4-008 -->

This reproduces the tail-wire endpoint on 8,013 of 8,013 Globals, 6,273 of 6,465 off-page connectors (192 misses, in `opencellular-sdr`) and 1,725 of 1,725 ports. **S** Computed points fall on a wire end (Globals 8,013, off-page 6,047, ports 1,449), on a pin hotpoint (197, 10, 199) or on nothing (2, 434, 368); none lies strictly inside a wire (0 of 16,719). **S** <!-- EXT-11.1.4-009 -->

### 11.5 Geometric nodes

- The two endpoints of a scalar wire are one node; wire endpoints with equal coordinates are one node. Built this way, each of 11,321 page nodes on fresh designs maps to one export net. **E** <!-- EXT-11.2-001 EXT-11.2-002 INT-12.4-001 -->
- Wires sharing a `Wire.id` are one net: 1,549 ids span several nodes, each on one export net. **E** <!-- INT-12.4-002 -->
- Wires are split at every junction: no wire endpoint lies strictly inside another wire (163,274 of 163,274). **S** <!-- EXT-11.2-003 --> The reader rule "an endpoint lying on another axis-aligned scalar wire joins it" is therefore never needed. **S** <!-- EXT-11.2-004 -->
- A pin joins the node of the wire endpoint at its hotpoint. **E** <!-- EXT-11.2-007 -->
- Pins with equal hotpoints are one node even without a wire: each pin-on-pin node is one export net, named `N<digits>` (23 nodes), but the number cannot be derived (§Open questions). **E** <!-- EXT-11.2-008 -->
- A Global, off-page connector or port joins the node at its connection point (§11.4): the wire endpoint there, else the pin there. **E** (Globals 3,837, off-page 2,921 fresh) <!-- EXT-11.2-009 --> A connector whose point equals a pin hotpoint connects the pin to its name, whatever the pin word's high bit (197 Globals, 10 off-page). **E** <!-- EXT-11.3-002 -->
- Bus wires and NetBus records do not join scalar nodes (bus wires name NetBus ids only, 2,884 of 2,884). **S** <!-- EXT-11.2-010 -->

### 11.6 Unconnected pins

- A pin that touches no wire, connector point or other pin is unconnected (`wire_id` 0). The export lists such pins under the pseudo-net `NC` (1,542 pins), which is not a design net; 22 isolated pins are absent from the export. **E** <!-- EXT-11.3-001 --> Our parser infers `NC` the same way (`net_id` 0 and no wire, symbol or overlapping pin at the coordinate) and reproduces the export's pin sets exactly on the fixtures, `NC` included. **E** <!-- INT-7.7.1-013 INT-7.7.1-014 -->
- Floating power pin: 2 unconnected pins whose symbol pin type is 7 (Power) appear in the export on the net named by their pin name, upper-cased; 19 others are absent from the export (6 in fresh designs, for example `DECADECOUNTER` INS30 VCC). **E** <!-- EXT-11.3-003 EXT-16.5.5-012 -->
- 14 isolated pins of `ONYXPSU` (stale export) sit on real nets through physical pins shared across sections (S2, S3), consistent with a physical pin drawn in several sections taking the connected drawing's net; not separately proven. **E** (stale) <!-- EXT-11.3-004 -->

### 11.7 Page net naming

A page node's name is decided in this order. With the H-priority of step 3, the procedure names **11,311 of 11,321** page nodes as `pstxnet.dat` does on the 21 fresh designs (step 1: 3,837; step 2: 2,921; step 3: 3,646; step 4: 907). The 10 others are pin-to-pin nodes (§Open questions). **E** <!-- EXT-0.4-007 -->

1. **Global.** If one or more Globals are attached, the name of the first in page record order. **E** (3,837 of 3,837 fresh) <!-- EXT-11.4-001 --> Seven nodes with several distinct Globals exist, all in stale designs: the export takes the first in page order on 4 and another on 3.
2. **Off-page connector.** Else, the off-page connector's name. **E** (2,921 of 2,921 fresh) <!-- EXT-11.4-002 --> Where an off-page name and another drawn name, neither in H, meet on one node, the export takes the off-page name (14 nodes).
3. **Drawn names.** Else, the names drawn on the page net (its net-name rows and its wires' aliases). With several, a name in the root Hierarchy net list H wins; within the set that applies, the alphabetically first (upper-cased) wins. The export takes the one name in H on 76 of 82 nodes with several drawn names, and the alphabetically first only on 31 of 82; with two names in H the alphabetical rule applies on 2 of 3 nodes; 3 nodes take a name not drawn on them. **E** <!-- INT-12.4-003 INT-12.4-004 EXT-11.4-007 --> Example: rows `CLKQ1_P` and `DPCIE1_REFCLK1_P`, only the second in H: the node is `DPCIE1_REFCLK1_P`.
4. **Generated.** Else the node has at least one wire and is `N` followed by its smallest wire `db_id` in decimal, zero-padded to at least 5 digits (`N01234`); part ids do not count. **E** (1,072 of 1,072 across all exports, 907 on fresh) <!-- EXT-11.4-004 EXT-11.4-009 INT-7.6-013 INT-7.6-014 INT-12.4-005 -->

- **H is authoritative.** A connector name not in H is a page-local link label: it does not rename a node that carries another name in H, and the H name applies. **E** (22 of 22 nodes) <!-- EXT-11.4-005 EXT-11.4-008 --> Example: a node with alias X and Global GND attached is `GND` (step 1). **E** <!-- EXT-11.4-006 -->
- Names are compared trimmed and upper-cased; the stored spelling is kept for output. **E** <!-- EXT-11-006 -->
- The design net list in H is the authority for final names on flat designs (several-drawn ties resolve to the H name, 76 of 78). On hierarchical designs the placement-local names live in each placement's nested scope, not in the root list (§10.6, §10.15). **E** <!-- EXT-11-003 -->
- On flat designs the root net list is the flattened design net list: names unique case-insensitively, so two page nets resolving to one name are one design net, and every export name is in it except `NC`. On hierarchical designs the root list lacks placement-local nets (`SEQUENTIALTIMER`: 14 of 32 export names, `N00439_MV1` and others, come from nested scopes). **E** <!-- EXT-11.1.7-001 EXT-10.5.5-004 -->

### 11.8 Design-level merging

- The design netlist is keyed by final net name: pins whose page nodes end with the same name are one design net. Our parser's name-keyed merge reaches 100% connectivity on 4,601 fixture nets. **E** <!-- EXT-11.5-001 -->
- Globals connect by name across every page; a Global name is never scoped to a page. **E** (3,837 of 3,837 fresh) <!-- EXT-11.5.1-001 -->
- A link between a name in H and a page-local label maps the label to the H name; page-local connector names never displace H names (22 of 22). **E** <!-- EXT-11.5.2-002 -->

### 11.9 Repeated page-local names

- A page-local name `BASE` drawn on several pages without a link between them is several design nets; one copy keeps `BASE` and each other copy is `BASE_<id>`. **E** (`reServer industrial J401`, 214 nodes) <!-- EXT-11.5.4-001 -->
- **Suffix rule (new):** `<id>` is the smallest `db_id` over the whole page net of that copy, every island of its SchematicNet id included, counting its wires and the placed parts with a pin on it, written in decimal without padding. This matches 214 of 214 suffixed nodes. **E** (one design) <!-- EXT-11.5.4-002 --> EXT's narrower rule (the smallest over the copy's own node only) matches only 118 of 214, and the suffix never equals the page SchematicNet id.
- A design net `BASE_<digits>` whose number is no such id is an ordinary name, not a suffixed copy. **S** <!-- EXT-11.5.4-003 -->
- Our parser reproduces every case with a different, reproducing rule: from the H names `BASE_<digits>` that no page net carries as its own name, order the suffixes by value and the page copies of `BASE` by smallest wire id, and walk both in step; a copy takes the next suffix when that suffix is at most its smallest id, and the copy left over keeps `BASE`. Hierarchy names are the root scope's, and a placement's pages use their own scope's names. **E** (`reServer J401` connectivity 100%) <!-- INT-12.4-010 -->

### 11.10 Bus member naming

- A bus name with a range expands to scalar member names in declared order. Member counts equal the range width on 2,007 checks: 1,212 bus pin occurrences and 795 NetBus aliases. **S** <!-- EXT-11.6-001 -->
- Members are `PREFIXa … PREFIXb`, stepping +1 if a ≤ b, else −1, inclusive: member counts equal `|a − b| + 1` on 2,007 checks (1,212 bus pin occurrences, 795 NetBus aliases); of 1,791 bus names seen (bus aliases and block pin names), 1,775 descend and 16 ascend. Member names are not stored. **S** <!-- EXT-11.6-003 -->
- Syntax seen: `PREFIX[a:b]` (1,768: 1,760 descending, 8 ascending) and `PREFIX[a..b]` (23: 15 descending, 8 ascending), with a non-empty prefix. No negative index occurs. **O** <!-- EXT-11.6-002 -->
- On a page, scalar nets join a bus as members by name (`DATA7` is member 7 of `DATA[7:0]`); bus entries are not needed. Across a block port, members bind by position (§10.15).

### 11.11 Our netlist assembly

These rules turn the stored records into the parser's netlist. They are application logic, checked against the exports.

**Page grouping (INT §12.4).**

- Symbol keying: a Global or port is keyed in the union-find by `sym:{name_str_idx}:{dbId}`, never by its location (location keying merged the symbol with whatever wire ended there). **T** <!-- INT-12.4-018 -->
- A symbol performs at most one union: it picks the wire coordinate inside its box that already carries its own `strLst[name_str_idx]` name; failing that, only coordinates with no name of their own are eligible, ranked by distance to the box centre, not to the location. **T** <!-- INT-12.4-019 INT-12.4-020 --> The name steers the symbol to its wire and names a sentinel pin (`0xFFFFFFFF`) in the box that no wire resolved. **E** (fixtures 100%) <!-- INT-12.4-013 --> Where the symbol reaches a wire, that wire group's name wins, because `strLst[name_str_idx]` is occasionally a symbol type. **T** <!-- INT-12.4-014 --> A symbol whose own name is unknown (Library stream unreadable) keeps every in-box coordinate eligible. **T** <!-- INT-12.4-022 -->
- An off-page connector is matched to a pin by testing five points: the four box edge midpoints and its own location. **S** as a parser heuristic; the computed connection point (§11.4) is the file's actual point. <!-- INT-12.4-007 --> A pin at any of these points takes the connector's name even when the connector has no wire on that page. **E** <!-- INT-12.4-009 -->
- A pin on the body of a horizontal or vertical wire segment is unioned with that wire. Such pins occur on only 2 of 62,873 pins (`reServer industrial J401`). **S** <!-- INT-12.4-016 -->
- With these rules and the pin-numbering rules below, all 4,601 nets on 10 fixtures match the export exactly. **E** <!-- INT-12.4-023 -->

**Pin numbers (INT §12.1).**

- Pin number = `Device.pinMap[pinIndex − 1]`, where `pinIndex` is the page pin's ordinal (`pinIndex 5`, `pinMap[4] = A5` gives `A5`). **E** (22,234 of 22,234 fixture pins; 4,996 of 5,010 corpus) <!-- INT-12.1-001 INT-12.1-002 -->
- If the selected map has no entry at that index (no match or a null placeholder), the other stream's map is tried; only if both are empty is `pinIndex` itself the number, a last resort that equals the physical number only when symbol order matches package numbering. **T** <!-- INT-12.1-003 INT-12.1-004 -->
- The `Packages/` map describes the physical package, whose pad count need not equal the symbol's pin count; one package may serve symbols exposing different subsets. When its length differs from the instance's pin count, the Cache stream's Device is consulted. A Cache map whose length equals the pin count settles the choice either way; otherwise only the longer-package case prefers the Cache. **T** <!-- INT-12.1-005 INT-12.1-006 INT-12.1-007 -->
- A mismatched map can be transposed, not only short: CutiePi `CON_HDMI_RA` is a 23-pin symbol whose `Packages/` map has 20 entries with the 17th and 18th swapped, which put HDMI SCL and SDA on each other's pins; its Cache map has exactly 23 entries in order. **E** (CutiePi pin numbers and connectivity 100%) <!-- INT-12.1-008 INT-12.1-009 INT-12.1-010 -->
- A section with no pad for one of the part's logical pins marks that pin ignored; Cadence's netlist writer leaves it out, and so must ours. **T** <!-- INT-12.1-013 -->

**Pin names (INT §12.2).**

- Pin name = `LibraryPart.symbolPins[pinIndex − 1].name`, the LibraryPart found from `PlacedInstance.pkgName` by `findCachedPart`: (1) `pkgName` is a cached key; (2) `sourcePackage` plus the variant suffix of `pkgName` (`.Normal`); (3) `sourcePackage` with a trailing `_\d+` stripped, plus the variant. **E** (7,300 of 7,300 pins on 10 fixtures) <!-- INT-12.2-001 INT-12.2-002 INT-12.2-003 INT-12.2-004 INT-12.2-005 INT-12.2-023 -->
- Cache LibraryPart names carry a numeric suffix from the originating Package stream (`RES_0.Normal` for `RES.Normal`); the index strips `/_\d+(?=\.)/`. **T** <!-- INT-12.2-006 --> Each LibraryPart is registered under its own name and the stripped name, and a part's own name outranks an alias derived from another variant. CutiePi carries `RES_0.Normal` (pins 1, 2) and `RES.Normal` (pins A, B); first-writer-wins gave every plain resistor the other variant's names and left 75 components without pin names. **E** (CutiePi 100%) <!-- INT-12.2-021 INT-12.2-022 -->
- Post-processing: pin names are upper-cased; duplicates on one component get `#pinNum` (`GND#10`, `GND#11`); a name equal to its pin number counts as absent. **E** <!-- INT-12.2-007 INT-12.2-008 INT-12.2-009 -->

**Package lookup (INT §12.3).** `PlacedInstance.sourcePackage` names the Package with the pin map, not always directly.

- The outer loop walks three spellings, stopping at the first that yields a key: as written; normalized (`_N_` to `_N.0_`); stripped of a trailing `_\d+`. The inner loop tries: (1) the base is a Package key; (2) base plus the unit letter from the `pkgName` suffix, and for a doubled letter (`AA`) its first character; (3) for multi-section parts with no unit suffix, base plus the unit letter at `sectionIndex`. **E** for the loops and step 1, **T** for steps 2 and 3. <!-- INT-12.3-002 INT-12.3-003 INT-12.3-004 INT-12.3-005 INT-12.3-006 INT-12.3-007 INT-12.3-008 INT-12.3-009 -->
- After both loops with no key, base + `A` is tried for each spelling, for packages whose devices are not listed in `deviceUnitRefs`; it runs only after every spelling had its positional lookup, and steps 3 and 4 apply only when no unit letter was extracted. **T** <!-- INT-12.3-010 INT-12.3-011 INT-12.3-015 --> With the fallback inside the inner loop, `LM324_0A` matched before `LM324` reached step 3, so sections B to D of U3 on `DIGITALCONVERTOR.DSN` read section A's pins (issue #247); sections are now listed in `deviceUnitRefs` under every name their maps are stored under, in both indexes. **E** <!-- INT-12.3-012 INT-12.3-013 -->
- Multi-unit `pkgName` is `{sourcePackage}{unitLetter}.Normal` (`OMAP_CBP_1AA.Normal`); Cadence sometimes doubles the letter while the Device unit ref is single. **T** <!-- INT-12.3-014 -->
- Multi-section parts with no unit suffix (`RP1`, package `RPAK_10_8RES`, 8 sections, 16 pins) are several PlacedInstances sharing `(refdes, pkgName)`, each naming its Device through `section_index`. `deviceIndexMap` covers instances with no unit suffix; `deviceUnitRefs` is keyed by the package name and its `_N`-stripped form and holds the ordered unit letters; `findPinMap` selects `pinMaps.get(base + unitRefs[sectionIndex])`. **E** (BeagleBoard-xM 100%) for the data and selection, **T** for the map construction. <!-- INT-12.3-016 INT-12.3-017 INT-12.3-018 INT-12.3-019 -->
- An earlier heuristic sorted each group by `dbId`; `dbId` order is not section order. On BeagleBoard-xM the eight RP3 sections are allocated with adjacent pairs transposed, so six of sixteen pins went to wrong nets while coverage stayed at 100%; only a per-net `{refdes.pin}` comparison exposed it. **E** <!-- INT-12.3-020 INT-12.3-021 -->

**Components (INT §12.5).** Multi-unit components are several PlacedInstances sharing one refdes, each with its own pins; the parser merges them into one component. **E** (6,360 of 6,360 fixture components) <!-- INT-12.5-001 -->

### Refuted

| Claim | Source | What the files show | Evidence | ids |
| --- | --- | --- | --- | --- |
| Every net-name row names a SchematicNet; bus nets have no rows | EXT §6.8 | 1,212 rows name a NetBus | S | <!-- EXT-6.8-006 --> |
| With several drawn names the alphabetically first applies | EXT §11.4 | Alphabetical on 31 of 82 nodes; the name in H on 76 of 82 (§11.7 step 3) | E | <!-- EXT-11.4-003 --> |
| Pin-word bit 15 is the no-connect marker | INT §7.7.1 | Set on 367 wired pins (105 files, all pages); 113 flagged pins on real export nets; isolated pins are `NC` with the bit clear (251) and set (1,291) | E | <!-- INT-7.7.1-017 --> |
| Pin `net_id` values are a different id space from `Wire.id` | INT §7.7.1 | They are page SchematicNet ids, the space `Wire.id` uses (910 of 910) | S | <!-- INT-7.7.1-019 --> |

### Unverified

- *unverified*: Pages of an unlisted folder are not part of the netlist or component list. No unlisted folder exists. <!-- EXT-1.3.2-002 -->
- *unverified*: A net with several named objects has one row per name, a net with none has no row, and some row names cannot be traced through the page's wire links (for example connectors not linked to a wire). Rows were not traced to objects. <!-- EXT-6.8-010 EXT-6.8-011 -->
- *unverified*: A wire whose colour is 48, width 3 or style 5 takes that value from its net's header, and a wire's explicit values win. Display behaviour. <!-- EXT-9.7.1-010 EXT-9.7.1-011 -->
- *unverified*: Alias font reference: bits 0 to 15 are the font, bits 16 to 31 opaque. Belongs to the display chapter. <!-- EXT-16.4.3-003 -->
- *unverified*: A symbol with no boundable primitive uses `(ox, oy) = (loc_x, loc_y)`; a symbol with zero or several pins yields no connection point. Not counted. <!-- EXT-11.1.4-006 EXT-11.1.4-010 -->
- *unverified*: The same placement rule maps a placed part's cached pin hotpoints to its stored pin points. Belongs to the symbols chapter. <!-- EXT-11.1.4-011 -->
- *unverified*: A bus entry stores two points one grid step (10) apart on both axes, and can sit on pages with no bus wires, touching nothing. Belongs to the page chapter. <!-- EXT-11.1.6-001 EXT-11.1.6-002 -->
- *unverified*: Crossing wires without an endpoint on each other are not connected; diagonal wires connect only at their endpoints (8 diagonal wires exist). Not tested against an export. <!-- EXT-11.2-005 EXT-11.2-006 -->
- *unverified*: Net names in the constraint storage are added to H; every `Net.xml` row's `<net>` names exactly one Hierarchy net, nearly every named net has a row (a reader allows a missing one), the row's `A` equals the net's name, and the net carries the row's properties in order. A Pin row's `<dbo>` is the Library string a placed instance uses as its name (normally one instance), `<ref>` its refdes, `<physical>` its `CDS_PN`, `<pin>` the cached symbol's pin and the physical number the device pin-map entry; some `<dbo>` values match no instance or two, and some carry an older refdes, so the archive is a possibly stale snapshot. No readable file has `Views/*/Constraint`. <!-- EXT-11.1.7-002 EXT-13.5.3-001 EXT-13.5.3-002 EXT-13.5.3-003 EXT-13.5.3-004 EXT-13.5.3-005 EXT-13.5.4-001 EXT-13.5.4-002 EXT-13.5.4-003 EXT-13.5.4-004 -->
- *unverified*: Daggered EXT reader guidance for nodes that do not decide cleanly: a further connector on a node claimed by a differently named connector records a short; if both names are in H the node keeps the one with the lower design net id; a Global on a node named by another Global records a short; a connector renames a named node only if no other node on the page carries its name and it has not renamed another node, recording the pair as displaced. No isolated case. <!-- EXT-11.4-011 EXT-11.4-012 EXT-11.4-013 EXT-11.4-014 -->
- *unverified*: An off-page connector named as a Global used elsewhere, on a page with no such Global, joins the Global net, or takes `NAME_<id>` when H holds it. Not isolated. <!-- EXT-11.5.1-002 -->
- *unverified*: Link rules: links are collected from every page as (node name, connector name) pairs plus the shorts above; a link between two H names is ignored; links between labels not in H join them into groups mapping to the smallest H name any member reaches; a label with several candidate H names takes the lexicographically smallest; within one page a local name linked to exactly one off-page name that is another design net is renamed to it. Consistent with the 22 H-name nodes, not isolated. <!-- EXT-11.5.2-001 EXT-11.5.2-003 EXT-11.5.2-004 EXT-11.5.2-005 EXT-11.5.2-006 -->
- *unverified*: Displaced names (EXT §11.5.3), for a name displaced onto exactly one target resolved through the link rules: old in H and target in H, no merge; old in H, target not, the target maps to the old name's spelling; old not in H, target in H, the old name maps to the target's spelling; neither in H, the old name maps to the target; a name displaced onto two targets joins neither. No isolated case. <!-- EXT-11.5.3-001 EXT-11.5.3-002 EXT-11.5.3-003 EXT-11.5.3-004 EXT-11.5.3-005 EXT-11.5.3-006 -->
- *unverified*: Inside repeated block copies, each page net's name is the first drawn name in H, else a port or Global name on the page, else the alphabetically first; off-page names on such a copy are scoped like other local names unless also a Global on that page. Not isolated; no off-page connector on a repeated child page has an export. <!-- EXT-11.5.6-002 EXT-11.5.6-005 -->
- *unverified*: Bus indices are signed 32-bit and may be negative (`D[-1..1]` gives `D-1`, `D0`, `D1`; `D[3:0]` gives `D3` to `D0`), with at most 65,535 members. No negative index exists in the corpus. <!-- EXT-11.6-004 -->
- *unverified*: Testing only five off-page points, not every edge point, stops dense sheets with vertically overlapping boxes from fusing nets. Design rationale. <!-- INT-12.4-008 -->
- *unverified*: A symbol's location lies outside its own box on 1,405 of 3,971 fixture symbols (35.4%). Not recomputed. <!-- INT-12.4-021 -->
- *unverified*: Section-index assignment cut nets disagreeing with the export from 79 to 24 (98.4% to 99.5%), and geometric orderings did worse (locY 81, locX 103, descending 131 and 139). Historical counts of an earlier parser state. <!-- INT-12.3-022 INT-12.3-023 -->

### Unresolved conflicts

None: every INT and EXT conflict in this chapter was decided by the data.

### Open questions

- **The 10 pin-to-pin nodes.** On fresh designs, 10 page nodes with no wire and no name (pins joined pin-on-pin, carrying a pin `net_id`) are named `N<digits>` by the export, and the digits equal neither a wire id nor the pins' net id (23 such nodes across all exports, for example CutiePi `N1308043429`, `N132243780`). The numbers appear nowhere in the `.DSN` except as H names, so our parser matches these nets to H's `N<digits>` names by sort order, a heuristic of stated medium risk. <!-- INT-13.4-016 -->
- Which copy of a repeated page-local name keeps the bare name: in `reServer J401` it is the copy whose page net has the smallest id, and our parser's walk agrees. One design only. <!-- EXT-11.oq-003 -->
- A Global and an off-page connector with different names, both design nets, on one node: not observed on fresh designs. <!-- EXT-11.oq-004 -->
- Connection points of connectors whose cached symbol has zero or several pins, or no unique cached symbol: 434 off-page and 368 port connection points touch nothing. <!-- EXT-11.oq-005 -->
- How bus entries attach bus members to scalar wires: not parsed. Members join by name (INT §12.6), which tests confirm; bus entry geometry is unused by the export-verified naming. <!-- EXT-11.oq-001 EXT-11.1.3-006 EXT-11.1.6-003 EXT-11.2-011 INT-13.2-002 -->
- Bus wires are read and named by their alias; nothing is traced along them. <!-- INT-13.2-003 -->
- The meaning of pin-word bit 15: not connection (§11.3). <!-- EXT-11.oq-002 EXT-11.1.2-009 -->

### Parser divergences

| Parser does | Files show | Impact | ids |
| --- | --- | --- | --- |
| Parses bus ranges with non-negative indices only, and also accepts `-` as separator (`bus-name.ts:17`) | Syntax seen is `:` and `..`; no negative index or `-` separator occurs | None on the corpus | <!-- EXT-11.6-002 EXT-11.6-004 --> |

Resolved: ports, Globals and off-page connectors join the wire their trailer `wire_id` names (`page-groups.ts`); a trailer `wire_id` of 0 attaches the connector to no wire, and a pin sitting on such a connector is still matched by the connector's box (`page-groups.ts`, `net-pins.ts`). Connector-to-wire attachment no longer uses the box ranking (`symbol-attachment.ts`) or the five fixed off-page points. Resolved too: an unwired pin joins the connector whose computed connection point (§11.4, by the §7.7 rule with the stored box) it sits on (`pinOnSymbol`, `pinOnOffPage`); the box and edge midpoints remain only for a connector with no single-pin cached symbol, which no corpus connector lacks. **E**: of 414 unwired pins the box matched, 83 went to the wrong neighbour; on the three designs with Capture exports among the four that change (`STRAIN GAUGE BOARD`, `ONYXPSU`, `ROHM_SENSOR_PLATFORM_BASE_BOARD`), all 17 changed pins now match the export and none did before. **T** (`connection-point.test.ts`: every fixture connector with a trailer wire has its connection point on that wire's end, except the 8 known OpenCellular GND symbols). **S**: across all 192 corpus and fixture DSNs one pin changes, `CC1310LAUNCHPAD.DSN` (SmartGarden) R32.2 from `N75036` to `5V`: its 5V Global has `wire_id` 0, and the box ranking had joined it to the neighbouring LED wire, bridging a GPIO net into the resistor. **O**: the rendered page shows R32 drawn like its two sibling LED and resistor pairs, whose resistor pin 2 sits on a 5V symbol and is on 5V. No design with a Capture export changes. <!-- EXT-7.10-009 EXT-11.1.4-003 --> <!-- EXT-11.2-009 -->

<!-- meta: EXT-11.4-010 INT-12-001 INT-12.3-001 INT-12.4-024 INT-13.8-010 INT-13.8-011 -->

Parser coverage: the parser reads net-name rows, wires (net ids, endpoints, aliases), pin `wire_id`, `net_id` and ordinals, connector names, block pins and NetBus aliases, and implements page grouping, naming (H first, alphabetical, `N` generation, `BASE_<id>` by its own walk), merging and pin resolution; it does not read junction flags, pin-word bit 15, bus entries, NetBus member lists, or compute connector connection points from cached symbol geometry.

---

## 12. Directory and auxiliary streams

Besides `Library`, `Cache`, the definition storages and the page streams, the root of a `.DSN` or `.OLB` holds seven `* Directory` streams that list the objects of the database, the schematic folders under `Views`, and a set of small administrative streams. This chapter specifies them. Counts are over the 147 readable containers (120 designs, 27 libraries; 130 at Library 3.x, 16 at 2.0, 1 at 1.1) and the 18 Cadence fixtures.

### 12.1 Root entries

| Entry | Content | Evidence | Ids |
| --- | --- | --- | --- |
| `Library` | Version, fonts, page settings, string table (chapter 4) | **S** (147) | <!-- INT-2-001 --> |
| `Cache` | Cached LibraryPart views and Packages, and also terminal symbols (types 33 to 76) and part cells (type 6). Packages without a Cache record exist in `Packages/<p>` streams | **S** (147) | <!-- INT-2-002 INT-2-012 --> |
| `Views/<s>/Pages/<p>` | One stream per schematic page | **S** (162 schematics) | <!-- INT-2-003 EXT-10.1-003 --> |
| `Views/<s>/Hierarchy/Hierarchy` | Occurrence tree of a root schematic | **S** (125 streams) | <!-- INT-2-004 EXT-10.1-004 EXT-10.1-007 --> |
| `Packages/<p>` | Per package: PartCell, its LibraryPart views, then Package with its devices; the Package does not come first (§4.16) | **S** (1,373 v3 streams) | <!-- INT-2-005 INT-2-011 --> |
| `CIS/VariantStore/BOM/<v>/<x>` | BOM variant streams: `BOM/{X}/{X}` in 5 streams, `BOM/{X}/{other}` in 10; contents in the CIS chapter | **O** | <!-- INT-2-006 --> |
| `CIS/VariantStore/Groups/<g>/<x>` | Group streams: `Groups/{X}/{X}` in 14, `Groups/{X}/{other}` in 1 | **O** | <!-- INT-2-007 --> |

The Library holds the string table, fonts and page settings; universal-netlist reads its version, string table and root name. **T** <!-- INT-2-008 -->

Present in 17 of 18 fixtures, and read by no parser code: `AdminData`, `Cells`, `Cells Directory`, `ExportBlocks`, `ExportBlocks Directory`, `Graphics`, `Graphics Directory`, `HSObjects`, `Packages Directory`, `Parts`, `Parts Directory`, `Symbols`, `Symbols Directory`, `Views Directory`. The 18th fixture, `gprino-lf` (`GPR_LF.DSN`, Library 2.0), lacks `AdminData` and `HSObjects`. **S** <!-- INT-2-015 --> `DsnStream` and `NetBundleMapData` are in 16 of 18 fixtures (`gprino-lf` and BeagleBoard-xM lack both). **S** <!-- INT-2-016 --> `BundleMapData` is in 8 and `CIS` in 9 of 18 fixtures. **S** <!-- INT-2-017 --> The content of `BundleMapData` is not decoded here.

Stream sizes:

| Stream | Size | Evidence | Ids |
| --- | --- | --- | --- |
| `Views Directory` | Variable; the schematic folders (§12.3) | **S** (147) | <!-- EXT-12.1-001 --> |
| `Symbols Directory` | Variable, 6 bytes when empty | **S** (72 v3, 12 v2.0, 1 v1.1 empty) | <!-- EXT-12.1-002 --> |
| `Packages Directory` | Variable, 6 bytes when empty | **S** (41 v3 empty) | <!-- EXT-12.1-003 --> |
| `Cells Directory` | Variable, 6 bytes when empty | **S** | <!-- EXT-12.1-004 --> |
| `Parts Directory` | Variable, 6 bytes when empty | **S** | <!-- EXT-12.1-005 --> |
| `ExportBlocks Directory` | Always 6 bytes | **S** (147) | <!-- EXT-12.1-006 --> |
| `Graphics Directory` | Always 6 bytes | **S** (147) | <!-- EXT-12.1-007 --> |
| `DsnStream` | Variable (§12.4) | **S** (102 streams) | <!-- EXT-12.1-008 --> |
| `HSObjects` | 16 bytes (§12.5) | **S** (105 v3, 4 v2.0) | <!-- EXT-12.1-009 --> |
| `NetBundleMapData` | 4 bytes without bundles (120 of 127), larger with bundles (7) (§12.6) | **S** | <!-- EXT-12.1-010 --> |
| `AdminData` | Always 6 bytes (§12.7) | **S** (109) | <!-- EXT-12.1-011 --> |
| `AnnotateCtrl` | Variable, optional; in 1 of 147 files (§12.8) | **S** | <!-- EXT-12.1-012 --> |
| `LayoutReuse/ReuseSchematics.txt` | Variable, optional; in 5 of 120 designs (§12.9) | **S** | <!-- EXT-12.1-013 --> |
| `Symbols/$Types$` | Variable, 0 bytes when empty (85 files) (§12.11) | **S** | <!-- EXT-12.1-016 --> |
| `Graphics/$Types$` | Always 0 bytes | **S** (147) | <!-- EXT-12.1-017 --> |

EXT names the last two `Symbols/Types` and `Graphics/Types`; the stored names are `Symbols/$Types$` and `Graphics/$Types$`.

#### How universal-netlist finds streams

All of the following are code facts. **T**

- Page streams: `dsn-parser` matches `/^Views\/([^/]+)\/Pages\//` (one folder level) and `variant-store` matches `/^Views\/.*\/Pages\//`; both require a stream entry (type 2). INT states the second pattern for both. <!-- INT-2-021 -->
- Hierarchy streams: `/^Views\/[^/]+\/Hierarchy\/Hierarchy$/`, stream entries only. <!-- INT-2-022 -->
- Package streams: `/^Packages\//`, stream entries only, excluding names containing `_pDboPackage_Copy_` (41 such streams in 7 files: 36 in 4 v3 files, 5 in 3 Library 2.0 files, all in another encoding). <!-- INT-2-023 -->
- Library: only the root path exactly `Library`. A page named `Library` (`Views/<s>/Pages/Library`) is deliberately not taken.
- Cache: the path exactly `Cache`, stream entries only. <!-- INT-2-025 -->

### 12.2 The seven `* Directory` streams

`Views Directory`, `Symbols Directory`, `Packages Directory`, `Cells Directory`, `Parts Directory`, `ExportBlocks Directory` and `Graphics Directory` share one layout; each lists the objects of one kind in the database. **S** (all seven in 147 of 147 files) <!-- EXT-12.2-001 INT-10.5-014 --> Starting at offset 6 and reading entries to the end consumes every directory exactly, in all 18 fixtures and all 147 files. **S** <!-- INT-10.5-011 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `saved` | Time of the last save, Unix seconds | **S** (146 of 146) | <!-- EXT-12.2.1-001 --> |
| +0x04 | u16 | `count` | Number of entries | **S** (1,029 streams) | <!-- EXT-12.2.1-002 --> |
| +0x06 | entry[count] | `entries` | Back to back | **S** (1,029) | <!-- EXT-12.2.1-003 INT-10.5-003 --> |

The entries end exactly at the end of the stream. **S** (1,029) <!-- EXT-12.2.1-004 --> INT calls the first 6 bytes a header of unknown meaning; they are `saved` and `count`.

An entry is n + 25 bytes. **S** (7,770 entries) <!-- EXT-12.2.1-005 -->

| Entry offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u16 | `n` | Name length | **S** (7,770) | <!-- EXT-12.2.1-006 --> |
| +0x02 | u8[n] | `name` | Object name in logical form (`/` and `:` not escaped) | **S** | <!-- EXT-12.2.1-007 --> |
| +0x02+n | u8 | `nul` | Always `00` | **S** (7,770) | <!-- EXT-12.2.1-008 EXT-2.8-004 --> |
| +0x03+n | u16 | `kind` | Record type of the listed object | **S** (7,770) | <!-- EXT-12.2.1-009 EXT-16.9.3-001 --> |
| +0x05+n | u64 | `created` | FILETIME, local wall clock | **S** (7,770) | <!-- EXT-12.2.1-010 INT-10.5-007 --> |
| +0x0D+n | u64 | `modified` | FILETIME, local wall clock | **S** (7,770) | <!-- EXT-12.2.1-011 INT-10.5-008 --> |
| +0x15+n | u16 | `tail_a` | First of the version pair | **S** (7,770) | <!-- EXT-12.2.1-012 --> |
| +0x17+n | u16 | `tail_b` | Second of the version pair | **S** (7,770) | <!-- EXT-12.2.1-013 EXT-16.9.4-001 --> |

The first three fields form an `lstr` (u16 length, bytes, `00`). **S** (7,770) <!-- EXT-12.2.1-014 INT-10.5-004 --> In the Packages Directory INT reads `kind` as a `u8` `1F` marker followed by a `u8` `00`; the two bytes are `u16` 31. **S** (2,179 of 2,179 entries) <!-- INT-10.5-005 INT-10.5-006 --> The fixed tail after the name is 22 bytes, as in the Views Directory description of EXT. <!-- EXT-10.2-004 -->

The Packages Directory holds no offsets into the Cache: an entry is a name, a kind, two FILETIMEs and two `u16`, so it confirms which packages exist but cannot locate them. **S** <!-- INT-10.5-013 --> The BeagleBone-Black fixture, its corpus copy and its `_BEAGLEBOARD` variant each list 88 packages. **S** <!-- INT-10.5-012 -->

#### Kinds

| Directory | `kind` | Record | Entries | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| Views | 9 | Schematic folder | 179 | **S** | <!-- EXT-12.2.1-015 EXT-16.9.3-002 EXT-10.2-005 --> |
| Symbols | 35, 64, 75 | OffPageSymbol, TitleBlockSymbol, ErcSymbol | 86 | **S** | <!-- EXT-12.2.1-016 EXT-16.9.3-003 --> |
| Packages | 31 | Package | 2,179 | **S** | <!-- EXT-12.2.1-017 EXT-16.9.3-004 --> |
| Cells | 6 | PartCell | 2,657 | **S** | <!-- EXT-12.2.1-018 EXT-16.9.3-005 --> |
| Parts | 24 | LibraryPart | 2,669 | **S** | <!-- EXT-12.2.1-019 EXT-16.9.3-006 --> |
| ExportBlocks | none | Always 0 entries | 0 | **S** (147) | <!-- EXT-12.2.1-020 --> |
| Graphics | none | Always 0 entries | 0 | **S** (147) | <!-- EXT-12.2.1-021 EXT-16.9.3-007 EXT-12.2.3-006 --> |

EXT also lists Symbols kinds 33 (GlobalSymbol) and 76 (BookMarkSymbol); neither occurs.

#### Version pair (`tail_a`, `tail_b`)

| Directory | Pairs seen | Evidence | Ids |
| --- | --- | --- | --- |
| Views | (3, 2) on 157 v3 entries; (2, 0) on 5 entries in v3.2 files (`trs80_power.dsn`, two parallella designs, BeagleBoard-xM fixture and corpus copy) and on all 16 v2.0 entries; (1, 0) in the 1.1 file | **S** | (Refuted table) |
| Symbols | (3, 2) on 78 v3 entries; (2, 0) on 4 `ERC` entries in v3.2 files (BeagleBoard-xM twice, two parallella designs) and 4 in v2.0 files | **S** | (Refuted table) |
| Packages, Cells, Parts | Over 6,863 v3 Packages, Cells and Parts entries: (3, 2) 3,248; (2, 0) 1,444; (1300, 2) 645; (1360, 2) 570; (2080, 2) 403; (1720, 2) 225; (1450, 2) 145; (2260, 2) 57; (1660, 2) 54; (1240, 2) 39; (2140, 2) 33. The three EXT pairs together cover 1,105. A file uses 1 (80 files) or 2 (9) distinct pairs | **S** | <!-- EXT-12.2.1-023 EXT-16.9.4-003 --> |

In the v3 Packages Directory, `tail_a` is 3 on 988 of 1,993 entries and also takes 2, 1240, 1300, 1360, 1450, 1660, 1720, 2080, 2140 and 2260 **S** <!-- INT-10.5-009 -->; `tail_b` is 2 on 1,589 and 0 on 404 (the (2, 0) pairs). **S** <!-- INT-10.5-010 --> INT records only 3 and 2.

A cell, its part views and the package of the same name carry the same pair. **S** (2,441 of 2,441 views equal their cell; 1,789 of 1,789 cells equal the same-name package) <!-- EXT-12.2.1-025 --> The pair need not equal the Library version: v3 files carry (2, 0) and other pairs.

#### Times

- `saved` is a `u32` Unix time equal to `Library.modified` or later. **S** (146 of 146; 0 s later in 126, 1 to 5 s in 18, 6 to 60 s in 2) <!-- EXT-4.4-006 EXT-2.6.1-004 EXT-12.2.2-002 -->
- The seven headers of a file hold the same `saved` in 141 of 147 files; in 6 they differ by 1 second (for example `IGRID.DSN` 1164283263 and 1164283264, BeagleBoard-xM 1296824343 and 1296824342). **S** <!-- EXT-12.2.2-001 EXT-10.2-002 EXT-18.10.2-014 -->
- `saved` matches the compound-file modification time of the `Views/<s>` storages exactly in 128 cases, within 2 s in 32 and 6 s off in 2. **S**
- `created` and `modified` are FILETIME values, both non-zero, with `created <= modified`; for the Views Directory they are the schematic's creation and modification dates. **S** (7,770) <!-- EXT-10.2-006 EXT-12.2.2-003 EXT-2.6.2-002 -->
- They are local wall-clock times: for Views entries within 15 hours of `saved`, 129 differ from it by whole or quarter hours (−8 h to +9 h, including 5.5 h). The zone is not stored. **O** <!-- EXT-2.6.2-003 EXT-12.2.2-004 --> When the schematic was modified in the last save, `modified − saved` is the saving system's UTC offset.
- They keep full 100-ns precision, not rounded to two seconds. **S** (7,770) <!-- EXT-2.6.2-004 -->

#### Names and order

Names are unique within a directory. **S** (1,029 of 1,029) A name may contain `/` or `:`; the matching storage name holds 0x02 or 0x03 instead, and no entry name contains 0x02 or 0x03. **S** (56 names) <!-- EXT-12.2.2-006 -->

Entry order is not name order in most directories but is sorted in a minority: Cells 50 of 64 multi-entry directories unsorted (12 sorted case-sensitively, 2 case-insensitively), Packages 50 of 62 unsorted (10 and 2), Parts 53 of 64 unsorted (11 case-sensitively), Views sorted in 6 of 16 multi-folder v3 files, Symbols sorted in 9 of 16. **S** <!-- EXT-1.3.1-003 EXT-12.2.2-005 EXT-10.2-010 --> No rule is known (§Open questions).

#### Entries and container objects

- **Views.** Every entry, escaped, names a `Views/<s>` storage, and the root schematic is always listed. **S** (root listed in 119 of 119; every entry names a storage except `SNOW4` against the storage `snow4` in `meta_module_sch_rev1.dsn`) <!-- EXT-12.2.3-001 --> The root name of the Library design suffix equals one Views Directory entry and one `Views/<s>` storage name after escaping (119 of 119), and the Schematic name equals its folder in 161 of 162; that it also equals the Hierarchy root name is checked in the Hierarchy chapter. **S** <!-- EXT-18.10.2-001 -->
- **Symbols.** Every `Symbols/<n>` stream other than `$Types$` has an entry with the stream's record type, and the (name, kind) set equals the content of `Symbols/$Types$`. **S** (86 of 86 streams; set equality 147 of 147) <!-- EXT-12.2.3-002 -->
- **Packages.** The directory lists the package streams plus, in 10 files, packages without a stream; it does not list the 36 v3 `_pDboPackage_Copy_` streams (4 files, 34 of them in the two BeagleBoard-xM copies) or `Packages/STM32_Bluepill` in `PRIVATE_LIB.OLB`. **S** <!-- INT-10.5-002 --> A Symbols or Packages entry may have no stream. **S** (10 files list packages without streams)
- **Cells.** The directory lists the PartCell records stored inside the `Packages/<p>` streams; the `Cells` storage itself is always empty. **S** (storage empty in 147; coverage 129 of 130) <!-- EXT-12.2.3-004 -->
- **Parts.** The directory lists the views of those cells, named `<cell>.Normal` or `<cell>.Convert` with `<cell>` a Cells Directory name; the `Parts` storage is always empty. **S** (130 of 130 v3; storage empty in 147) <!-- EXT-12.2.3-005 -->
- Cells Directory lists every part cell in the `Packages/<p>` streams and Parts Directory every view of them; when every listed package has its stream, the lists hold nothing else. **S** (119 of 120 v3 files; `PRIVATE_LIB.OLB` lists 7 cells while its streams hold 8) <!-- EXT-12.2.3-007 -->
- A file that lists packages without a stream also lists further cells and views that appear in no stream; such a cell's name often equals a package name. **S** (10 of 10 such files; 83 of 107 extra cells share a package name) <!-- EXT-12.2.3-008 -->
- The Parts Directory count is never smaller than the Cells Directory count. **S** (130 of 130 v3) <!-- EXT-12.2.3-010 -->

All 18 fixtures carry all seven directory streams, and no parser code reads any of them. **S** <!-- INT-10.5-015 INT-13.2-008 -->

### 12.3 Schematic folders

A schematic folder is a storage `Views/<s>`. The Views Directory lists the folders that belong to the design. **S** (147 of 147 files; 161 of 162 folders match exactly) <!-- EXT-10.1-001 --> A folder can exist without an entry: one 2.0 design has an unlisted folder with its own Hierarchy, and one v3 design (`meta_module_sch_rev1.dsn`) has a folder unlisted only by case (`SNOW4` against `snow4`). **S** <!-- EXT-1.3.2-001 --> Whether an unlisted folder is never instantiated is not checked. The entry name is the logical folder name, with the 0x02/0x03 escapes undone. **S** (161 of 162; the `SNOW4` case is the exception) <!-- EXT-10.2-009 --> The Views Directory ends exactly after its last entry. **S** (147) <!-- EXT-10.2-008 --> Its `count` is the usual `u16` at +0x04. **S** <!-- EXT-10.2-003 -->

| Stream | Per folder | Content | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `Views/<s>/Schematic` | 1 | Schematic header (below) | **S** (162 v3 streams read to the exact end) | <!-- EXT-10.1-002 --> |
| `Views/<s>/Pages/<p>` | 1 per page | One page record | **S** | (§12.1) |
| `Views/<s>/Hierarchy/Hierarchy` | 0 or 1 | Occurrence tree | **S** (every file) | (§12.1) |

The Schematic header is exactly the depth-2 stream `Views/<s>/Schematic`. **S** (179 streams) <!-- EXT-10.1-005 --> Folder and page stream names are logical names with `/` stored as 0x02 and `:` as 0x03; the mapping holds for the 56 package names that contain those characters, and no folder or page name in our data contains them. **S** <!-- EXT-10.1-008 -->

| Folders | Hierarchy streams | Views Directory entries | Meaning | Designs | Ids |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 | Flat design | 89 v3, 11 v2.0 | <!-- EXT-10.1-012 --> |
| 2 | 1 | 2 | Root plus one child schematic used by hierarchical blocks | 3 v3, 1 v2.0 (**O**) | <!-- EXT-10.1-013 --> |
| 2 | 2 | 1 | Root plus an unlisted folder with its own Hierarchy | 1 (Library 2.0) (**O**) | <!-- EXT-10.1-014 --> |

Other arrangements with more folders also occur.

#### Schematic header

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | 9 bytes | full prefix | Type 9; its region ends at the end of the preamble | **S** (162) | <!-- EXT-10.3-001 --> |
| +0x09 | 3 + 8n bytes | short prefix | Type 9, `i16 n`, n × (u32 name index, u32 value index) into the string table; n = 0 in all 162 | **S** | <!-- EXT-10.3-002 --> |
| follows | 8 + m bytes | preamble | `FF E4 5C 39`, `u32 m`, m bytes; m = 0 | **S** (162) | <!-- EXT-10.3-003 --> |
| follows | lstr | `name` | Schematic name, equal to the folder name after unescaping | **S** (161 of 162; `SNOW4` against `snow4`) | <!-- EXT-10.3-004 --> |
| follows | u32 | `max_id` | High-water mark of the object-ID allocator | **S** (162) | <!-- EXT-10.3-005 --> |
| follows | u16 | `page_count` | Number of pages | **S** (162) | <!-- EXT-10.3-006 --> |
| follows | lstr[page_count] | `pages` | Page names in page order | **S** (162) | <!-- EXT-10.3-007 --> |
| follows | u16 | `registry_count` | Number of registry IDs | **S** (162) | <!-- EXT-10.3-008 --> |
| follows | u32[registry_count] | `id_registry` | Object IDs | **S** (162) | <!-- EXT-10.3-009 --> |
| follows | u16 | `tail_count` | Number of tail entries | **S** (162) | <!-- EXT-10.3-010 --> |
| follows | (u8, u32)[tail_count] | `tail` | `key`, `value` | **S** (917 entries) | <!-- EXT-10.3-011 --> |
| follows | 4 bytes | reserved | Always 0; ends exactly at the stream end | **S** (162) | <!-- EXT-10.3-012 --> |

- `page_count` equals the number of `Views/<s>/Pages/*` streams; the page names are unique and each names its page stream after unescaping. **S** (162) <!-- EXT-10.3-015 -->
- The page list is the schematic's own order: of 46 multi-page schematics, 37 are neither sorted nor in stream order, 5 are sorted and 4 are in stream order. **S** <!-- EXT-10.3-016 -->
- The registry holds no 0 and no duplicates. **S** (162) It is ascending in 75 of 162. <!-- EXT-10.3-022 -->
- The largest registry ID is at most `max_id` in 160 of 162 schematics **O** <!-- EXT-10.3-017 -->; the other 2 hold registry IDs above `max_id`, from a second, much higher range. **O** <!-- EXT-10.3-018 --> Page object IDs were not compared here.
- Tail keys: uppercase ASCII letters (894), lowercase letters (10), byte 0 (9) and the digits `1` (2), `5` and `0`; a key can repeat within one tail. `*`, `?` and space, which EXT lists, do not occur. **S** (917) <!-- EXT-10.3-025 -->
- Tail values are ≥ 1; 1 to 11,251 seen. **S** (917) <!-- EXT-10.3-026 -->

### 12.4 `DsnStream`

`DsnStream` holds exactly one DesignProperties record (type 4): one full prefix, a short prefix and a preamble, and nothing after it. **S** (102 streams) <!-- EXT-12.3-001 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u8 | `type` | Always 4 | **S** (102) | <!-- EXT-12.3-002 --> |
| +0x01 | u32 | `length` | Stream length − 9 | **S** (102) | <!-- EXT-12.3-003 --> |
| +0x05 | u32 | `zero` | Always 0 | **S** (102) | <!-- EXT-12.3-004 --> |
| +0x09 | u8 | `short_type` | Always 4 | **S** (102) | <!-- EXT-12.3-005 --> |
| +0x0A | i16 | `n` | Property pairs: 0, 1 (99 streams) or 2; EXT's 3 never occurs | **S** | <!-- EXT-12.3-006 --> |
| +0x0C | 8n bytes | `properties` | (u32 name, u32 value) string-table indices | **S** (103 pairs) | <!-- EXT-12.3-007 --> |
| follows | 4 bytes | `magic` | `FF E4 5C 39` | **S** (102) | <!-- EXT-12.3-008 --> |
| follows | u32 | `ext_len` | 0 (93) or the size of the extension records (9) | **S** | <!-- EXT-12.3-009 --> |
| follows | ext_len bytes | `extension` | Extension records; the stream ends here | **S** (102) | <!-- EXT-12.3-010 --> |

**Properties.** Each pair resolves through the string table to a design-level property, in stored order, and every index lies inside the table. **S** (103 of 103) <!-- EXT-12.3.1-001 EXT-12.3.1-002 --> `Library guid` is internal: its value is a braced GUID `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` and it occurs at most once. **S** (at most once in 102; braced in 101 of 101) <!-- EXT-12.3.1-003 --> Every other pair has a non-empty name and value (both are `Time Format Index`). **S** (2 of 2) <!-- EXT-12.3.1-004 -->

**Extension.** The extension is a sequence of records `{u32 length, u32 kind, u32 version, payload}`. **S** (9 extensions read to the exact end) <!-- EXT-12.3.2-001 EXT-16.9.5-001 --> Two forms occur:

| Form | Streams | Evidence | Ids |
| --- | --- | --- | --- |
| None (`ext_len` = 0): no tool information | 93 (91 at 3.2, 2 at 3.3) | **S** | <!-- EXT-12.3.2-003 EXT-16.9.5-003 --> |
| One kind-7 version-6 record | 9 (4 at 3.2, 5 at 3.3) | **S** | <!-- EXT-12.3.2-002 --> |

The empty form is the common one in our data; EXT calls kind 7 the usual form. **S** <!-- EXT-16.9.5-002 -->

The kind-7 payload is a single-line JSON object followed by three `00` bytes, with exactly four keys in this order and every value a JSON string. **S** (9 of 9) <!-- EXT-12.3.2-006 EXT-16.9.5-006 -->

| Key | Values seen | Evidence | Ids |
| --- | --- | --- | --- |
| `InstallMode` | Always `"0"` | **S** (9) | <!-- EXT-12.3.2-007 --> |
| `License` | Licence names joined with `+` (an empty value never occurs): `OrCAD_Capture_CIS_option+Capture` (4), `OrCAD_PCB_Designer_PSpice` (3), `OrCAD_X_Professional_Plus` (1), `CaptureCIS` (1) | **S** (9) | <!-- EXT-12.3.2-008 --> |
| `InstalledVersionBase` | `<major>.<minor>-<year>`; one value, `17.4-2019` | **S** (9) | <!-- EXT-12.3.2-009 EXT-12.3.2-011 --> |
| `InstalledVersionISR` | Letters then digits: `S029` (4), `S017` (3), `S003`, `S032` | **S** (9) | <!-- EXT-12.3.2-010 --> |

### 12.5 `HSObjects`

`HSObjects` is always 16 zero bytes. **S** (105 v3 and 4 v2.0 files) <!-- EXT-12.4-009 EXT-16.12-001 --> EXT describes it as two counted tables followed by two terminal words; with both tables empty the layout is:

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `table1_count` | Named rows; always 0 | **S** (109) | <!-- EXT-12.4-002 --> |
| +0x04 | u32 | `table2_count` | Detail rows; always 0 | **S** (109) | <!-- EXT-12.4-004 --> |
| +0x08 | u32[2] | `terminal` | Always 0, 0 | **S** (109) | <!-- EXT-12.4-006 --> |

The stream ends after `terminal`. **S** (109) <!-- EXT-12.4-007 --> Non-empty tables never occur, so only this empty form is verified. **S** <!-- EXT-12.4-001 --> The row layouts are under §Unverified.

### 12.6 `NetBundleMapData`

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u16 | `version` | Always 2 | **S** (127) | <!-- EXT-12.5-001 EXT-16.9.6-001 --> |
| +0x02 | u16 | `bundle_count` | Number of bundles | **S** (127) | <!-- EXT-12.5-002 --> |
| +0x04 | bundle[bundle_count] | `bundles` | Back to back; the stream ends after the last | **S** (127; 8 bundles in 7 files) | <!-- EXT-12.5-003 --> |

| Bundle part | Type | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `name` | lstr | Bundle name | **S** (8) | <!-- EXT-12.5-004 --> |
| `group` | 35 bytes | One NetGroup record (type 103) | **S** (8 of 8) | <!-- EXT-12.5-005 --> |
| `member_count` | u16 | Number of members | **S** (8) | <!-- EXT-12.5-006 --> |
| `members` | (lstr, u16)[member_count] | Member name, flag: 1 (78) or 2 (4) | **S** (82 members) | <!-- EXT-12.5-007 EXT-16.9.6-002 --> |

| NetGroup offset | Size | Content | Evidence | Ids |
| --- | --- | --- | --- | --- |
| +0x00 | 9 | Full prefix, type 103, length 26; region ends at the record end (+0x23) | **S** (8 of 8) | <!-- EXT-12.5-009 --> |
| +0x09 | 9 | Full prefix, type 103, length 11; region ends at the end of the preamble (+0x1D) | **S** (8 of 8) | <!-- EXT-12.5-010 --> |
| +0x12 | 3 | Short prefix, type 103, property count 0 (`67 00 00`) | **S** (8 of 8) | <!-- EXT-12.5-011 --> |
| +0x15 | 8 | Preamble `FF E4 5C 39 00 00 00 00` | **S** (8 of 8) | <!-- EXT-12.5-012 --> |
| +0x1D | 4 | u32, always 0 | **S** (8 of 8) | <!-- EXT-12.5-013 --> |
| +0x21 | 2 | u16, always 0 | **S** (8 of 8) | <!-- EXT-12.5-015 EXT-16.9.6-003 --> |

A design without bundles stores the 4 bytes `02 00 00 00`. **S** (120 of 120) <!-- EXT-12.5-017 --> Bundles occur only in Library 3.3 files (7).

### 12.7 `AdminData`

`AdminData` is always 6 bytes. **S** (109) <!-- EXT-12.6-004 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u8 | `flag` | 0 (41 files) or 1 (68: 64 of 105 v3 files and all 4 v2.0 files that have the stream) | **S** (109) | <!-- EXT-12.6-001 EXT-16.9.7-001 --> |
| +0x01 | u8[5] | `reserved` | Always 0 | **S** (109) | <!-- EXT-12.6-003 --> |

### 12.8 `AnnotateCtrl`

`AnnotateCtrl` is optional: one file has it (`opencellular-sdr`). **S** (1 of 147) <!-- EXT-12.7-001 --> All facts below come from that one stream. **O**

| Offset | Type | Name | Meaning | Ids |
| --- | --- | --- | --- | --- |
| +0x00 | u32 | `count` | Number of entries; 7 | <!-- EXT-12.7-002 --> |
| +0x04 | entry[count] | `entries` | Back to back; the stream ends after the last | <!-- EXT-12.7-003 --> |

| Entry part | Type | Meaning | Ids |
| --- | --- | --- | --- |
| `key` | l32str (u32 length, bytes, `00`) | Printable ASCII with one `:` in all 7 keys (for example `B210:B210_1`); EXT's two-colon form never occurs | <!-- EXT-12.7-004 --> |
| `first` | u32 | First reference number of the range | <!-- EXT-12.7-005 --> |
| `last` | u32 | Last reference number; `first <= last` (7 of 7) | <!-- EXT-12.7-006 --> |

- The ranges ascend: each `first` exceeds the previous `last` (6 of 6 steps). <!-- EXT-12.7-007 -->
- Each `first` is a multiple of 100 (7 of 7: 100, 200, ...); EXT's "one more than a multiple of 100" never occurs. <!-- EXT-12.7-008 -->
- No key names a schematic folder before its first `:` or a page after its last `:` (0 of 7 each). <!-- EXT-12.7-009 -->
- The entry count differs from the design's page count. <!-- EXT-12.7-011 -->

### 12.9 `LayoutReuse/ReuseSchematics.txt`

The stream is optional and is 7-bit ASCII with no NUL and no CR. **O** (5 of 120 designs) <!-- EXT-12.8-001 --> Four of the five are empty (0 bytes). The fifth, `buddy_sch_rev1.dsn`, holds two LF-terminated lines `BUDDY_SCH.DSN : TILE_FMC` and `BUDDY_SCH.DSN : TILE_DUT`. **S** Its `<file>` is a design file name other than the containing file's. **O** (1 file) <!-- EXT-12.8-003 --> Both names after the colon are schematic folders of the same design.

### 12.10 `CCSStorage`

No file in our data has a `CCSStorage`. EXT's description is under §Unverified.

### 12.11 `$Types$` streams

`Symbols/$Types$` is always present and has no leading count. **S** (147) <!-- EXT-12.10.1-001 --> It is a run of TypeEntry records to the end of the stream. **S** (147) <!-- EXT-12.10.1-002 -->

| TypeEntry part | Type | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `name` | lstr | Symbol name | **S** (147) | <!-- EXT-12.10.1-004 --> |
| `kind` | u16 | Record type: 35, 64 or 75 seen; Table 12-1 kinds 33 and 76 never occur | **S** | <!-- EXT-12.10.1-005 --> |

- A TypeEntry is n + 5 bytes. **S** (86 v3 and 4 v2.0 entries) <!-- EXT-12.10.1-003 -->
- The (name, kind) set equals the Symbols Directory entries. **S** (147) <!-- EXT-12.10.1-006 -->
- Every `Symbols/<name>` stream starts with the byte `kind`. **S** (86 of 86) <!-- EXT-12.10.1-007 -->
- The stream is 0 bytes exactly when the Symbols Directory is empty. **S** (147) <!-- EXT-12.10.1-008 -->

`Graphics/$Types$` is the only stream in `Graphics` and is always 0 bytes. **S** (147) <!-- EXT-12.10.2-001 -->

A `Symbols/<n>` stream is one record of type 35, 64 or 75; types 33, 34 and 76, which EXT lists, do not occur. **S** (82 streams) <!-- EXT-16.9.3-008 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| Every `Symbols/<n>` and `Packages/<n>` stream has a directory entry | EXT §1.2.4, §12.2.3 | 36 `_pDboPackage_Copy_` streams in 4 v3 files (17 in each of the two `BeagleBoard-xM_ORCAD.DSN` copies, fixture and corpus; 1 each in `parallella_schematic.dsn` and `parallella_e16_z7020_schematic.dsn`; 19 in 3 files after deduplication by content) and `Packages/STM32_Bluepill` in `PRIVATE_LIB.OLB` have no Packages Directory entry. The other half holds: an entry may lack a stream (10 files) | **S** | <!-- EXT-1.2.4-017 EXT-12.2.3-003 --> |
| Views and Symbols entries always carry the pair (3, 2), in 3.2 and 3.3 files alike | EXT §10.2, §12.2.1, §16.9.4, §18.10.2 | (2, 0) on 5 Views and 4 Symbols entries in v3.2 files (for example BeagleBoard-xM Views `Schematic`, Symbols `ERC`); (2, 0) in all 2.0 files, (1, 0) in the 1.1 file | **S** | <!-- EXT-10.2-007 EXT-12.2.1-022 EXT-16.9.4-002 EXT-18.10.2-015 --> |
| Views and Symbols entries always carry (3, 2), which need not equal the Library version | EXT §4.3 | The "need not equal" part holds; the "always (3, 2)" part fails as above (`trs80_power.dsn` `SCHEMATIC1`, `a3640.dsn`) | **S** | <!-- EXT-4.3-004 --> |
| Packages, Cells and Parts Directories never list a definition held only in Cache | EXT §18.10.2 | `BEAGLEBONEBLK_C3` lists 20 packages present only in Cache; the Symbols Directory does equal `Symbols/$Types$` (147 of 147) | **S** | <!-- EXT-18.10.2-016 --> |
| ReuseSchematics.txt is one line `<file>.DSN : <name>` and an LF | EXT §12.8 | 4 of 5 streams are empty; `buddy_sch_rev1.dsn` holds two lines | **S** | <!-- EXT-12.8-002 --> |
| ReuseSchematics `<name>` is not a folder of the containing design | EXT §12.8 | `buddy_sch_rev1.dsn` names `TILE_FMC` and `TILE_DUT`, both its own `Views/<s>` folders | **S** | <!-- EXT-12.8-004 --> |
| The Library stream is the path `Library` or any path ending `/Library` | INT §2 | The root `Library` alone; universal-netlist takes only the exact path, and a page named `Library` is not the Library stream | **T** | <!-- INT-2-024 --> |

### Unverified

- *unverified*: listed values that never occur in our data: DsnStream property count 3 (EXT §12.3), an empty `License` (EXT §12.3.2), an AnnotateCtrl key with two `:` and a `first` one more than a multiple of 100 (EXT §12.7, one file only), and `Symbols/$Types$` kinds 33 and 76 (EXT §12.10.1). <!-- EXT-12.3-006 EXT-12.3.2-008 EXT-12.7-004 EXT-12.7-008 EXT-12.10.1-005 -->
- *unverified*: a page named `Schematic` is stored as `Views/<s>/Pages/Schematic` and is a page record (first byte 10), not a header (EXT §10.1). No page in our data is named `Schematic`. <!-- EXT-10.1-006 -->
- *unverified*: when the Schematic header has properties, there are three pairs naming three distinct properties with non-empty values, the same three names in every file (EXT §10.3). No Schematic header has properties. <!-- EXT-10.3-013 -->
- *unverified*: `id_registry` holds the ID of every placed part, wire, Global, off-page connector, port, title block, ERC object and hierarchical block on the folder's pages and every non-sentinel pin connection field (wire IDs), nearly every graphic ID, never SchematicNet IDs; it also holds many IDs of no object on the pages, by an unknown rule (EXT §10.3). Needs page object IDs (page chapter). <!-- EXT-10.3-023 EXT-10.3-024 -->
- *unverified*: a tail `key` is the initial of a reference-designator prefix and `value` the next free annotation number for it, often one more than the largest reference number with that initial (EXT §10.3, theory). Needs reference-designator data. <!-- EXT-10.3-027 -->
- *unverified*: `CCSStorage/___IndexInfoForMiscStorage` is an optional one-row index: `u32 count` (always 1), `l32bytes name` (the sibling data stream), `l32bytes descr` (a JSON-like text with `FileName`, `Descr` and `CreationTime` keys, LF line ends, tab-and-space continuation lines, two spaces between date and time). `CCSStorage/<n>` is printable Base64 with LF breaks at most 72 characters per line, decoding to a 2,097,152-byte SQLite 3 database with page size 8192 (EXT §12.9). No file has a `CCSStorage`. <!-- EXT-12.1-014 EXT-12.1-015 -->
- *unverified*: a rare DsnStream extension form is a kind-0 version-2 record of 19 bytes with the 7-byte payload `05 00 00 00 00 00 00`, followed by the kind-7 record (EXT §12.3.2, §16.9.5). Never seen in 102 DsnStreams. <!-- EXT-12.3.2-004 EXT-12.3.2-013 EXT-16.9.5-004 -->
- *unverified*: HSObjects table-1 (named) rows are 2 × `u32`, `lstr` name, `u32 reference_count` (1, one reference), `u32` reference, 2 × `lstr`, then the suffix `00 68 00 00 00`, at least 30 bytes; table-2 (detail) rows are 10 × `u32`, 5 × `lstr`, then `00 00 00 68 00 00 00`, at least 62 bytes, with `w1` and `w2` both −100 for a row without location and `w8` = 2; strings are `lstr` with a `00` terminator (EXT §12.4, §16.12). Both tables are always empty. <!-- EXT-12.4-003 EXT-12.4-005 EXT-12.4-008 EXT-16.12-002 EXT-16.12-003 EXT-16.12-004 EXT-16.12-005 -->
- *unverified*: the presence of `AnnotateCtrl` means annotation control data is present (EXT §17.4). One file has the stream; its meaning needs Capture. <!-- EXT-17.4-005 -->
- *unverified*: the presence of `LayoutReuse/ReuseSchematics.txt` means a layout-reuse link to another design (EXT §17.4). 4 of the 5 streams are empty, so the content does not support it. <!-- EXT-17.4-006 -->
- *unverified*: page streams hold components, wires, nets and aliases and are fully parsed (INT §2). A page-chapter claim. <!-- INT-2-009 -->
- *unverified*: the Hierarchy stream holds the occurrence tree with flat net names, one scope per block placement, fully parsed (INT §2). A hierarchy-chapter claim. <!-- INT-2-010 -->

### Open questions

- The order of directory entries. Data: sometimes sorted case-sensitively, usually not (§12.2). <!-- EXT-1.3.1-004 EXT-1.oq-002 -->
- The meaning of the Packages, Cells and Parts version pairs. Data: 11 distinct pairs; (2, 0) dominates in 2.0 files and (3, 2) in many 3.2 files; a cell, its views and its package share one pair, which fits EXT's theory of a version stamp of the listed object. <!-- EXT-12.2.1-024 EXT-12.2.1-026 EXT-12.oq-001 EXT-16.9.4-004 EXT-16.9.4-005 -->
- What the extra Cells and Parts entries describe in files that list packages without a stream. Data: 83 of 107 share a package name. <!-- EXT-12.oq-002 -->
- The meaning of the AdminData `flag`, and whether it is a `u8` or the low byte of a wider integer. Data: 0 (41) or 1 (68: 64 v3, 4 v2.0); bytes 1 to 5 are always 0, so the width cannot be told. <!-- EXT-12.6-002 EXT-12.6-005 EXT-12.oq-003 EXT-16.9.7-002 EXT-16.9.7-003 EXT-16.oq-007 -->
- What AnnotateCtrl entries whose key names no folder or page are, and whether each entry assigns a reference-number range to one page (`<schematic>:<page>`) for page-based annotation. Data: the only stream has 7 keys naming no folder or page. <!-- EXT-12.7-010 EXT-12.oq-004 -->
- What the NetGroup body fields and the member flag mean, and whether bundles require Library 3.3. Data: the NetGroup fields are 0; the flag is 1 or 2; bundles occur only in 3.3 files (7). <!-- EXT-12.5-008 EXT-12.5-014 EXT-12.5-016 EXT-12.oq-005 -->
- Whether the ReuseSchematics line names the source design and schematic of reused layout. No data beyond one file. <!-- EXT-12.8-005 -->
- The meaning of the kind-7 payload: EXT's theory is installation and licence information of the saving tool, which the licence names and ISR values fit; whether `InstalledVersionBase` identifies the saving release is unknown (one value, `17.4-2019`, in all 9). <!-- EXT-12.3.2-005 EXT-12.3.2-012 -->
- The meaning of the kind-0 DsnStream record. Never seen. <!-- EXT-12.3.2-014 EXT-16.9.5-005 -->
- Whether `Graphics/$Types$` is the graphics counterpart of `Symbols/$Types$`, empty because the Graphics Directory is empty. Data: the Graphics Directory is empty in 147 of 147, consistent. <!-- EXT-12.10.2-002 -->
- The meaning of the three Schematic-header properties. No file has them. <!-- EXT-10.3-014 EXT-10.oq-003 -->
- The full membership rule of the Schematic `id_registry`. <!-- EXT-10.oq-001 -->
- The meaning of the Schematic tail entries beyond their link to reference initials. <!-- EXT-10.oq-002 -->

### Parser divergences

| What the parser does | What the files show | Impact | Ids |
| --- | --- | --- | --- |
| Takes the Library only at the exact root path `Library` (`src/parsers/cadence/dsn/dsn-parser.ts:37`), where INT says any path ending `/Library` | The root stream is the Library; a page may be named `Library` | None: the parser is right and INT's wording is wrong | (Refuted table) |

Parser coverage: universal-netlist locates the page, Hierarchy, `Packages/<p>`, Cache and Library streams by path and reads the CIS variant streams; it reads none of the seven `* Directory` streams, the `Schematic` headers, `DsnStream`, `HSObjects`, `NetBundleMapData`, `BundleMapData`, `AdminData`, `AnnotateCtrl`, `LayoutReuse/ReuseSchematics.txt` or the `$Types$` streams.

<!-- meta: EXT-0.4-004 EXT-1.3.2-003 EXT-10.2-001 EXT-10.2-011 EXT-10.3-021 EXT-12-001 EXT-12.2.1-027 EXT-12.3-011 EXT-12.3.1-005 EXT-2.6.2-005 INT-10.5-001 -->

---

## 13. Constraint storage

Constraint storage is the electrical-constraint data that EXT describes in two places: a `Views/<schematic>/Constraint/` storage inside a schematic folder, and a root `CCSStorage/` storage. **No real file in our data carries either: 0 of 120 OLE `.DSN` files** (the 71 further `.dsn` files in the corpus are Proteus or Specctra text, not OLE). Nearly all of this chapter is therefore the Unverified section below, kept in full so the layout is not lost.

What our data does establish:

- The constraint storage is optional: it is absent from 120 of 120 OLE files. **O** (120 files) <!-- EXT-13.1-002 -->
- `CCSStorage/` is optional: it is absent from 120 of 120 OLE files. **O** (120 files) <!-- EXT-13.1-007 -->

The `DCF` ZIP container and its member list, the Library-version rule, and the links from constraint names to Hierarchy nets and placed instances are covered by the container, version, hierarchy and connectivity chapters.

### Unverified

Every item in this section is *unverified*: no real file has a `Views/<s>/Constraint` storage or a `CCSStorage` storage, so nothing here could be checked. The content is EXT's.

#### Overview

- *unverified*: A schematic folder may hold a storage `Views/<schematic>/Constraint/` with an index stream, a constraint archive stream `DCF`, and a metadata stream `Metadata_v3`. <!-- EXT-13-001 -->
- *unverified*: Each of `Views/<s>/Constraint/DCF` (design-constraint data), `Views/<s>/Constraint/Metadata_v3` (constraint metadata) and `Views/<s>/Constraint/___IndexInfoForMiscStorage` (index of the constraint streams) occurs at most once per folder. <!-- EXT-1.2.3-009 EXT-1.2.3-010 EXT-1.2.3-011 -->
- *unverified*: The root storage `CCSStorage/` holds an index stream and one data stream. <!-- EXT-13-002 -->
- *unverified*: `DCF` is an uncompressed ZIP archive of two short text members and several single-line XML documents. <!-- EXT-13-003 -->
- *unverified*: The XML objects in `DCF` (nets, pins, Xnets, differential pairs, net classes, gates) are named by hierarchical paths that resolve to Hierarchy nets and to placed instances on pages. <!-- EXT-13-004 -->
- *unverified*: A `Views/<schematic>/Constraint/...` storage means the design carries an embedded constraint store; `CCSStorage/...` accompanies a constraint store and is opaque. Neither marks a version family. <!-- EXT-17.4-003 EXT-17.4-004 -->

#### Storage tree and presence

```
Views/<schematic>/Constraint/
    ___IndexInfoForMiscStorage     index (below)
    DCF                            constraint archive
    Metadata_v3                    metadata (below)
CCSStorage/
    ___IndexInfoForMiscStorage     index (below)
    <name>                         data stream (below)
```
<!-- EXT-13.1-001 -->

- *unverified*: A file with several schematic folders can have one constraint storage in each, and at most one per folder. <!-- EXT-13.1-002 -->
- *unverified*: The index `___IndexInfoForMiscStorage` is present in every constraint storage. <!-- EXT-13.1-003 -->
- *unverified*: `DCF` and `Metadata_v3` are both present or both absent; a constraint storage may hold the index alone. <!-- EXT-13.1-004 -->
- *unverified*: Nothing else (no other stream, no sub-storage) occurs below `Constraint/`. <!-- EXT-13.1-005 -->
- *unverified*: `CCSStorage/` is known only in files that also hold a constraint storage with a `DCF`. <!-- EXT-13.1-007 -->
- *unverified*: A reader that does not interpret these streams should copy them unchanged when it rewrites a file. <!-- EXT-13.1-009 -->

#### `Views/<schematic>/Constraint/___IndexInfoForMiscStorage`

*unverified*: A two-row table naming the two sibling streams. Each row is a u32-counted name followed by a u32-counted description, with no terminators. The stream is always exactly 204 bytes. <!-- EXT-13.2-001 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `row_count` | Always 2 | *unverified* | <!-- EXT-13.2-002 --> |
| +0x04 | u32 | `name0_len` | Always 3 | *unverified* | <!-- EXT-13.2-003 --> |
| +0x08 | ASCII[3] | `name0` | `DCF` | *unverified* | <!-- EXT-13.2-004 --> |
| +0x0B | u32 | `desc0_len` | Always 79 | *unverified* | <!-- EXT-13.2-005 --> |
| +0x0F | ASCII[79] | `desc0` | `{ "FileName": DCF,\n\t "Descr": "DESIGN CONSTRAINT DATA",\n\t "CreationTime": "" \n}` | *unverified* | <!-- EXT-13.2-006 --> |
| +0x5E | u32 | `name1_len` | Always 11 | *unverified* | <!-- EXT-13.2-007 --> |
| +0x62 | ASCII[11] | `name1` | `METADATA_V3` | *unverified* | <!-- EXT-13.2-008 --> |
| +0x6D | u32 | `desc1_len` | Always 91 | *unverified* | <!-- EXT-13.2-009 --> |
| +0x71 | ASCII[91] | `desc1` | `{ "FileName": Metadata_v3,\n\t "Descr": "DESIGN CONSTRAINT METADATA",\n\t "CreationTime": "" \n}` | *unverified* | <!-- EXT-13.2-010 --> |
| +0xCC | | end | End of stream (204 bytes) | *unverified* | <!-- EXT-13.2-011 --> |

- *unverified*: In the descriptions, `\n` is the byte 0x0A and `\t` is 0x09. <!-- EXT-13.2-012 -->
- *unverified*: The descriptions resemble JSON but are not valid JSON, because the `FileName` value is unquoted. <!-- EXT-13.2-013 -->
- *unverified*: The row names are `DCF` and `METADATA_V3`, the two sibling streams; `name1` is upper case while the stream it names is `Metadata_v3`. <!-- EXT-13.2-014 EXT-16.10.6-001 -->
- *unverified*: The index lists both rows even when the storage holds no `DCF` and no `Metadata_v3`. <!-- EXT-13.2-015 -->

#### `DCF` archive identity

- *unverified*: The member `FileType.txt` is always `Design`. <!-- EXT-16.10.1-001 -->
- *unverified*: `FormatVersion.txt` known values are `17.220`, `17.440`, `23.100` and `25.100`. All four share the container and the document grammar; only the set of optional members differs. <!-- EXT-16.10.1-002 EXT-16.10.1-003 -->
- *unverified*: Every member is stored with ZIP method 0 (Stored). <!-- EXT-16.10.6-008 -->

#### Serialisation of every XML member

| Property | Rule | Evidence | Ids |
| --- | --- | --- | --- |
| Declaration | Exactly `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`, immediately followed by `<root` | *unverified* | <!-- EXT-13.4.1-001 --> |
| Whitespace | None: one line, no LF, CR or tab anywhere, no trailing newline | *unverified* | <!-- EXT-13.4.1-002 --> |
| Quoting | Attribute values in double quotes | *unverified* | <!-- EXT-13.4.1-003 --> |
| Attribute order | Rows `o`: `N` before `A`. Member references `m`: `K` before `N` | *unverified* | <!-- EXT-13.4.1-004 --> |
| Characters | ASCII only; no entity or character reference, CDATA, comment, DTD or further processing instruction; the byte `&` never occurs | *unverified* | <!-- EXT-13.4.1-005 --> |
| Empty elements | Self-closing with no space before `/>`, always, including a row with no children | *unverified* | <!-- EXT-13.4.1-006 --> |
| Root | Every member's document element is `root`; only `Header.xml` gives it attributes | *unverified* | <!-- EXT-13.4.1-007 --> |
| Well-formedness | Every member is well-formed XML 1.0 | *unverified* | <!-- EXT-13.4.1-008 --> |

- *unverified* (reader guidance): also accept whitespace between elements and attributes and the five predefined entities, since other producers may emit them. <!-- EXT-13.4.1-009 -->

#### `Header.xml`

*unverified*: Shown indented here; stored with no whitespace. <!-- EXT-13.4.2-001 -->

```
<root Name="<design>" Key="logical">
  <Contents>33330</Contents>
  <revisionNumber logical="<n>" physical="0" other="0"/>
  <precision units="<u>" numberOfDecimalPlaces="<d>"/>
</root>
```

| Item | Rule | Evidence | Ids |
| --- | --- | --- | --- |
| `root/@Name` | Design name; equals `Metadata_v3` row 3 and the design token of object names | *unverified* | <!-- EXT-13.4.2-002 --> |
| `root/@Key` | Always `logical`; meaning unknown | *unverified* | <!-- EXT-13.4.2-003 EXT-16.10.6-002 --> |
| `Contents` text | Always `33330`; meaning unknown | *unverified* | <!-- EXT-13.4.2-004 EXT-16.10.6-003 --> |
| `revisionNumber/@logical` | Decimal; known values 39 to 8423; meaning unknown | *unverified* | <!-- EXT-13.4.2-005 --> |
| `revisionNumber/@physical`, `@other` | Always `0` | *unverified* | <!-- EXT-13.4.2-007 --> |
| `precision/@units` | Unit enumeration below | *unverified* | <!-- EXT-13.4.2-008 EXT-16.10.2-001 --> |
| `precision/@numberOfDecimalPlaces` | Decimal; known 2 with `in`, 2 or 3 with `mm`, 4 with `cm` | *unverified* | <!-- EXT-13.4.2-009 --> |

| `precision/@units` | Meaning | Known decimal places | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `in` | inches | 2 | *unverified* | <!-- EXT-13.4.2-010 EXT-16.10.2-002 --> |
| `mm` | millimetres | 2, 3 | *unverified* | <!-- EXT-16.10.2-003 --> |
| `cm` | centimetres | 4 | *unverified* | <!-- EXT-16.10.2-004 --> |

- *unverified* (reader guidance): `mm` and `cm` are as common as `in`; do not require inches. <!-- EXT-13.4.2-012 -->

#### Object row vocabulary

*unverified*: All `objects/*.xml` members share one vocabulary; each child of `root` is one object row `o`. <!-- EXT-13.4.3-001 -->

| Element | Attributes | Content | Occurs in | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| `o` (row) | `N` object name; `A` alias (absent only in `Design.xml`) | zero or more `a`, `m`, `f`, `g` | every object member | *unverified* | <!-- EXT-13.4.3-002 --> |
| `a` (property) | `N` property name | `v`, then (except in `Design.xml`) an inner `o` | Net, Pin, DiffPair, Design | *unverified* | <!-- EXT-13.4.3-003 --> |
| `v` (in `a`) | `V` property value as text | empty | in `a` | *unverified* | <!-- EXT-13.4.3-004 --> |
| `o` (inside `a`) | none | decimal text, always `2`; meaning unknown | in `a` | *unverified* | <!-- EXT-13.4.3-005 EXT-16.10.6-004 --> |
| `m` (member) | `K` member kind; `N` member object name | empty | Xnet, DiffPair, NetClass | *unverified* | <!-- EXT-13.4.3-006 --> |
| `f` | none | decimal text (NetClass flags) | NetClass | *unverified* | <!-- EXT-13.4.3-007 --> |
| `g` | none | one `v` holding text | Design | *unverified* | <!-- EXT-13.4.3-008 --> |

- *unverified*: Property names match `[A-Z0-9_]+`; property values are never empty. <!-- EXT-13.4.3-009 -->
- *unverified*: Every `m/@N` names a row of `Net.xml`. <!-- EXT-13.4.3-014 -->

| `m/@K` | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `9` | Xnet member | The member is an Xnet: its name is a row of `Xnet.xml` and, like every Xnet name, of `Net.xml`. Occurs only in `DiffPair.xml` | *unverified* | <!-- EXT-13.4.3-010 EXT-16.10.3-002 --> |
| `10` | net member | The member is a net: its name is a row of `Net.xml`. Occurs in `Xnet.xml`, `DiffPair.xml`, `NetClass.xml` | *unverified* | <!-- EXT-13.4.3-011 EXT-16.10.3-003 --> |

#### `objects/Net.xml`

```
<o N="@\<design>\.\<schematic>\(sch_1):\<net>\" A="<net>"/>
<o N="..." A="<net>"><a N="<prop>"><v V="<value>"/><o>2</o></a>...</o>
```
<!-- EXT-13.4.4-001 -->

- *unverified*: `A` is always present and equals the `<net>` segment of `N`. <!-- EXT-13.4.4-002 -->
- *unverified*: A row has zero, one or two properties; most have none. <!-- EXT-13.4.4-003 -->
- *unverified*: Each archive uses a few distinct net property names, none declared in `userPropertyDefinitions.xml`. <!-- EXT-13.4.4-004 -->

#### `objects/Pin.xml`

```
<o N="@\<design>\.\<schematic>\(sch_1):\<dbo>\:\<pin>\" A="<ref>.<physical>"><a N="CDS_PN"><v V="<physical>"/><o>2</o></a></o>
```
<!-- EXT-13.4.5-001 -->

- *unverified*: Each row has exactly one property, `CDS_PN`, with inner `o` text `2`; its value is the physical pin number. <!-- EXT-13.4.5-002 -->
- *unverified*: `<dbo>` is `INS` followed by decimal digits, the Library string that names a placed instance. <!-- EXT-13.4.5-003 -->
- *unverified*: `<pin>` is the logical pin name, with each `\` written `\\`. <!-- EXT-13.4.5-004 -->
- *unverified*: `A` is the instance's reference designator, a `.`, and the physical pin number; the text after the last `.` normally equals the `CDS_PN` value. <!-- EXT-13.4.5-005 -->

#### `objects/Xnet.xml`

```
<o N="@\<design>\.\<schematic>\(sch_1):\<name>\" A="<name>"><m K="10" N="..."/>...</o>
```
<!-- EXT-13.4.6-001 -->

- *unverified*: Each row has two or more `m` children, all `K` = 10. <!-- EXT-13.4.6-002 -->
- *unverified*: The Xnet's own name is always one of its member nets. <!-- EXT-13.4.6-003 -->
- *unverified*: `A` normally equals the `<name>` segment of `N`. <!-- EXT-13.4.6-004 -->

#### `objects/DiffPair.xml`

```
<o N="@\<design>\.\<schematic>\(sch_1):\<name>\" A="<name>">[<a ...>...</a>...]<m K="..." N="..."/><m K="..." N="..."/></o>
```
<!-- EXT-13.4.7-001 -->

- *unverified*: Each row has exactly two `m` children, each a net (`K` = 10) or an Xnet (`K` = 9). <!-- EXT-13.4.7-002 -->
- *unverified*: Optional `a` properties, of the `Net.xml` property form, precede the members. <!-- EXT-13.4.7-003 -->
- *unverified*: `A` equals the `<name>` segment of `N`. <!-- EXT-13.4.7-004 -->

#### `objects/NetClass.xml`

```
<o N="@\<design>\.\<schematic>\(sch_1):\<name>\" A="<name>"><f><flags></f>[<m K="10" N="..."/>...]</o>
```
<!-- EXT-13.4.8-001 -->

- *unverified*: A row has one `f` (the NetClass flags, decimal text), then zero or more `m` children with `K` = 10; rows without members are common. <!-- EXT-13.4.8-002 EXT-16.10.4-001 -->
- *unverified*: `A` equals the `<name>` segment of `N`. <!-- EXT-13.4.8-003 -->
- *unverified*: The design token of `N` can differ from `Header.xml` `Name`; readers should not require it to match in this member. <!-- EXT-13.4.8-004 EXT-13.4.8-005 -->
- *unverified*: Known `f` values are `8192` (0x2000) and `528384` (0x81000); the meaning of each is unknown. <!-- EXT-13.4.8-006 EXT-13.4.8-007 -->

#### `objects/Gate.xml`

```
<o N="<gate path>" A="<ref>"/>
```
<!-- EXT-13.4.9-001 -->

- *unverified*: Every row is an empty element with `N` and `A` only. <!-- EXT-13.4.9-002 -->
- *unverified*: `A` is a reference designator; the same `A` can occur in several rows and need not match a current placed instance. <!-- EXT-13.4.9-003 -->
- *unverified*: `N` is a `\`-separated path whose full grammar is unknown. Known shapes, with `<t>` an arbitrary token and `<x>` a parenthesised token: <!-- EXT-13.4.9-004 -->

| Shape of `N` | Evidence | Ids |
| --- | --- | --- |
| `@\<design>\.\<schematic>\(sch_1):\INS<digits>\@\<t>\.\<t>\(<x>)` | *unverified* | <!-- EXT-13.4.9-005 --> |
| the same, with a design token other than `Header.xml` `Name` | *unverified* | <!-- EXT-13.4.9-006 --> |
| `@\<t>\<t>\<t>\(<x>)` | *unverified* | <!-- EXT-13.4.9-007 --> |
| `@\<t>\.\<t>\<t>\<t>\(<x>)` | *unverified* | <!-- EXT-13.4.9-008 --> |
| `@\<t>\<t>\<t>\.\<t>\(<x>)` | *unverified* | <!-- EXT-13.4.9-009 --> |
| `@\<t>\.\<t>\<t>\<t>\.\<t>\(<x>)` | *unverified* | <!-- EXT-13.4.9-010 --> |
| `<t>\<t>\(<x>)` | *unverified* | <!-- EXT-13.4.9-011 --> |

#### `objects/Design.xml`

```
<root><o N="<design>">[<a N="<prop>"><v V="<value>"/></a>]<g><v>a</v></g></o></root>
```
<!-- EXT-13.4.10-001 -->

- *unverified*: Exactly one row; `N` equals `Header.xml` `Name` with no path decoration; there is no `A`. <!-- EXT-13.4.10-002 -->
- *unverified*: At most one property `a`, placed before `g`, with no inner `o`. <!-- EXT-13.4.10-003 -->
- *unverified*: `g/v` text is always the letter `a`; meaning unknown. <!-- EXT-13.4.10-004 EXT-16.10.6-005 -->

#### `userPropertyDefinitions.xml`

```
<root>
  <attribute Name="<prop>">
    <value><data Type="Scalar" Storage="String"/></value>
    <objects><valid><o>Net</o></valid></objects>
  </attribute>
  [ <attribute Name="<prop>" Description="<text>">
      <value Kind="Property"><data Type="Scalar" Storage="String"/><flags><s>ReadOnly</s><s>Package</s></flags></value>
      <objects><valid><o><type></o>...</valid></objects>
    </attribute> x 8 ]
</root>
```
<!-- EXT-13.4.11-001 -->

| Item | Rule | Evidence | Ids |
| --- | --- | --- | --- |
| Attribute count | 1, or 9 (the first form plus 8 described ones) | *unverified* | <!-- EXT-13.4.11-002 --> |
| First attribute | `Name` only; `value` has no `Kind` and no `flags`; valid type `Net` | *unverified* | <!-- EXT-13.4.11-003 --> |
| Described attributes | `Name` and `Description`; `value/@Kind` = `Property`; flags `ReadOnly` then `Package` | *unverified* | <!-- EXT-13.4.11-004 --> |
| `data` | Always `Type="Scalar" Storage="String"`, in that order | *unverified* | <!-- EXT-13.4.11-005 --> |
| `Name` | Matches `[A-Z0-9_]+`; never `CDS_PN` | *unverified* | <!-- EXT-13.4.11-006 --> |

*unverified*: `valid/o` text holds object type names. <!-- EXT-16.10.5-001 -->

| `valid/o` | Meaning | Evidence | Ids |
| --- | --- | --- | --- |
| `Net` | net | *unverified* | <!-- EXT-13.4.11-007 EXT-16.10.5-002 --> |
| `Bus` | bus | *unverified* | <!-- EXT-13.4.11-008 EXT-16.10.5-003 --> |
| `DiffPair` | differential pair | *unverified* | <!-- EXT-13.4.11-009 EXT-16.10.5-004 --> |
| `ElectricalCSet` | electrical constraint set | *unverified* | <!-- EXT-13.4.11-010 EXT-16.10.5-005 --> |
| `PinPair` | pin pair | *unverified* | <!-- EXT-13.4.11-011 EXT-16.10.5-006 --> |
| `Xnet` | Xnet | *unverified* | <!-- EXT-13.4.11-012 EXT-16.10.5-007 --> |
| `Pin` | pin | *unverified* | <!-- EXT-13.4.11-013 EXT-16.10.5-008 --> |

- *unverified*: Known `valid` lists: `Net` alone; `Bus`, `DiffPair`, `ElectricalCSet`, `Net`, `PinPair`, `Xnet` together; `Pin` alone. <!-- EXT-13.4.11-014 EXT-16.10.5-009 -->

#### Object names

| Object | `N` form | Evidence | Ids |
| --- | --- | --- | --- |
| design | `<design>` | *unverified* | <!-- EXT-13.5.1-001 --> |
| net, Xnet, differential pair, net class, member reference | `@\<design>\.\<schematic>\(sch_1):\<name>\` | *unverified* | <!-- EXT-13.5.1-002 --> |
| pin | `@\<design>\.\<schematic>\(sch_1):\<dbo>\:\<pin>\` | *unverified* | <!-- EXT-13.5.1-003 --> |
| gate | the Gate.xml shapes above | *unverified* | <!-- EXT-13.5.1-004 --> |

- *unverified*: The scope token is always `(sch_1)`. <!-- EXT-13.5.1-005 -->
- *unverified*: `<design>` equals `Header.xml` `Name` in every net, Xnet, differential-pair and pin row; net-class rows may differ. <!-- EXT-13.5.1-006 -->
- *unverified*: `<schematic>` equals the folder that holds the storage. <!-- EXT-13.5.1-007 -->
- *unverified*: `Header.xml` `Name` equals `Metadata_v3` row 3, and `Metadata_v3` row 4 equals `<schematic>`. <!-- EXT-13.5.2-001 EXT-13.5.2-002 -->
- *unverified*: `<schematic>` need not be the root schematic named at the end of the Library stream. <!-- EXT-13.5.2-004 -->

#### `Views/<schematic>/Constraint/Metadata_v3`

*unverified*: Six rows, each a u64 byte length and a payload. Rows 0 to 4 are each followed by one NUL byte that the length does not count; row 5 has none. <!-- EXT-13.6-001 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u64 | `len0` | Always 1 | *unverified* | <!-- EXT-13.6-002 --> |
| +0x08 | ASCII[1] | `row0` | Always `1`; meaning unknown | *unverified* | <!-- EXT-13.6-003 --> |
| +0x09 | u8 | `nul0` | Always 0 | *unverified* | <!-- EXT-13.6-004 --> |
| +0x0A | u64 | `len1` | Always 1 | *unverified* | <!-- EXT-13.6-005 --> |
| +0x12 | ASCII[1] | `row1` | Always `1`; meaning unknown | *unverified* | <!-- EXT-13.6-006 EXT-16.10.6-006 --> |
| +0x13 | u8 | `nul1` | Always 0 | *unverified* | <!-- EXT-13.6-007 --> |
| +0x14 | u64 | `len2` | Always 1 | *unverified* | <!-- EXT-13.6-008 --> |
| +0x1C | ASCII[1] | `row2` | Known values `1`, `2`; meaning unknown | *unverified* | <!-- EXT-13.6-009 EXT-16.10.6-007 --> |
| +0x1D | u8 | `nul2` | Always 0 | *unverified* | <!-- EXT-13.6-010 --> |
| +0x1E | u64 | `len3` | Length of `row3` | *unverified* | <!-- EXT-13.6-011 --> |
| +0x26 | ASCII[`len3`] | `row3` | Design name; equals `Header.xml` `Name` | *unverified* | <!-- EXT-13.6-012 --> |
| after `row3` | u8 | `nul3` | Always 0 | *unverified* | <!-- EXT-13.6-013 --> |
| after `nul3` | u64 | `len4` | Length of `row4` | *unverified* | <!-- EXT-13.6-014 --> |
| after `len4` | ASCII[`len4`] | `row4` | Schematic folder name `<schematic>` | *unverified* | <!-- EXT-13.6-015 --> |
| after `row4` | u8 | `nul4` | Always 0 | *unverified* | <!-- EXT-13.6-016 --> |
| after `nul4` | u64 | `len5` | Always 8 | *unverified* | <!-- EXT-13.6-017 --> |
| after `len5` | u32 | `stamp` | Meaning open (see Open questions) | *unverified* | <!-- EXT-13.6-018 --> |
| after `stamp` | u32 | `stamp_extra` | Known values 0, 230 to 720, and 6,357,093 | *unverified* | <!-- EXT-13.6-020 --> |

- *unverified*: The stream size is 64 + `len3` + `len4`. <!-- EXT-13.6-022 -->
- *unverified*: The high dword of every u64 length is 0. <!-- EXT-13.6-023 -->
- *unverified*: Row 5 is not a CRC-32, an Adler-32, or the length of the `DCF` stream. <!-- EXT-13.6-024 -->

#### `CCSStorage/___IndexInfoForMiscStorage`

*unverified*: The row form of the constraint index, with one row; the stream is 133 bytes. <!-- EXT-13.7.1-001 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `row_count` | Always 1 | *unverified* | <!-- EXT-13.7.1-002 --> |
| +0x04 | u32 | `name_len` | Known value 15 | *unverified* | <!-- EXT-13.7.1-003 --> |
| +0x08 | ASCII[`name_len`] | `name` | Name of the sibling data stream; digits and `-` | *unverified* | <!-- EXT-13.7.1-004 --> |
| after `name` | u32 | `desc_len` | Known value 106 | *unverified* | <!-- EXT-13.7.1-005 --> |
| after `desc_len` | ASCII[`desc_len`] | `desc` | Grammar below | *unverified* | <!-- EXT-13.7.1-006 --> |
| after `desc` | | end | End of stream | *unverified* | <!-- EXT-13.7.1-007 --> |

```
desc := '{ "FileName": ' file ',' LF TAB ' "Descr": ' descr ',' LF TAB ' "CreationTime": "' M '/' D '/' Y '  ' h ':' m ':' s '" ' LF '}'
```
<!-- EXT-13.7.1-008 -->

- *unverified*: `file` is an unquoted file name ending in `.ENC`, different from `name`. <!-- EXT-13.7.1-009 -->
- *unverified*: `descr` is an unquoted short text that contains a space. <!-- EXT-13.7.1-010 -->
- *unverified*: `CreationTime` is filled in; two spaces separate date from time; `M`, `D`, `Y`, `h`, `m`, `s` are decimal digit runs. <!-- EXT-13.7.1-011 -->
- *unverified*: Compared with the constraint index, `Descr` here is unquoted and `CreationTime` is filled in. <!-- EXT-13.7.1-012 -->

#### `CCSStorage/<name>`

- *unverified*: ASCII Base64 text in the standard alphabet (`A-Z`, `a-z`, `0-9`, `+`, `/`, `=` padding). <!-- EXT-13.7.2-001 -->
- *unverified*: Lines of 72 characters except a shorter last line; every line ends with LF (0x0A), no CR; the stream ends with LF. <!-- EXT-13.7.2-002 -->
- *unverified*: Decoded, it is an SQLite 3 database image (magic `SQLite format 3\0`, page size 8192); known decoded length 2,097,152 bytes (256 pages). <!-- EXT-13.7.2-003 -->

### Open questions

No real file has a constraint storage, so our data shows nothing about any of these.

- What `Header.xml` `Contents` and `revisionNumber/@logical` encode; whether `@logical` is an edit counter. <!-- EXT-13.4.2-006 EXT-13.oq-002 -->
- What `precision/@units` values other than `in`, `mm`, `cm` mean. <!-- EXT-13.4.2-011 EXT-16.10.2-005 -->
- The complete enumeration of `m/@K`, what other values mean, and whether `K` is an object-type code shared by all object members. <!-- EXT-13.4.3-012 EXT-13.4.3-013 EXT-16.10.3-004 EXT-16.10.3-005 -->
- What NetClass `f` encodes: `8192` (0x2000), `528384` (0x81000), any other value, and whether `f` is a bit set distinguishing kinds of class. <!-- EXT-13.4.8-008 EXT-13.4.8-009 EXT-16.10.4-002 EXT-16.10.4-003 EXT-16.10.4-004 EXT-16.10.4-005 EXT-13.oq-004 EXT-16.oq-005 -->
- What `Metadata_v3` rows 0 to 2 mean; whether `stamp` is a save time in Unix seconds (UTC); whether `stamp_extra` is milliseconds. <!-- EXT-13.6-019 EXT-13.6-021 EXT-13.oq-001 -->
- The full `Gate.xml` name grammar, and what its shapes without `(sch_1)` and its foreign design tokens denote. <!-- EXT-13.oq-003 -->
- What the inner property `o` (always `2`) and the Design `g/v` letter encode. <!-- EXT-13.oq-005 -->
- Why a NetClass row can carry a design token other than the archive's design name. <!-- EXT-13.oq-006 -->
- What the `CCSStorage` database holds and how it relates to the constraint archive; EXT treats it as outside the format, to be copied unchanged. <!-- EXT-13.7.2-004 EXT-13.oq-007 -->
- Which `FormatVersion` values exist beyond the four known ones, and whether any changes the member set or grammar. <!-- EXT-13.oq-008 -->

<!-- meta: EXT-13-005 EXT-13.7-001 EXT-16.10.3-001 -->

Parser coverage: the parser reads none of this chapter; it never opens `Views/<s>/Constraint` or `CCSStorage`.

---

## 14. CIS storages and Do Not Install

The CIS (component information system) storages are the optional root storage `CIS/` and the per-schematic storage `Views/<schematic>/CISSchematic/`. `CIS/VariantStore` records design variants: which groups of parts a BOM variant composes and which parts each group fits or leaves off the board. A design without `CIS/` is normal, not damaged.

- 21 of 120 OLE `.DSN` files carry `CIS/` (18 distinct by sha256); 99 have none. **O** (120 files) <!-- EXT-1.2.2-020 INT-2-018 INT-11-001 -->
- Of the 21, 16 carry an empty store (`BOMDataStream` body `FB`, empty `GroupsDataStream`, 11-byte `VariantNames`), for example `test-fixtures/cadence/parallella-aafm/HB1A-AAFM.DSN`; 5 hold a variant and groups. An empty store is what a design that never declared a variant writes. **O** (21 files) <!-- EXT-17.4-002 INT-11-004 -->
- Among the 18 OLE fixture files, 9 carry `CIS/` and 3 of those declare a variant group (LAUNCHXL-CC1310, reServer Industrial J401, reServer J2032); the other 6 carry an empty store. **O** (18 files) <!-- INT-2-019 INT-11-004 -->

### 14.1 Do Not Install

Cadence records Do Not Install (DNI) in three ways. Source: INT §13.6, §13.7 and [cadence-dni.md](cadence-dni.md); EXT does not cover DNI.

| Mechanism | Stored in | Reaches the `.dat` exports | Evidence |
| --- | --- | --- | --- |
| A. Marker in the value | Value string: `,DNI` `,DNP` `,DNM` `,DNS` `,NC` (suffix), `DNI,` `DNP,` `DNM,` `DNS,` (prefix), `_NC` (suffix), or the marker alone; case-insensitive | Yes, in the value and part name | **E** |
| B. Assembly property | Any user property other than the value whose value is a marker on its own (`ASSY`, `ASSY_OPT`, `Assembly`, `BuildOptions`, `INSTALL`, and others), excluding `NC` and `NF` alone and blank `<NAME>` placeholders | No | **O** (seen on 5 fixture libraries) |
| C. CIS variant | `CIS/VariantStore`: a part with status `0` in a composed group and no status `1` in another (§14.15) | No (below) | **E** |

- With A and C read, the DNS flag matches the reference on all 493 DNS parts of the 11 coverage designs. That match is **E** for 90 parts: BeagleBoard-xM 38, CutiePi 22 and CC13xxEM 5 through export value markers, and LAUNCHXL-CC1310 25 through its CIS BOM. The other 403 (reServer J401 289, reServer J2032 77, BEAGLEBONEBLK_C3_BEAGLEBOARD 37) compare our parser with a reference built by our own store reader or our own snapshot, so they show self-consistency only. <!-- INT-13.6-002 -->
- *unverified*: A variant that lists a part with status `1` fits it, overriding A and B. No status-1 part in the corpus carries an A or B marker (0 of 166, LAUNCHXL-CC1310 and ELEMENT-DVT), so the override is never exercised; the parser applies it (`dsn-parser.ts:270-276`).

What mechanism C leaves in the exports. A part a variant leaves off keeps an ordinary value and part name in `pstxprt`/`pstchip` and its pin nets in `pstxnet` (all 25 and 77 such parts on LAUNCHXL-CC1310 and reServer J2032, 289 of 291 on reServer J401, where `J17_TB1` and `J2_TB2` are absent from the export), so the DAT path alone cannot see it. **E** <!-- INT-11-002 -->

| Design | Unfitted by the store | In `pstxprt` | Value marker in part name | With pins in `pstxnet` | With 2+ pins | Carry `ASSY=DNP` (mechanism B) |
| --- | --- | --- | --- | --- | --- | --- |
| reServer Industrial J401 | 291 | 289 (`J17_TB1`, `J2_TB2` absent) | 0 | 289 | 204 | 193 |
| reServer J2032 | 77 | 77 | 0 | 77 | 45 | 49 |
| LAUNCHXL-CC1310 | 25 | 25 | 11 | 25 | 13 | (10 carry a marker-valued property, below) |

<!-- INT-11-002 INT-11.5-005 INT-11.5-006 INT-11.5-008 -->

- The schematic is therefore not silent about every store-unfitted part: 193 of 291 (J401) and 49 of 77 (J2032) also carry `ASSY=DNP`. The part nothing else marks is what the store alone accounts for. <!-- INT-11-002 -->
- On reServer Industrial J401, the netlist path reports 289 of the 291 store-unfitted parts: `J2_TB2` and `J17_TB1` are drawn on the schematic but absent from the DAT export. **E** <!-- INT-11.5-008 -->
- LAUNCHXL-CC1310 ships `LAUNCHXL-CC1310_1_3_0_BOM.xlsx`, generated by CIS. Its 25 part references with Part Number `DNM` and Quantity 0 are exactly the 25 parts the store leaves off: `A1 C24 C58 FIDU1`-`FIDU6 MH1`-`MH5 P8 R13 R19 R21 R46`-`R49 R51 R59 R60`, none missing, none extra. **E** (25 parts) <!-- INT-11.5-001 INT-11.5-002 -->
- Of those 25, 11 also carry a value marker (`C24 C58 R19 R21 R46`-`R49 R51 R59 R60`, seen in the `pstxprt` part name) and 14 do not; the store alone accounts for those 14 against value markers. 10 of the 25 carry a marker-valued property (MPN, Resistance or Vendor Part Number = `DNM`), so "store alone" holds only in the value-marker sense. **E** (25 parts) <!-- INT-11.5-003 INT-11.5-004 -->

| Design | Resolved by the store | Also found by a value marker | Store alone (value-marker sense) | Evidence |
| --- | --- | --- | --- | --- |
| LAUNCHXL-CC1310 | 25 | 11 | 14 | **E** <!-- INT-11.5-004 --> |
| reServer J2032 | 77 | 0 | 77 | **E** <!-- INT-11.5-005 --> |
| reServer Industrial J401 | 291 | 0 | 291 | **E** <!-- INT-11.5-006 --> |

- A design without a variant group is unchanged by the store: the 16 CIS files without groups and every non-CIS file yield an empty unfitted set. 15 of the 18 fixture files have no group. **O** <!-- INT-11.5-007 -->

### 14.2 Storage tree and presence

```
CIS/
  VariantStore/
    VariantNames                                   §14.4
    BOM/
      BOMDataStream                                §14.5
      <variant>/
        <variant>                                  §14.6  composition
        BOMPartData                                §14.7
        BOMAmbugity                                §14.8  (Cadence's spelling)
    Groups/
      GroupsDataStream                             §14.9
      <group>/
        <group>                                    §14.10 membership
        UpdateStorageGroupDataStream               §14.11 optional
  CISSchematicStore/
    CISSchematicStream                             §14.12
Views/<schematic>/CISSchematic/
  VariantOCCStorage/
    VariantOCCStream                               §14.13
  SchematicInfoStorage/
    SchematicInfoStream                            §14.14
    <page>                                         §14.14  one per listed page
```

Every observed CIS entry fits this tree. EXT also describes a sub-group branch (`Groups/<group>/<sub>/...`), which never occurs (Unverified). **O** (21 files) <!-- EXT-14.1-001 -->

| Rule | Evidence | Ids |
| --- | --- | --- |
| When `CIS/` exists, `VariantNames`, `BOMDataStream`, `GroupsDataStream` and `CISSchematicStream` always exist | **O** (21/21) | <!-- EXT-14.1-003 --> |
| Each `BOM/<variant>/` holds exactly `<variant>`, `BOMPartData` and `BOMAmbugity` | **O** (5/5) | <!-- EXT-14.1-004 EXT-1.2.4-008 INT-11-011 INT-11-016 --> |
| The stream name is spelled `BOMAmbugity` | **O** (5/5) | <!-- EXT-14.1-002 INT-11-012 --> |
| The `BOM/<variant>/` storages are exactly the variants `BOMDataStream` lists; `BOMDataStream` sits next to 0 or 1 of them | **O** (21/21) | <!-- EXT-14.1-005 INT-11-009 --> |
| The `Groups/<group>/` storages are exactly the groups `GroupsDataStream` lists (14 groups) | **O** (21/21) | <!-- EXT-14.1-006 --> |
| `Views/<schematic>/CISSchematic/` occurs only with `CIS/`; it holds exactly `VariantOCCStorage/VariantOCCStream` and `SchematicInfoStorage/{SchematicInfoStream, pages}`; its folder has a Hierarchy stream | **O** (1 file; 0 without `CIS/`) | <!-- EXT-14.1-007 --> |
| A membership or composition stream's name repeats its storage name (14 `Groups/<g>/<g>`, 5 `BOM/<v>/<v>`) | **O** (19/19) | <!-- EXT-14.1-008 --> |

Stream roles:

| Stream | Holds | Evidence | Ids |
| --- | --- | --- | --- |
| `BOM/BOMDataStream` | The variant list (one name per file where present) | **O** (21) | <!-- EXT-1.2.4-007 --> |
| `BOM/<v>/<v>` | The group keys one BOM variant composes | **E** (5; LAUNCHXL BOM reproduced 25/25) | <!-- INT-2-013 INT-11-010 INT-11-014 INT-11.2-001 --> |
| `Groups/GroupsDataStream` | The index of group names (14 records) | **O** (21) | <!-- EXT-1.2.4-009 INT-11-006 --> |
| `Groups/<g>/<g>` | The group's occurrence list with a fit status per entry (742 entries) | **E** (14) | <!-- EXT-1.2.4-010 INT-11-007 INT-11-013 --> |
| `Groups/<g>/UpdateStorageGroupDataStream` | One CIS property row per listed occurrence (§14.11) | **O** (1 stream) | <!-- EXT-1.2.4-012 --> |
| `CISSchematicStore/CISSchematicStream` | A list of schematic names (20 empty, 1 lists the schematic folder) | **O** (21) | <!-- EXT-1.2.4-005 --> |
| `VariantOCCStorage/VariantOCCStream` | 8 bytes, all zero | **O** (1 stream) | <!-- EXT-1.2.3-006 --> |
| `SchematicInfoStorage/SchematicInfoStream` | The CIS page-name list (count 23, one per sibling stream) | **O** (1 stream) | <!-- EXT-1.2.3-007 --> |
| `SchematicInfoStorage/<p>` | Per-page part snapshots: 23 streams, all named after a page, 122 records each naming a placed instance on that page. EXT's empty-named form never occurs | **O** (1 file) | <!-- EXT-1.2.3-008 --> |

A group holds either fitted or unfitted members, so `Groups/<g>/<g>` is not only a Do Not Stuff set: `DNM` (2), `DNP` (2) and `NL` use status `0` only; `RF`, `XDS`, `DebuggerIF`, `Peripherals` (2 each) and `STUFFED` use status `1` only. **O** (14 groups) <!-- INT-2-014 -->

### 14.3 Shared encodings

- Integers are little-endian: every u32 read so matches stream sizes on 72 length-prefixed streams and fully consumes the `VariantNames`, `CISSchematicStream` and `SchematicInfo` streams. **S** <!-- EXT-14-003 -->
- Strings in the non-delimited streams are `lstr`: a u16 length, that many bytes, then one NUL. The NUL is present on all 2,524 `lstr` in `VariantNames`, `CISSchematicStream`, `SchematicInfoStream` and the 23 snapshots. **S** (2,524 strings) <!-- EXT-14-004 -->
- Text is 8-bit with no stored code page, read as Latin-1. No byte at or above 0x80 occurs in any `VariantStore` body other than the delimiters 0xB0, 0xC0, 0xF9, 0xFB, and none in `VariantNames`; no byte 0x80-0x9F occurs, so Latin-1 and Windows-1252 read the corpus identically. **S** <!-- EXT-14-005 INT-3.1-006 -->
- Decimal fields (counts, ids, flags, statuses) are runs of ASCII digits with no sign, in 21 `BOMDataStream`, 5 compositions, 5 `BOMPartData`, 21 `GroupsDataStream`, 14 memberships and 1 substitution stream. **S** <!-- EXT-14-006 -->

#### Length-prefixed body

Every stream under `CIS/VariantStore/` except `VariantNames` is a u32 length followed by a delimited text body. **S** (72/72 streams) <!-- EXT-14.2.1-001 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `body_len` | Byte count of the body; always stream size - 4; not a magic | **S** (72/72) | <!-- EXT-14.2.1-002 INT-11.1-001 INT-11.2-002 --> |
| +0x04 | bytes[`body_len`] | `body` | Delimited text, consumed to its end by the per-stream grammars | **S** (72) | <!-- EXT-14.2.1-003 --> |

#### Delimiter bytes

| Byte | Latin-1 | Role | Evidence | Ids |
| --- | --- | --- | --- | --- |
| 0xF9 | ù | Field separator in `BOMDataStream`, compositions and `BOMPartData`; never trailing | **S** (5 + 5 + 5 streams) | <!-- EXT-14.2.2-001 EXT-16.11.1-002 --> |
| 0xB0 | ° | Field terminator in `GroupsDataStream` and memberships (every body ends in B0); separator after a substitution record's id | **S** (5 + 14 streams, 3 records) | <!-- EXT-14.2.2-002 EXT-16.11.1-003 INT-11.1-002 --> |
| 0xC0 | À | Separates the column list from the value list of a substitution record | **O** (3 records, 1 stream) | <!-- EXT-14.2.2-003 EXT-16.11.1-004 --> |
| 0x5E | `^` | Separates list items in substitution records (14 columns, 14 values) | **O** (3 records) | <!-- EXT-14.2.2-004 EXT-16.11.1-005 --> |
| 0x7E | `~` | Joins `id~status` in memberships (742/742 entries); terminates a substitution record (3/3) | **O** | <!-- EXT-14.2.2-005 EXT-16.11.1-006 --> |
| 0xFB | û | The whole body of an empty `BOMDataStream` (16/16) | **O** | <!-- EXT-14.2.2-006 EXT-16.11.1-007 --> |

- INT names 0xB0 a separator; reading it as a separator or as a terminator splits the same fields. <!-- INT-11.1-002 -->
- A body's delimiters never occur inside its names or values: every grammar splits cleanly on 72 streams, and the substitution text holds no B0, C0 or `~`. **O** <!-- EXT-14.2.2-007 -->
- EXT also assigns `^` and `~` roles in ambiguity records, and 0xFB to empty compositions and `BOMPartData`; none of those exists (Unverified).

#### Empty bodies

An empty list is not always a zero-length body: an empty `BOMDataStream` is `FB` (16), an empty `GroupsDataStream` is zero-length (16). **O** <!-- EXT-14.2.3-001 -->

| Stream | Empty body | Stream size | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `BOMDataStream` | `FB` | 5 | **S** (16/16) | <!-- EXT-14.2.3-002 EXT-16.11.2-002 --> |
| `GroupsDataStream` | none | 4 | **S** (16/16) | <!-- EXT-14.2.3-006 EXT-16.11.2-004 --> |
| `BOMAmbugity` | none | 4 | **S** (5/5) | <!-- EXT-14.2.3-008 --> |

### 14.4 `CIS/VariantStore/VariantNames`

`VariantNames` is a counted list of `lstr` names followed by one trailer `lstr`. **S** (21 streams) <!-- EXT-14.3-006 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `version` | Always 900 (0x384) | **S** (21/21) | <!-- EXT-14.3-001 EXT-16.11.6-001 INT-11-005 --> |
| +0x04 | u32 | `count` | Number of `names`: 0 (16 streams), 5, 9, 11, 14 (2) | **S** (21/21) | <!-- EXT-14.3-003 --> |
| +0x08 | `lstr` x `count` | `names` | Never empty; duplicates in 5 of 5 non-empty lists | **S** (21) | <!-- EXT-14.3-004 --> |
| after `names` | `lstr` | `trailer` | Exactly one, always present; 17 empty, 4 non-empty (`RF` x2, `STUFFED`, `DNP`) | **S** (21/21) | <!-- EXT-14.3-005 EXT-14.3-012 --> |
| after `trailer` | | end | End of stream | **S** (21/21) | <!-- EXT-14.3-006 --> |

- An empty store's `VariantNames` is exactly the 11 bytes `84 03 00 00 | 00 00 00 00 | 00 00 00`. **S** (16/16) <!-- EXT-14.3-007 -->
- The names observed are group names (29), `Common` (7), the helpers `bom-<v>` and `bom-<v>-Common` (12), and names matching nothing current (`STUFF` x2, `Testpoint-DNP` x2, `Testpoint-P`). No name equals a bare BOM variant name in any of the 5 designs with variants. **O** (21 streams) <!-- EXT-1.2.4-006 EXT-14.3-008 INT-11-005 INT-11-015 -->
- Every non-empty trailer (4) equals a current group name that is also listed. **O** <!-- EXT-14.3-009 -->
- Every design with variants has exactly 1 variant, so EXT's "count is usually a multiple of the number of variants" holds only vacuously (counts 5, 9, 11, 14). **O** <!-- EXT-14.3-010 -->
- The variant set comes from `BOMDataStream` and the `BOM/<v>/` storages (equal in 21/21), never from `VariantNames`. Treating every `VariantNames` entry as an assembly would invent selectors that do not exist. **O** <!-- EXT-14.3-011 INT-11.2-007 -->

### 14.5 `CIS/VariantStore/BOM/BOMDataStream`

A length-prefixed body listing the BOM variants. **S** (21 streams: 16 `FB`, 5 `1 F9 name`) <!-- EXT-14.4-001 -->

```
body  := count ( F9 variant ){count}
       | FB                              ; no variants
count := decimal
```

- `count` equals the number of names that follow; the only value seen is 1. **S** (5/5) <!-- EXT-14.4-002 -->
- Variant names are unique and non-empty. **O** (5/5) <!-- EXT-14.4-003 -->
- No field is empty, no NUL occurs, and there is no trailing 0xF9. **S** (21/21) <!-- EXT-14.4-004 -->
- The names equal the set of `BOM/<v>/` storages; an `FB` body has none. **O** (21/21) <!-- EXT-14.4-005 -->

### 14.6 `CIS/VariantStore/BOM/<variant>/<variant>` (composition)

A composition is the list of group keys one BOM variant composes, with the `BOMDataStream` list grammar. **S** (5 streams; counts 2, 2, 2, 6, 6) <!-- EXT-14.5-001 INT-11.2-003 -->

```
body := count ( F9 key ){count}
```

- `count` is decimal and equals the number of keys (2 in 3 files, 6 in 2). **S** <!-- EXT-14.5-002 INT-11.2-004 --> EXT lists 1 to 10; only 2 and 6 occur, the rest stay Unverified (§Unverified).
- No key repeats, and all 14 non-`Common` keys name a group record. **O** (5/5) <!-- EXT-14.5-003 -->
- A key `<group>` selects the membership `Groups/<group>/<group>` (14/14). Evaluating LAUNCHXL `Standard` through its keys gives exactly the 25 DNM, quantity-0 parts of its BOM. **E** <!-- EXT-14.5-005 EXT-16.11.3-003 -->
- `Common` is a key in 4 of 5 compositions, first in 3 of those 4 (reServer J2032 lists `DNP`, `Common`). It never has a group record or a stream (0 of 14). **O** <!-- EXT-14.5-004 EXT-14-007 EXT-16.11.3-002 INT-11.2-005 -->
- No key uses the hyphen form `<group>-<sub>` (0 of 14). **O** <!-- EXT-14.5-007 EXT-16.11.3-005 -->
- Example: LAUNCHXL-CC1310 `BOM/Standard/Standard` is `6 Common DNM DebuggerIF Peripherals RF XDS`. **O** <!-- INT-11.2-006 -->

### 14.7 `CIS/VariantStore/BOM/<variant>/BOMPartData`

`BOMPartData` is a length-prefixed list of decimal ids, with the `BOMDataStream` list grammar. **S** (5 streams: 59, 140, 140, 1541, 30 ids) <!-- EXT-14.6-001 INT-11.4-001 -->

```
body := count ( F9 id ){count}
```

- `count` equals the number of ids. **S** (5/5) <!-- EXT-14.6-002 -->
- Ids are decimal unsigned integers, unique within the list. **S** (5/5) <!-- EXT-14.6-003 -->
- No id is a placed-instance database id (0 of 1,910). **O** <!-- EXT-14.6-006 -->
- Most ids resolve to a current Hierarchy part occurrence: 1,747 of 1,910 overall. **O** <!-- EXT-14.6-005 -->

| Design | Ids | Resolve to a part occurrence | Unstuffed refdes included | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| LAUNCHXL-CC1310 | 140 | 139 | 23 (including `MH5`, `R46`-`R49`, `R51`) | **O** | <!-- INT-11.4-003 --> |
| reServer Industrial J401 | 1541 | 1434 | 245 | **O** | <!-- INT-11.4-004 --> |
| reServer J2032 | 30 | 0 | 0 | **O** | <!-- INT-11.4-005 --> |
| ELEMENT-DVT (corpus) | 59 | 35 | 1 (`ANT1`) | **O** | <!-- INT-11.4-006 --> |

- `BOMPartData` is not the variant's stuffed list: where its ids resolve they include parts the variant leaves off, and one design's ids resolve to nothing. Reading it as a stuffed list would contradict the group streams. **O** <!-- INT-11.4-002 INT-11.4-006 -->

### 14.8 `CIS/VariantStore/BOM/<variant>/BOMAmbugity`

Every `BOMAmbugity` in our data is the 4 bytes `00 00 00 00`: a zero `body_len` and an empty body. **S** (5/5) <!-- EXT-14.7-003 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `body_len` | Stream size - 4; always 0 | **S** (5/5) | <!-- EXT-14.7-001 --> |
| +0x04 | bytes[0] | `records` | Empty | **S** (5/5) | <!-- EXT-14.7-002 --> |

EXT's populated form is in Unverified.

### 14.9 `CIS/VariantStore/Groups/GroupsDataStream`

`GroupsDataStream` is a length-prefixed index of the groups. Each record is a run of 0xB0-terminated fields followed by one more 0xB0. **S** (5 non-empty streams, 14 records) <!-- EXT-14.8-001 -->

```
body   := record*
record := name B0  count B0  ( sub B0 ){count}  B0
```

- Every observed record is `name B0 0 B0 B0`, and the bodies are consumed exactly; the `count` > 0 branch never occurs. **S** (14 records) <!-- EXT-14.8-002 -->
- `count` is the record's second field; it is 0 in all 14 records and never 1. **S** <!-- EXT-16.11.5-001 EXT-14.8-004 EXT-16.11.5-004 -->
- Group names are unique per file, non-empty, and never `Common`. **O** (14) <!-- EXT-14.8-003 -->
- A non-empty body ends in `B0 B0`; an empty body has length 0. **S** (5 non-empty, 16 empty) <!-- EXT-14.8-006 -->
- Every count-0 group has a membership stream `Groups/<g>/<g>`; 1 also has `UpdateStorageGroupDataStream`; nothing else occurs. **O** (14/14) <!-- EXT-14.8-008 EXT-16.11.5-002 -->

### 14.10 Membership streams `Groups/<group>/<group>`

A membership stream is a length-prefixed list of `occurrence_id~status` entries after a leading flag. **S** (14 streams, 742 entries, 1 zero-length entry) <!-- EXT-14.9-001 INT-11.1-003 -->

```
body  := flag B0 ( entry B0 )*
entry := occurrence_id '~' status
       | <empty>                          ; zero-length entry
```

| Field | Meaning | Evidence | Ids |
| --- | --- | --- | --- |
| `flag` | Decimal `0` (13 streams) or `1` (1); never contains `~`; not an occurrence. It is `1` exactly when an `UpdateStorageGroupDataStream` sits in the same storage | **O** (14/14) | <!-- EXT-14.9-002 EXT-16.11.4-002 EXT-16.11.4-003 EXT-16.11.4-004 INT-11.1-004 --> |
| `occurrence_id` | A Hierarchy part-occurrence id (717 of 742; §14.15) | **E** | <!-- EXT-14.9-003 --> |
| `status` | Decimal after `~`: `0` (431 entries) or `1` (311) | **O** | <!-- EXT-14.9-004 EXT-16.11.4-005 --> |
| empty entry | One zero-length field between two B0 bytes, in reServer J2032 `DNP` at token 77 of 79, with 2 entries after it | **O** (1) | <!-- INT-11.1-011 --> |

| `status` | Meaning | Evidence | Ids |
| --- | --- | --- | --- |
| `1` | The group fits the part: all 132 LAUNCHXL status-1 refdes are in fitted (quantity > 0) BOM rows | **E** (132/132) | <!-- EXT-14.9-006 EXT-16.11.4-006 INT-11.1-006 --> |
| `0` | The group leaves the part off: LAUNCHXL status-0 parts not overridden are exactly the 25 DNM quantity-0 rows | **E** (25/25) | <!-- EXT-14.9-007 EXT-16.11.4-007 INT-11.1-005 --> |

- Every non-empty body ends in 0xB0, and every non-empty entry carries a status (742/742). **S** <!-- EXT-14.9-009 EXT-14.9-010 -->
- Each group uses one status throughout: `DNM`, `DNP`, `NL` write `0`; `RF`, `XDS`, `DebuggerIF`, `Peripherals`, `STUFFED` write `1`. The name suggests the status, but the status is what a reader must use. **O** (14/14 groups) <!-- INT-11.1-008 -->
- No occurrence is named by two groups. **O** (5 designs, 14 groups) <!-- INT-11.1-009 -->
- A reader must read through the empty entry, since entries continue after it. **O** <!-- INT-11.1-011 -->
- Reader guidance, as warranted by the data: skip empty entries (1 exists) and tolerate ids that match no current occurrence (25 exist). No entry without `~status` exists. **O** <!-- EXT-14.9-011 -->

### 14.11 `Groups/<group>/UpdateStorageGroupDataStream`

`UpdateStorageGroupDataStream` is a length-prefixed sequence of records, each giving one listed occurrence's full CIS property row. Only one exists in our data: reServer Industrial J401, group `DNP`, next to `Groups/DNP/DNP`, non-empty, 3 records. **O** (1 stream) <!-- EXT-14.10-001 EXT-14.10-007 -->

```
body    := record+
record  := occurrence_id B0 columns C0 values '~'
columns := name ( '^' name )*
values  := value ( '^' value )*
```
<!-- EXT-14.10-002 -->

| Field | Meaning | Evidence | Ids |
| --- | --- | --- | --- |
| `occurrence_id` | A Hierarchy part occurrence that is a member of the sibling membership stream; the occurrences' refdes (`C185`, `C191`, `TP37`) equal the refdes `pstxprt` gives each record's `Name` | **E** (3/3) | <!-- EXT-14.10-003 --> |
| `columns` | 14 `^`-separated property names, the same in every record, ending in `Name`: `Part Number`, `Part type`, `Value`, `Description`, `Power`, `Tolerance`, `Schematic Part`, `PCB Footprint`, `Implementation`, `Source Library`, `Source Package`, `Graphic`, `Power Pins Visible`, `Name` | **O** (3/3) | <!-- EXT-14.10-004 --> |
| `values` | One value per column; the last (`Name`) is `INS` + digits; no empty value seen | **O** (3/3) | <!-- EXT-14.10-005 --> |
| `~` | Terminates each record; the single body ends with it | **O** | <!-- EXT-14.10-006 --> |

- `Name` is a Library string; its string index is stored in the occurrence's PlacedInstance (20 or 28 bytes before its dbId), and `pstxprt`'s `C_PATH` INS number for the same refdes equals it. **E** (3/3) <!-- EXT-14.10-008 -->
- No 0xB0, 0xC0 or `~` occurs inside the column or value text. **O** <!-- EXT-14.10-009 -->
- `~` is not part of the last value; the digits after it begin the next record's `occurrence_id` (2 boundaries). **O** <!-- EXT-14.10-010 -->
- The stream is not the member list: it has 3 records against `DNP`'s several hundred entries, and its ids are members. Its values (`0.7pF`, `C0402`) look like the part's own properties. **O** <!-- INT-11-008 -->

### 14.12 `CIS/CISSchematicStore/CISSchematicStream`

A u32 `count` followed by `count` `lstr` schematic names. **S** (21 streams) <!-- EXT-14.11-002 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `count` | 0 (20 streams) or 1 (1) | **S** (21/21) | <!-- EXT-14.11-001 --> |
| +0x04 | `lstr` x `count` | `names` | The one non-empty stream lists the schematic folder name | **S** | <!-- EXT-14.11-002 --> |
| after `names` | | end | End of stream | **S** (21/21) | <!-- EXT-14.11-003 --> |

- With `count` = 0 the stream is 4 bytes. **S** (20/20) <!-- EXT-14.11-004 -->
- The single listed name equals a `Views` folder; EXT's "need not" never occurs. **O** (1) <!-- EXT-14.11-005 -->

### 14.13 `Views/<schematic>/CISSchematic/VariantOCCStorage/VariantOCCStream`

The only `VariantOCCStream` in our data is 8 zero bytes. **O** (1 stream) <!-- EXT-14.12-003 EXT-16.11.6-002 -->

| Offset | Type | Name | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `w0` | 0; meaning unknown | **O** (1/1) | <!-- EXT-14.12-001 --> |
| +0x04 | u32 | `w1` | 0; meaning unknown | **O** (1/1) | <!-- EXT-14.12-002 --> |

### 14.14 `Views/<schematic>/CISSchematic/SchematicInfoStorage/`

#### `SchematicInfoStream`

The layout of `SchematicInfoStream`: u32 `count`, `count` `lstr` page names, end of stream. **S** (1 stream: 23 names) <!-- EXT-14.13.1-001 -->

- `count` is 23. **O** <!-- EXT-14.13.1-002 --> EXT lists 0 to 26; only 23 occurs, the rest stay Unverified (§Unverified).
- The 23 names equal the 23 sibling `<page>` streams. **O** <!-- EXT-14.13.1-003 -->
- Each name is a page stream `Views/<schematic>/Pages/<page>`; 9 pages have no snapshot. **O** (23/23) <!-- EXT-14.13.1-005 -->
- Names use the container's escaped form: 4 of the 23 contain U+0002, and all 23 equal their `Views/<s>/Pages/<p>` directory names (6 page streams there carry U+0002). This list is the exception to plain page names. **O** (1 file) <!-- EXT-1.1.3-012 -->

#### `<page>` (per-page instance snapshot)

```
stream   := u32 record_count  Record[record_count]
Record   := u32 instance_db_id
            StrList group_names
            StrList group_values
            u32 table_count  Table[table_count]
            u32 marker
Table    := StrList property_names  StrList property_values
StrList  := u32 n  lstr[n]
```

The grammar consumes all 23 snapshot streams (122 records) exactly, and each stream ends right after its last record. **S** <!-- EXT-14.13.2-001 EXT-14.13.2-010 -->

| Field | Type | Meaning | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `record_count` | u32 | 1 to 32 in 23 streams | **S** | <!-- EXT-14.13.2-002 --> |
| `instance_db_id` | u32 | Database id of a placed instance on the same-named page | **O** (122/122) | <!-- EXT-14.13.2-003 EXT-14.14.4-001 --> |
| `group_names` | StrList | Length 1, naming the current group `DNP` | **O** (122/122) | <!-- EXT-14.13.2-004 --> |
| `group_values` | StrList | Same length as `group_names`; every value `1`; meaning unknown | **O** (122/122) | <!-- EXT-14.13.2-005 EXT-16.11.6-003 --> |
| `table_count` | u32 | Equals the length of `group_names` | **O** (122/122) | <!-- EXT-14.13.2-006 --> |
| `property_names` | StrList | Lengths 9 (119 tables), 8, 7 and 5 (1 each) | **O** (122) | <!-- EXT-14.13.2-007 --> |
| `property_values` | StrList | Same length as `property_names`; no empty value seen | **O** (122/122) | <!-- EXT-14.13.2-008 --> |
| `marker` | u32 | Always 1; meaning unknown. Every record has one table, so whether it follows all tables or each table cannot be told apart | **S** (122/122) | <!-- EXT-14.13.2-009 EXT-16.11.6-004 --> |

### 14.15 Occurrence ids, instance names and variant evaluation

- Membership and substitution `occurrence_id` values are Hierarchy part-occurrence ids: 717 of 742 membership ids and 3 of 3 substitution ids match one. They are a numbering of their own: 0 of 742 equal a placed-instance dbId, and 0 occurrence ids equal any PST `C_PATH` INS number (LAUNCHXL, reServer J401, J2032). **E** <!-- EXT-14.14.1-001 INT-11.3-001 --> A u32 search of every stream of the 9 fixture designs with `pstxprt` finds 5 of 6,030 INS numbers, at scattered places (a CutiePi package, reComputer J401 pages, one reServer J401 Hierarchy offset), so INT's "finds nothing" holds only up to these incidental hits. **E**
- An id resolves through the Hierarchy part-occurrence record to its reference; when that reference is empty, the refdes is the inline one on the PlacedInstance the record's dbId names. Every resolved group occurrence in the 4 group designs takes its refdes from the page (35, 157, 291, 77 occurrences); the results match the LAUNCHXL BOM (25/25) and `pstxprt` (289/291, 77/77). **E** <!-- INT-11.3-002 INT-11.3-003 -->

```
occurrence id  --Hierarchy part occurrence-->  reference, or dbId --PlacedInstance-->  refdes
```

- Resolving the join therefore needs the page streams. **O** <!-- INT-11.3-005 -->
- Some ids match no current occurrence and must be kept and skipped: 25 of 742 membership ids (ELEMENT-DVT 24: `NL` 11, `STUFFED` 13; reServer J2032 `DNP` 1), and all 30 `BOMPartData` ids of reServer J2032. **O** <!-- EXT-14.14.1-003 -->
- A substitution record's `Name` (`INS` + digits) is a Library string that the occurrence's PlacedInstance refers to as its name; it matches `pstxprt` `C_PATH` INS and is never the dbId (`INS28377935` vs dbId 28377942, `INS28377948` vs 28377955, `INS31578612` vs 31578617). **E** (3/3) <!-- EXT-14.14.2-001 -->
- A key `<group>` maps to `Groups/<group>/<group>` (14/14). **E** <!-- EXT-14.14.3-002 -->
- **Variant rule:** for a variant, a part is unfitted when some composed key lists it with status `0` and no composed key lists it with status `1`. On LAUNCHXL `Standard` this gives 25 unfitted parts, exactly the 25 DNM quantity-0 BOM rows, and all 132 status-1 parts are in fitted rows. The rule ignores `Common`, and that reproduces the BOM. **E** <!-- EXT-14.14.3-005 INT-13.6-002 -->
- Unfitted counts by design: LAUNCHXL `Standard` 25, reServer J401 `version A` 291, reServer J2032 `Main` 77, ELEMENT-DVT `RD88MW302QFN88V2` 1. **E** <!-- INT-11.5-001 -->
- Only the state is read, never the group name, so a group with any name works; only states `0` and `1` occur (742 entries) and any other is ignored. **O** <!-- INT-11.1-010 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| Most `BOMPartData` ids match no current occurrence | EXT §14.6 | 1,747 of 1,910 match (139/140, 1434/1541, 35/59); only reServer J2032 matches none (0/30) | **O** | <!-- EXT-14.6-005 --> |
| Presence of `CIS/` or `CISSchematic/` means the design uses CIS variants and BOM data | EXT §17.4 | 16 of 21 CIS files carry an empty store; 5 hold variants or groups | **O** | <!-- EXT-17.4-002 --> |

### Unresolved conflicts

| Topic | INT reading | EXT reading | What our data shows | What would settle it | Ids |
| --- | --- | --- | --- | --- | --- |
| Empty membership entry | A section separator; occurrences continue after it (INT §11.1) | Meaning unknown (EXT §14.9) | 1 empty entry in 14 streams (reServer J2032 `DNP`, token 77 of 79), 2 entries after it | Designs with more empty entries, or a Capture edit that creates one | <!-- INT-11.1-007 EXT-14.9-005 EXT-14.oq-003 --> |
| `UpdateStorageGroupDataStream` | An edit log, not the member list (INT §11) | Per-part property substitutions (EXT §14.10) | Not the member list; one full CIS property row per member occurrence; nothing marks it a log; the values look like the part's own properties, so substitution is not established either | A design where a group overrides a part's properties, compared with the part's own | <!-- INT-11-008 EXT-14.10-001 --> |

### Parser divergences

| Parser behaviour | What the files show | Impact | Ids |
| --- | --- | --- | --- |
| `parseVariantGroup` (`variant-store.ts:88`) drops an entry without `~` | EXT advises reading it as present; no such entry exists in our data | None on the corpus | <!-- EXT-14.9-011 --> |

Resolved: the parser no longer has a `VariantNames` reader; the stream is not read (no production code needed it). <!-- EXT-14.3-003 EXT-14.3-005 EXT-14.3-012 INT-11-015 --> |

### Unverified

- *unverified*: A part inside a reused block has one occurrence per placement, each with its own id and refdes, so a group can unfit one placement and keep the others. No design with a variant group has a block occurrence (0 in all 4); the test `variant-store.test.ts` 'unstuffs one placement of a reused block' uses synthetic data. <!-- INT-11.3-004 -->
- *unverified*: Sub-groups. A group record with `count` 2, 3 or 5 (never 1) is a group with that many sub-groups; its `sub` names are non-empty and `UnDefined` is never stored. Every sub-group storage is listed in its record and every listed sub-group has one. Such a group has no `Groups/<group>/<group>`; instead `Groups/<group>/<sub>/<sub>` holds membership for each sub-group, with an optional `Groups/<group>/<sub>/UpdateStorageSubGroupDataStream` and no group-level substitution stream. A composition key `<group>_<sub>` (underscore) selects `Groups/<group>/<sub>/<sub>`; a key never names a group that has sub-groups. No file has a sub-group: 0 sub-group storages and 0 `UpdateStorageSubGroupDataStream` in 21 CIS files. <!-- EXT-1.2.4-011 EXT-1.2.4-013 EXT-14.5-006 EXT-14.5-007 EXT-14.8-004 EXT-14.8-005 EXT-14.8-007 EXT-14.8-009 EXT-14.14.3-003 EXT-16.11.3-004 EXT-16.11.5-003 EXT-14.10-001 -->
- *unverified*: The hyphen form `<group>-<sub>` appears in `VariantNames`, SchematicInfo group names and ambiguity scope keys, and is the hyphen form of a sub-group key. Hyphenated names do occur in `VariantNames` (`Testpoint-DNP`, `Testpoint-P`) but name no sub-group; SchematicInfo group names are never hyphenated (122 = `DNP`). <!-- EXT-16.11.3-005 EXT-14.3-008 EXT-14.13.2-004 -->
- *unverified*: `UnDefined` is a reserved ambiguity scope key, the implicit single sub-group of a group without sub-groups (`<group>-UnDefined`), never stored in `GroupsDataStream`. It occurs nowhere. <!-- EXT-14-008 EXT-16.11.3-006 -->
- *unverified*: `Common` denotes every part that is a member of no group. Its meaning is untestable; an evaluation that ignores `Common` reproduces the LAUNCHXL BOM (25/25), consistent with it. <!-- EXT-14.14.3-004 EXT-14-007 EXT-16.11.3-002 -->
- *unverified*: Populated `BOMAmbugity`: `records := record ( '~' record )*` with no trailing `~`; `record := scope_key '^' occurrence_id '^' part_status`, exactly three fields. `scope_key` is Latin-1 `<group>`, `<group>-<sub>` (`<group>-UnDefined` for a group without sub-groups) or `Common`; `occurrence_id` is a decimal Hierarchy occurrence id, `0` with `Common`; `part_status` is `0` or `1` as in memberships. Here `^` separates items and `~` separates records. No populated `BOMAmbugity` exists (5/5 are 4 zero bytes). <!-- EXT-14.7-004 EXT-14.7-005 EXT-14.7-006 EXT-14.7-007 EXT-14.7-008 EXT-16.11.4-009 EXT-14.2.2-004 EXT-14.2.2-005 -->
- *unverified*: Empty bodies: a composition and a `BOMPartData` are `FB` (size 5), a membership is `B0` (size 5, flag absent, never with a substitution stream), an `UpdateStorageGroupDataStream` is zero-length (size 4, group level only). None occurs: 0 empty compositions, `BOMPartData` or memberships, and the only substitution stream is non-empty. <!-- EXT-14.2.3-003 EXT-14.2.3-004 EXT-14.2.3-005 EXT-14.2.3-007 EXT-16.11.2-002 EXT-16.11.2-003 EXT-16.11.2-004 EXT-14.2.2-006 -->
- *unverified*: A composition stream can lack a valid `body_len`; keep it unchanged and treat its content as unknown. 0 of 5 compositions lack one. <!-- EXT-14.2.1-004 -->
- *unverified*: Known ranges beyond our data: `BOMDataStream` `count` 2 to 6 with names in variant order; `VariantNames` `count` above 14 up to 93 (only 0, 5, 9, 11, 14 occur) and a trailer matching nothing current; composition `count` 1, 3 to 5 and 7 to 10; `SchematicInfoStream` `count` other than 23 within 0 to 26; snapshot `record_count` 0 (a 4-byte stream) up to 93; `group_names` lengths 2 to 4 including `Common` and names no longer existing; `property_names` lengths 6 to 19 (our data also has 5, outside it); substitution values may be empty; snapshot property values may be empty; a `CISSchematicStream` name need not equal a `Views` folder. <!-- EXT-14.4-002 EXT-14.4-003 EXT-1.2.4-007 EXT-14.3-009 EXT-14.13.2-002 EXT-14.13.2-004 EXT-14.13.2-007 EXT-14.10-005 EXT-14.13.2-008 EXT-14.11-005 EXT-14.3-003 EXT-14.5-002 EXT-14.13.1-002 -->
- *unverified*: When a snapshot table has a `Name` property, its value is an instance name that need not equal the current placement's name. No snapshot table has a `Name` property (0 of 122). <!-- EXT-14.13.2-011 -->
- *unverified*: A `SchematicInfoStream` name can be empty; its sibling per-page stream then has a zero-length directory-entry name, the same content form as other snapshots, and no page, since page names are never empty. Readers should expect it, its path ending in `/`, and not resolve it to the parent storage. No empty name occurs in the only list or storage (1 file, 23 snapshot streams). <!-- EXT-14.13.1-006 EXT-14.13.1-007 EXT-1.1.3-015 EXT-1.2.3-008 -->

### Open questions

- What `VariantNames` is, with its mix of group names, `Common`, `bom-<v>` helpers, unmatched names and duplicates (5/5 lists); what its trailer is (a group name in 4 of 21); whether 900 is a version (900 in 21/21). <!-- EXT-14.3-002 EXT-14.3-011 EXT-14.oq-001 -->
- Whether `BOMPartData` ids are occurrence ids in every design. Most are: 1,747 of 1,910 resolve to part occurrences and 0 to dbIds (**O**, partial), but reServer J2032's 30 resolve to nothing. <!-- EXT-14.6-004 EXT-14.oq-002 -->
- Whether unmatched occurrence ids are stale entries left after renumbering. 25 membership ids and 163 `BOMPartData` ids are unmatched; renumbering is not shown. <!-- EXT-14.14.1-004 -->
- What membership statuses other than `0` and `1` mean; only those two occur in 742 entries. <!-- EXT-14.9-008 EXT-16.11.4-008 -->
- What `VariantOCCStream` holds when not all zero; the only one is all zero. <!-- EXT-14.12-004 EXT-14.oq-004 -->
- What SchematicInfo `group_values` and `marker` mean; both are 1 in 122/122. <!-- EXT-14.oq-005 -->
- Whether a populated `BOMAmbugity` uses anything beyond `~`-separated three-field records; none is populated. <!-- EXT-14.oq-006 -->
- What layout a composition without a valid `body_len` uses; none exists. <!-- EXT-14.oq-007 -->
- Whether the substitution column list is fixed by the format or by the CIS database configuration. The one stream's 14 columns are CIS part properties; undecidable from one stream. <!-- EXT-14.oq-008 -->
- Why an empty-named CIS per-page stream would exist; none exists in the only `CISSchematic` storage. <!-- EXT-1.oq-004 -->

<!-- meta: EXT-0.4-008 EXT-14-001 EXT-14-002 EXT-14.14.3-001 EXT-16.11.1-001 EXT-16.11.2-001 EXT-16.11.3-001 EXT-16.11.4-001 INT-11-003 INT-11.3-006 -->

Parser coverage: the parser reads only `Groups/<g>/<g>` and `BOM/<v>/<v>` (`variant-store.ts`), applies the variant rule, and joins ids through the Hierarchy and page streams; it lists variants from the `BOM/<v>/<v>` paths and does not read `VariantNames` in production, `BOMDataStream`, `GroupsDataStream`, `BOMPartData`, `BOMAmbugity`, `UpdateStorageGroupDataStream`, `CISSchematicStore` or `Views/<s>/CISSchematic`. <!-- INT-2-020 INT-13.2-004 -->

---

## 15. HSObjects, coverage and remaining notes

This chapter holds the `HSObjects` stream, the smaller root streams no other chapter owns, the parser's measured coverage against Capture's own exports, Do Not Stuff detection in value strings, and the areas the INTERNAL spec listed as unknown, each with what our data now shows about it.

### 15.1 `HSObjects`: S

`HSObjects` is a stream in the root storage of the compound file. It is the only entry of that name in every file that has one (109 files). <!-- EXT-15.1-001 --> It is present in all 105 version-3 designs and in 4 of the 15 pre-version-3 designs; the other 11 pre-version-3 designs (Library major below 3) have no `HSObjects`. <!-- EXT-15-001 EXT-15.1-002 -->

Every `HSObjects` stream is exactly 16 bytes **S** (109/109) <!-- EXT-15.1-003 --> and every byte is zero **S** (109/109). <!-- EXT-15.1-004 --> This empty form is the only form in our data: both tables are empty in every file that has the stream (105/105 version 3, 4/4 pre-version 3). <!-- EXT-15-002 EXT-15.3-001 -->

The stream's general shape is two counted tables followed by two terminal words: `u32 named_count`, `named_count` named rows, `u32 detail_count`, `detail_count` detail rows, `u32 terminal0`, `u32 terminal1`, end of stream. The 16 zero bytes of every real file are consistent with this shape and with `u32` counts, but no file has a row, so the row layouts and the width of a populated count are not proved. <!-- EXT-15.2-001 EXT-2.1.1-006 --> The terminal words are 0 in 105/105 version-3 files; the fixed row suffixes never occur, since no table is populated. <!-- EXT-2.8-006 -->

The empty form:

| Offset | Type | Name | Value | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | u32 | `named_count` | 0; the named rows that would follow are absent | **S** (109/109) | <!-- EXT-15.2-002 EXT-15.2-003 EXT-15.3-002 --> |
| +0x04 | u32 | `detail_count` | 0; the detail rows that would follow are absent | **S** (109/109) | <!-- EXT-15.2-004 EXT-15.2-005 EXT-15.3-003 --> |
| +0x08 | u32 | `terminal0` | 0 | **S** (109/109) | <!-- EXT-15.2-006 EXT-15.3-004 --> |
| +0x0C | u32 | `terminal1` | 0; the stream ends here | **S** (109/109) | <!-- EXT-15.2-007 EXT-15.2-008 EXT-15.3-005 --> |

No other stream is named `HSObjects` or holds HS objects **O** (109 files). <!-- EXT-15.6-001 --> No stream contains the text `HSObjects` **O**. Whether any stream refers to an `HSObjects` row by value, or a row to another stream, cannot be tested while every table is empty. <!-- EXT-15.1-005 EXT-15.6-002 -->

### 15.2 Other root streams and storages

**`LayoutReuse`: S.** The `LayoutReuse` storage is optional: present in 5 of 105 designs, absent in 100. In all 5 it holds exactly one stream, `ReuseSchematics.txt`. <!-- EXT-1.2.2-022 --> That stream is 0 bytes in 4 of the 5 files. In the fifth it holds two text lines, each of the form `<DESIGN>.DSN : <folder>`, and both folders named are schematic folders of that same design (new). <!-- EXT-1.2.4-016 -->

**`DsnStream`: S.** `DsnStream` opens with a DesignProperties record (type 4) carrying one full prefix whose stop is the end of the stream, which is also the end of its preamble (102/102). <!-- EXT-3.7-006 --> In 9 files the preamble carries an extension: each is one kind-7, version-6 sub-record holding JSON text (it starts with `{`) followed by three `00` bytes, and it ends exactly at the end of the stream (9/9). <!-- EXT-3.4-015 EXT-2.3.6-004 -->

**NetGroup records: S.** NetGroup (type 103) frames occur only in `NetBundleMapData`, and their count equals the stream's `bundle_count` in 102/102 files (no bundles in 95, 8 frames in 7). <!-- EXT-3.12-002 -->

### 15.3 Coverage against Capture's exports: E

The parser's output is compared with Capture's own netlist exports (`pstxnet.dat`, `pstchip.dat`, `pstxprt.dat`). Today's coverage report covers 18 fixture designs: 10 ship `pstxnet.dat` and are measured against Capture (**E**); 8 are compared with a snapshot of this parser's own output, which shows self-consistency only. INT measured 11 designs (those 10 plus the `BEAGLEBONEBLK_C3_BEAGLEBOARD` snapshot); its figures are kept below as historical values, and each reproduces exactly on that scope. `Nets` and `Comps` match on names alone, so a net with the wrong pins would still count as covered; `Conn` compares the full `{refdes.pin}` set of every net present in both netlists and catches that case **T** (`scripts/lib/dsn-vs-dat-coverage.ts`). <!-- INT-13.5-010 -->

Aggregate (`checks/misc/cov11.ts`):

| Measure | 18 designs today | 10 measured against Capture | INT, 11 designs (historical) | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| Nets | 8,985/8,985 (100%); every expected net present, none invented | 4,601/4,601 | 4,936/4,936 | **E** | <!-- INT-13.5-002 --> |
| Conn | 8,985/8,985 (100%); 0 nets with a differing `{refdes.pin}` set | 4,601/4,601 | 4,936/4,936 | **E** | <!-- INT-13.5-003 --> |
| Components | 10,552/10,552 (100%) | 6,360/6,360 | 6,774/6,774 | **E** | <!-- INT-13.5-004 --> |
| Value | 10,548/10,548 (100%); 4 matches are case-transformed, all in BeagleBoard-xM | 6,360/6,360 | 6,774/6,774 | **E** | <!-- INT-13.5-005 --> |
| PinNum | 39,991/39,991 (100%) | 22,234/22,234 | 24,001/24,001 | **E** | <!-- INT-13.5-006 --> |
| PinName | 12,039/12,039 (100%) | 7,300/7,300 | 8,105/8,105 | **E** | <!-- INT-13.5-007 --> |
| DNS | 888/888 (100%) | 456/456 | 493/493 today; INT's 456/456 is the 10-design Capture count | **E** | <!-- INT-13.5-009 --> |
| MPN | 1,510/6,935 (21.8%), 935 substring matches; see below | 935/6,360 (14.7%) | 1,335/6,760 (19.7%) today; INT recorded 5,870/6,774 (86.7%) | **E** | <!-- INT-13.5-008 --> |

PinNum, PinName and Value all read 100%, so none of the unknown areas of 15.6 costs anything measurable today **E**. <!-- INT-13.1-001 -->

Each of the 11 designs, and each of the 18 today, reads 100% on Nets, Conn, Comps, Value, PinNum and PinName (**E** for the 10 measured against Capture); only MPN and DNS vary between designs, and DNS is either 100% or not applicable. <!-- INT-13.5-011 --> DNS reads 100% on every design that has Do Not Stuff parts, from both of its sources (the marker in a part's value and the variant store): BeagleBoard-xM 38, CutiePi 22, CC13xx 5, LAUNCHXL-CC1310 25, reServer J401 289, reServer J2032 77 (456 in all) **E**. The snapshot designs also read 100% (BEAGLEBONEBLK_C3_BEAGLEBOARD 37, both OC_CONNECT1 designs 158 each, HB1A-AAFM 59, meta_carrier_sch_rev1 20), as self-consistency only. <!-- INT-13.5-023 -->

Per design, today and as INT recorded it:

| Design | MPN today | MPN in INT | DNS today | DNS in INT | Ids |
| --- | --- | --- | --- | --- | --- |
| BeagleBoard-xM | 0/438 (0.0%) | 98.6% | 38/38 | 100% | <!-- INT-13.5-012 --> |
| BEAGLEBONEBLK_C3 | 36/413 (8.7%) | 100.0% | n/a | n/a | <!-- INT-13.5-013 --> |
| BEAGLEBONEBLK_C3_BEAGLEBOARD (snapshot, self-consistency only) | 400/400 (100%) | 100.0% | 37/37 | n/a | <!-- INT-13.5-014 --> |
| CutiePi | 0/296 (0.0%) | 96.6% | 22/22 | 100% | <!-- INT-13.5-015 --> |
| CC13xx | 4/48 (8.3%) | 2.1% | 5/5 | 100% | <!-- INT-13.5-016 --> |
| LAUNCHXL-CC1310 | 19/143 (13.3%) | 9.8% | 25/25 | 100% | <!-- INT-13.5-017 --> |
| reComputer J201 | 218/1,123 (19.4%) | 100.0% | n/a | n/a | <!-- INT-13.5-018 --> |
| reComputer J202 | 137/707 (19.4%) | 100.0% | n/a | n/a | <!-- INT-13.5-019 --> |
| reComputer J401 | 132/728 (18.1%) | 100.0% | n/a | n/a | <!-- INT-13.5-020 --> |
| reServer J401 | 231/1,631 (14.2%) | 95.6% | 289/289 | 100% | <!-- INT-13.5-021 --> |
| reServer J2032 | 158/833 (19.0%) | 23.2% | 77/77 | 100% | <!-- INT-13.5-022 --> |

**MPN compares unlike fields.** The DSN path takes the manufacturer part number from the part's property pairs, while the export carries a composite string, so an exact match is not the goal and MPN is not a defect measure. <!-- INT-13.5-024 --> Since schema v2 (PR #199) the netlist reports `mpn` as its own field, split from `internal_pn` and `manufacturer`. The MPN column now scores that stricter field against the export's composite string, so the drop from INT's 86.7% to 19.7% is a change in what is compared and not a parser regression. INT's remark that CC13xx and reServer J2032 stand out as low no longer applies: BeagleBoard-xM and CutiePi now read 0%.

**BEAGLEBONEBLK_C3_BEAGLEBOARD is not measured against Cadence.** It ships no `pstxnet.dat`, so its reference is a snapshot of this parser's own output, and its 100% figures show self-consistency only; the coverage report lists it under designs not measured against Cadence. <!-- INT-13.5-025 -->

### 15.4 Do Not Stuff markers in value strings

Some Cadence designs write a Do Not Stuff or no-connect marker into the component value itself (`100nF,DNI`, `10K_NC`). The DSN path strips the marker to give the clean value, and Value matches the export on 6,774/6,774 components **E** (`component-builder.ts:134`). <!-- INT-13.7-002 --> The marker patterns it recognises, case-insensitively, are:

| Form | Patterns | Evidence | Ids |
| --- | --- | --- | --- |
| Comma before | `,DNI` `,DNP` `,DNM` `,DNS` `,NC` (spaces allowed after the comma) | **E** | <!-- INT-13.7-003 --> |
| Comma after | `DNI,` `DNP,` `DNM,` `DNS,` | **E** | <!-- INT-13.7-004 --> |
| Suffix | `_NC` at the end of the value | **E** | <!-- INT-13.7-005 --> |
| Case | every pattern matches case-insensitively | **E** | <!-- INT-13.7-006 --> |

This regular expression (`DNS_MARKERS`) lives in `component-builder.ts:134`. It is separate from `stripDnsMarkers` (`circuit-traversal.ts:218`), which recognises a wider set (`DNF`, `NF`, and phrases such as `DO NOT POPULATE`) and is used by the Altium path and the DAT parser; KiCad uses neither. <!-- INT-13.7-007 --> Value now reads 100% on every fixture (18/18 in the coverage report). INT recorded that the cleanup raised BeagleBoard-xM value coverage from 90.9% to 99.1% when it landed; that historical step cannot be rerun. <!-- INT-13.7-008 -->

DNS detection on the DSN path reads the marker a part's value carries with `hasDnsValueMarker` (`circuit-traversal.ts:183`) before `cleanDnsFromValue` removes it **T**. The Altium path imports the same function. The DAT path uses a different matcher, `isDnsComponent` and `stripDnsMarkers` over `DNS_PATTERN`, which also accepts `NF`. <!-- INT-13.6-001 --> `test/integration/golden.test.ts` compares the DNS flags of the DSN and DAT paths on every oracle design and asserts that none the DAT path flags is missed: 6,360 components over 10 designs, 0 missed on each (DSN-only flags, 0 to 174 per design, are allowed) **T**. <!-- INT-13.6-004 -->

### 15.5 Data on EXT's remaining open questions

The device pin-map flag byte is 127 on 32,116 of 32,254 Cache device slots; its bit 7 is the Pin Ignore flag. Pin-word bit 15 is set on 3,188 of the 60,258 placed-part pins on the 450 fully walked pages. Placed-part display modes seen are 0, 1, 2 and 3; none is 16 or above **O**. The meanings EXT asks about stay open. <!-- EXT-16.oq-003 -->

### Unverified

- *Unverified:* the `CCSStorage` storage is optional and holds an embedded database with its index. No real file has a `CCSStorage` (0/105). <!-- EXT-1.2.2-021 -->
- *Unverified:* `CCSStorage/___IndexInfoForMiscStorage` is a one-row index stream. No real file has it. <!-- EXT-1.2.4-014 -->
- *Unverified:* `CCSStorage/<n>` holds the Base64 text of an embedded database. No real file has it. <!-- EXT-1.2.4-015 -->
- *Unverified:* name and description lengths in index streams (`___IndexInfoForMiscStorage`, constraint or CCS) are `u32`. No real file has such a stream; a design with a constraint archive would settle it. <!-- EXT-2.1.1-007 -->
- *Unverified:* files that carry a constraint archive, including differential-pair and Xnet objects, still store the empty `HSObjects` form, so HS objects are not a copy of the constraint objects. No real file carries a constraint archive (no `Views/*/Constraint/DCF` or `Metadata_v3`). <!-- EXT-15.1-006 -->
- *Unverified:* an `HSObjects` count is invalid if its rows cannot fit in the bytes that remain; a stream shorter than 16 bytes, or a 17-byte zero stream, is malformed. No malformed stream exists to test. <!-- EXT-15.2-009 EXT-15.3-007 -->
- *Unverified:* a named row is at least 30 bytes (all strings empty) and must be followed by 12 bytes (`detail_count` and both terminals); a detail row is at least 62 bytes and must be followed by 8 bytes. No real file has a row. <!-- EXT-15.2-010 EXT-15.2-011 -->
- *Unverified:* the populated `HSObjects` row layouts below. No real file has a populated table (empty form in 109/109).

  Named row (table 1):

  | Offset | Type | Name | Content as EXT states it | Ids |
  | --- | --- | --- | --- | --- |
  | +0x00 | u32 | `w0` | known values 1 to 8, distinct within a stream; meaning unknown | <!-- EXT-15.4.1-001 --> |
  | +0x04 | u32 | `w1` | known values 0 to 8, distinct within a stream; meaning unknown | <!-- EXT-15.4.1-002 --> |
  | +0x08 | lstr | `name` | row name, Latin-1; known lengths 6 and 9 | <!-- EXT-15.4.1-003 --> |
  | next | u32 | `reference_count` | number of reference words that follow; known value 1, other values unsupported | <!-- EXT-15.4.1-004 --> |
  | next | u32[`reference_count`] | `references` | each equals the `identity` word of exactly one detail row | <!-- EXT-15.4.1-005 --> |
  | next | lstr | `s1` | known value empty; meaning unknown | <!-- EXT-15.4.1-006 --> |
  | next | lstr | `s2` | known value empty; meaning unknown | <!-- EXT-15.4.1-007 --> |
  | next | 5 bytes | `suffix` | always `00 68 00 00 00`; opaque | <!-- EXT-15.4.1-008 --> |

  Detail row (table 2):

  | Offset | Type | Name | Content as EXT states it | Ids |
  | --- | --- | --- | --- | --- |
  | +0x00 | u32 | `w0` | consecutive three-digit integers within a stream; row order does not follow them; meaning unknown | <!-- EXT-15.4.2-001 --> |
  | +0x04 | i32 | `w1` | known values 33,907 to 59,099, or -100 | <!-- EXT-15.4.2-002 --> |
  | +0x08 | i32 | `w2` | known values 51,205 to 60,784, or -100; -100 exactly when `w1` is -100 | <!-- EXT-15.4.2-003 --> |
  | +0x0C | u32 | `identity` | row identity, unique within the table; target of exactly one named row's reference | <!-- EXT-15.4.2-004 --> |
  | +0x10 | u32 | `w4` | known values 0 to 75; 0 when `w1` is -100 | <!-- EXT-15.4.2-005 --> |
  | +0x14 | u32 | `w5` | known values 0 to 39; 0 when `w1` is -100 | <!-- EXT-15.4.2-006 --> |
  | +0x18 | i32 | `w6` | `w1 + w4 + 1` when `w1` is not -100, else 0 | <!-- EXT-15.4.2-007 --> |
  | +0x1C | i32 | `w7` | `w2 + w5 + 1` when `w2` is not -100, else 0 | <!-- EXT-15.4.2-008 --> |
  | +0x20 | u32 | `w8` | known value 2; meaning unknown | <!-- EXT-15.4.2-009 --> |
  | +0x24 | u32 | `w9` | known value 0; meaning unknown | <!-- EXT-15.4.2-010 --> |
  | +0x28 | lstr | `s0` | known lengths 0, 1, 2, 4; empty when `w1` is -100 | <!-- EXT-15.4.2-011 --> |
  | next | lstr | `s1` | known lengths 0, 1, 3, 4; empty when `w1` is -100 | <!-- EXT-15.4.2-012 --> |
  | next | lstr | `s2` | 9 bytes, the same in every row, when `w1` is not -100; else empty | <!-- EXT-15.4.2-013 --> |
  | next | lstr | `s3` | 2 bytes when `w1` is -100; else empty | <!-- EXT-15.4.2-014 --> |
  | next | lstr | `s4` | 2 bytes when `w1` is -100; else empty | <!-- EXT-15.4.2-015 --> |
  | next | 7 bytes | `suffix` | always `00 00 00 68 00 00 00`; opaque | <!-- EXT-15.4.2-016 --> |

- *Unverified:* every `HSObjects` `lstr` ends in a NUL byte and its length leaves room for the payload and the NUL; string payloads are Latin-1; each row ends in a fixed run of 5 bytes (named) or 7 bytes (detail). No real file has a row. <!-- EXT-15.4.3-001 EXT-15.4.3-002 EXT-15.4.3-003 -->
- *Unverified:* named rows and detail rows pair one to one by value, not by position: each named row's single reference equals the `identity` of exactly one detail row; detail identities are unique; named references are unique; every reference matches a detail row and every detail row is referenced; `named_count` equals `detail_count`; rows of either table may appear in any order. These hold trivially for the 0 = 0 rows of every real file and are untested otherwise. <!-- EXT-15.5-001 EXT-15.5-002 EXT-15.5-003 EXT-15.5-004 EXT-15.5-005 EXT-15.5-006 EXT-15.5-007 -->
- *Unverified:* reference and identity values (four- and five-digit integers) lie in a different range from detail `w0` values. No real file has a row. <!-- EXT-15.5-008 -->
- *Unverified:* before a fix, the DSN path stripped a value's DNS marker without setting the DNS flag, so 65 parts (BeagleBoard-xM 38, CutiePi 22, CC13xx 5) were flagged by one path but not the other. This is a historical count; today both paths agree (0 missed on all 10 oracle designs). <!-- INT-13.6-003 -->

### Open questions

`HSObjects` (no data: the stream is the empty form in 109/109 files):

- Is a named row's `references` a counted list of object identifiers, and can `reference_count` exceed 1 so that one named row groups several detail rows? <!-- EXT-15.4.1-009 EXT-15.oq-002 -->
- Are (`w1`, `w2`) and (`w6`, `w7`) opposite corners of a box of size (`w4 + 1`, `w5 + 1`), with -100/-100 marking a row without a location that carries two 2-byte strings in `s3` and `s4` instead of `s0` to `s2`? In what units? <!-- EXT-15.4.2-017 -->
- What do the named-row words `w0`, `w1` and strings `s1`, `s2` mean, and the detail words `w0`, `w8`, `w9`? <!-- EXT-15.oq-001 EXT-15.oq-003 -->
- What does the constant suffix run encode: one (named) or three (detail) zero bytes, then the `u32` value `0x68` (104), which may be a type code, a length or a flag word? <!-- EXT-15.4.3-004 EXT-15.oq-004 -->
- Do reference and identity values share an identifier space with page objects or Hierarchy objects? <!-- EXT-15.6-003 EXT-15.oq-005 -->
- What does "HS" stand for, what object kind is a row, and which Capture feature populates the stream? <!-- EXT-15.6-004 EXT-15.oq-006 -->

Areas the INTERNAL spec listed as unknown, with what our data now shows and what the parser does:

| Area | Data now | Parser | Ids |
| --- | --- | --- | --- |
| PlacedInstance: 10 unknown bytes per part | **S** contents library index (`u32`, 0 on 14,984/14,988), contents view index (`u32`, 0 on 14,930), primitive word (`u16`, IsPrimitive 2 on 14,984) | skips them (`structures.ts:276`) | <!-- INT-13.1-002 --> |
| Port: 9 trailing bytes | **O** wire id `u32`, one byte, port type `u32` on every port | reads the wire id and attaches the port to that wire (`structures.ts` `parsePort`, `page-groups.ts`) | <!-- INT-13.1-003 --> |
| Global and off-page connector: 5 trailing bytes | **O** wire id `u32` and one byte; the connector sits on that wire's endpoint on 16,238, misses on 196 | reads the wire id and attaches the connector to that wire (`page-parser.ts`, `page-groups.ts`) | <!-- INT-13.1-004 --> |
| Occurrence records: 12 unknown bytes | **S** an independent reader walks every occurrence (18,375) to the exact end of 108/109 Hierarchy streams | skips 8- and 4-byte blocks (`hierarchy-parser.ts:170-235`) | <!-- INT-13.1-005 --> |
| Pin `unknown_int` (pin +0x0A) | **S** the pin's net id: 0 on all 55,363 wired pins, and every non-zero value names a SchematicNet | reads it as `netId` and joins an unwired pin to that net (§7.4) | <!-- INT-13.1-006 --> |
| Page tail after the off-page connectors | **S** lists 10 to 14 (ERC objects, bus entries, graphics, two empty lists) walk to the exact page end on 450/451 pages | skips everything after the off-page connectors (`page-parser.ts:184`) | <!-- INT-13.1-007 --> |
| ERC objects | **S** ErcObject (type 77) records, three strings each, end at their stop | not parsed (`page-parser.ts:184`) | <!-- INT-13.2-001 --> |

None of these areas affects nets, pin numbers, pin names or values (15.3).

- A Do Not Stuff marker that was never written into the design, such as graphical text near a component with no property behind it, is invisible to any file reader. Nothing in the file records it. <!-- INT-13.6-005 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `ReuseSchematics.txt` holds one text line | EXT §1.2.4 | 0 bytes in 4 of 5 files; two lines in the fifth | **S** | <!-- EXT-1.2.4-016 --> |
| MPN coverage is 5,870/6,774 (86.7%), 5,456 substring | INT §13.5 | 1,335/6,760 (19.7%), 935 substring. Schema v2 (PR #199) split `mpn` from `internal_pn` and `manufacturer`, so the column now measures a stricter field; not a parser regression | **E** | <!-- INT-13.5-008 --> |

### Parser divergences

Resolved: the parser reads pin +0x06 as `wireId` and +0x0A as `netId` (`structures.ts`). A pin no wire reaches joins the net its `net_id` names (the golden table `pin-net` in `docs/decision-tables/dsn-net-assignment`, replayed by `net-assignment.table.test.ts`): the net a page wire with that id carries, or for `wire_id = 0` a net shared with the pins of the same `net_id`; a sentinel pin with no such wire keeps the pin-to-pin rule (§13). **E**: on the 31 corpus designs with Capture exports, every such pin the export puts on a multi-pin net is on a net (4 were left unconnected before, `SENSOR_BOARD` U1.18, U1.20, U1.38, U1.40 on 5V and 3V3); across all 192 corpus and fixture DSNs, 19 designs change, each only by pins leaving NC for a net, and no pin moves between nets. <!-- INT-13.1-006 -->

<!-- meta: EXT-0.1-001 EXT-0.1-002 EXT-0.2-012 EXT-0.2-013 EXT-0.2-014 EXT-0.2-015 EXT-0.2-016 EXT-5-005 EXT-9-001 EXT-10-004 EXT-11-004 EXT-15-003 EXT-15-004 EXT-15.3-006 EXT-16-001 EXT-16-002 EXT-16-003 EXT-16-004 EXT-16-005 INT-intro-9001 INT-1-9001 INT-2-9001 INT-2-9002 INT-3.1-9001 INT-3.2-9001 INT-3.3-9001 INT-4-9001 INT-4.1-9001 INT-4.2-9001 INT-4.4-9001 INT-4.4-9002 INT-4.5-9001 INT-6-9001 INT-6-9002 INT-6-9003 INT-6-9004 INT-7.3-9001 INT-7.5-9001 INT-7.5-9002 INT-7.6-9001 INT-7.6-9002 INT-7.6.1-9001 INT-7.6.1-9002 INT-7.7-9001 INT-7.7-9002 INT-7.7-9003 INT-7.7-9004 INT-7.7-9005 INT-7.7-9006 INT-7.7-9007 INT-7.7-9008 INT-7.7.2-9001 INT-7.7.2-9002 INT-7.7.2-9003 INT-7.8-9001 INT-7.9-9001 INT-8-9001 INT-8-9002 INT-8-9003 INT-8-9004 INT-8-9005 INT-8-9006 INT-9-9001 INT-9.1-9001 INT-9.1-9002 INT-9.2-9001 INT-9.2-9002 INT-9.2-9003 INT-9.3-9001 INT-9.4-9001 INT-10-9001 INT-10.2-9001 INT-10.5-9001 INT-11-9001 INT-12.1-9001 INT-12.1-9002 INT-12.2-9001 INT-12.2-9002 INT-12.2-9003 INT-12.3-9001 INT-12.4-9001 INT-12.4-9002 INT-12.4-9003 INT-12.5-9001 INT-12.6-9001 INT-12.6-9002 INT-12.6-9003 INT-13.6-9001 INT-13.8-9001 INT-enc-9001 EXT-0.4-9001 EXT-0.5-9001 EXT-0.5-9002 EXT-0.5-9003 EXT-0.5-9004 EXT-0.5-9005 EXT-0.5-9006 EXT-0.5-9007 EXT-0.5-9008 EXT-0.5-9009 EXT-0.5-9010 EXT-0.5-9011 EXT-0.5-9012 EXT-0.5-9013 EXT-0.5-9014 EXT-0.5-9015 EXT-0.5-9016 EXT-0.5-9017 EXT-0.5-9018 EXT-1.2.3-9001 EXT-2.3.6-9001 EXT-2.5.1-9001 EXT-2.6.1-9001 EXT-2.8-9001 EXT-2.9-9001 EXT-3-9001 EXT-3.2.2-9001 EXT-3.2.4-9001 EXT-3.2.4-9002 EXT-3.4-9001 EXT-3.4-9002 EXT-3.5-9001 EXT-3.6-9001 EXT-3.6-9002 EXT-3.7-9001 EXT-3.7-9002 EXT-3.7-9003 EXT-3.10-9001 EXT-4-9001 EXT-4.2-9001 EXT-4.5-9001 EXT-4.8-9001 EXT-4.9-9001 EXT-4.10-9001 EXT-4.10-9002 EXT-4.12-9001 EXT-4.12-9002 EXT-4.14-9001 EXT-5.2.2-9001 EXT-5.2.2-9002 EXT-5.2.2-9003 EXT-5.2.5-9001 EXT-5.2.6-9001 EXT-5.3.2-9001 EXT-5.3.3-9001 EXT-5.3.3-9002 EXT-5.3.3-9003 EXT-5.3.4-9001 EXT-5.3.5-9001 EXT-5.3.5-9002 EXT-5.3.5-9003 EXT-5.3.6-9001 EXT-5.3.7-9001 EXT-5.4.2-9001 EXT-5.6.1-9001 EXT-5.6.1-9002 EXT-5.6.1-9003 EXT-5.6.4-9001 EXT-5.6.5-9001 EXT-5.7.1-9001 EXT-5.7.2-9001 EXT-5.7.2-9002 EXT-5.7.2-9003 EXT-5.7.3-9001 EXT-6.4.1-9001 EXT-6.8-9001 EXT-7-9001 EXT-7-9002 EXT-7-9003 EXT-7-9004 EXT-7-9005 EXT-7-9006 EXT-7-9007 EXT-7.0.1-9001 EXT-7.0.3-9001 EXT-7.4-9001 EXT-7.10-9001 EXT-7.15-9001 EXT-8-9001 EXT-8-9002 EXT-8-9003 EXT-8.4.1-9001 EXT-8.5-9001 EXT-8.6-9001 EXT-8.7.1-9001 EXT-8.9.1-9001 EXT-8.9.1-9002 EXT-8.9.1-9003 EXT-9-9001 EXT-9-9002 EXT-9-9003 EXT-9-9004 EXT-9-9005 EXT-9-9006 EXT-9.1.3-9001 EXT-9.2.2-9001 EXT-9.3-9001 EXT-9.4-9001 EXT-9.5-9001 EXT-9.7.2-9001 EXT-9.9-9001 EXT-10.1-9001 EXT-10.3-9001 EXT-10.5.8-9001 EXT-10.5.8-9002 EXT-10.8-9001 EXT-11.1.1-9001 EXT-11.1.4-9001 EXT-11.4-9001 EXT-11.4-9002 EXT-11.5.5-9001 EXT-12.2.1-9001 EXT-12.2.1-9002 EXT-12.2.1-9003 EXT-12.5-9001 EXT-12.5-9002 EXT-12.7-9001 EXT-13-9001 EXT-13.3.5-9001 EXT-13.3.5-9002 EXT-13.4.2-9001 EXT-13.4.2-9002 EXT-13.4.3-9001 EXT-13.4.8-9001 EXT-13.4.11-9001 EXT-14-9001 EXT-14-9002 EXT-14.1-9001 EXT-14.5-9001 EXT-14.8-9001 EXT-14.9-9001 EXT-15.5-9001 EXT-16-9001 EXT-16-9002 EXT-16.1.5-9001 EXT-16.1.6-9001 EXT-17.3-9001 EXT-18-9001 EXT-18.6-9001 EXT-18.6-9002 EXT-18.6-9003 EXT-18.6-9004 EXT-18.8-9001 EXT-18.8-9002 EXT-18.9-9001 INT-intro-001 INT-intro-002 INT-intro-003 INT-intro-004 INT-intro-005 INT-intro-006 INT-intro-007 INT-intro-008 INT-intro-009 INT-13.5-001 INT-13.6-006 INT-13.7-001 INT-13.8-001 INT-13.8-002 INT-13.8-003 INT-13.8-004 INT-13.8-005 INT-13.8-006 INT-13.8-007 INT-13.8-008 -->

Parser coverage: the parser reads the DNS markers in value strings and the coverage measures of 15.3 describe its output; it does not read `HSObjects`, `LayoutReuse`, `DsnStream`, NetGroup records, the PlacedInstance, port and connector trailers, the occurrence fields it skips, the pin net id, or the page lists after the off-page connectors.

---

## 16. Password-protected designs (SYENCRYPT01)

A password-protected design is a `.DSN` whose streams are encrypted with a password while its container directory stays in clear. No real protected design is in our data (`FILE_FMT_SYENCRYPT01` occurs in no file of `designs-dataset` or `test-fixtures`, and no stream of the 120 checked files starts with `FILE_FMT_`), so the encrypted form below is *unverified* against Capture's output. It is implemented in `dsn-reader.ts` and `sapphire.ts` and exercised by tests on a self-built encryptor (`test/helpers/orcad-protect.ts`) and by `sapphire.test.ts` with known-answer vectors (`sapphire-vectors.json`, from an independent transcription that is not reproducible here). What is verified is the password test: the plaintext Library header it relies on.

### 16.1 Password test

The cipher authenticates nothing: it has no MAC or check value, and any key decrypts to some bytes. A password is known right only by what it decrypts. **O** (`checks/base/code_check.ts`: three arbitrary keys decrypt without error to bytes of the same length). <!-- INT-enc-009 -->

A right password makes the decrypted `Library` open as a Library header. Every plaintext Library stream shows these fields:

| Offset | Type | Field | Value | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `fixstr[32]` | introduction | `OrCAD Windows Design`, padded with spaces (11) to a `00` at byte 31 | **S** (120/120, including 1.1 and 2.0) | <!-- INT-enc-010 --> |
| +0x20 | `u16` | version major | 1 to 9; values seen 1, 2 and 3 (versions 1.1 ×1, 2.0 ×14, 3.2 ×98, 3.3 ×7) | **S** (120/120) | <!-- INT-enc-011 --> |
| +0x2C | `u32` | after the two dates | 0 | **S** (120/120) | <!-- INT-enc-012 --> |
| +0x30 | `u16` | font count | 1 to 1024 | **S** (120/120) | <!-- INT-enc-013 --> |

- Strict test: the 32-byte introduction is whole. It passes on all 120 plaintext Library streams. <!-- INT-enc-010 -->
- Looser test, for a header whose introduction carries other bytes after the text: the text at +0x00, a version of 1 to 9 (minor 0 to 99) at +0x20, four zero bytes at +0x2C and a font count of 1 to 1024 at +0x30. These fixed fields hold on 120/120 plaintext Library streams. **S**. No file has other bytes after the introduction text, so the case the looser test exists for is exercised only by a synthetic test. <!-- INT-enc-014 -->
- Only bytes from +0x16 on depend on the password (bytes 0 to 21 are clear, §16.2), so a wrong password passes the looser test by chance about once in 1.3 × 10^18 (derived by arithmetic for random decrypted bytes; *unverified*, as no file can test a probability this small). <!-- INT-enc-015 -->

The Library version of a protected design is encrypted, so the version gate (§17.5) applies only after decryption.

### Unverified

Everything in this list is reproduced by the parser's synthetic tests only; no real protected design is available.

- *unverified*: the container directory stays in clear, so stream and storage names, BOM variant names included, read without the password; the streams themselves are encrypted. The test "reads a protected design, its variants and Do Not Stuff set as the unprotected one" passes. <!-- INT-enc-001 -->
- *unverified*: an encrypted stream begins with the 20-byte ASCII marker `FILE_FMT_SYENCRYPT01`. <!-- INT-enc-002 -->
- *unverified*: the root `Library` stream keeps its first 22 bytes (+0x00 to +0x15) in clear and carries the marker after them; every other encrypted stream starts with the marker. A page named `Library` (`Views/<s>/Pages/Library`) has no clear bytes, so the root stream is matched by full path (§1.3). <!-- INT-enc-003 -->
- *unverified*: the plain stream is the clear prefix followed by the decrypted ciphertext, marker removed, and it equals the stream as an unprotected design stores it (synthetic round trip). <!-- INT-enc-008 -->
- *unverified*: a marker spelled `FILE_FMT_` or `FILE_FMT=` with another name is an encryption this reading does not cover; the parser refuses it (test "refuses a stream encrypted in another format"). <!-- INT-enc-004 -->
- *unverified*: the bytes after the marker are Sapphire II ciphertext (Michael Paul Johnson's stream cipher); known-answer vectors pass. <!-- INT-enc-005 -->
- *unverified*: decryption uses a fresh cipher state per stream, keyed by the password's bytes. <!-- INT-enc-006 -->
- *unverified*: a key is 1 to 255 bytes. The code enforces this; OrCAD's own limit is not observable without Capture. <!-- INT-enc-016 -->
- *unverified*: a password of printable ASCII characters is its own key. <!-- INT-enc-017 -->
- *unverified*: OrCAD's key schedule differs from the published cipher in one step: the shuffle loop runs down to card 0, whose only partner is itself, and still draws a key byte for it. The decryptor and the test encryptor both implement this extra draw, and the vectors pass. The full decryption, as implemented: <!-- INT-enc-007 -->

```
cards[i] = i for i in 0..255;  kp = 0;  sum = 0
for limit = 255 down to 0:                      ; published cipher stops at 1
    mask = smallest 2^k - 1 >= limit
    tries = 0
    repeat:
        sum = (cards[sum] + key[kp]) & 255;  kp += 1
        if kp == len(key): kp = 0;  sum = (sum + len(key)) & 255
        swap = sum & mask
        tries += 1
        if tries > 11: swap = (limit == 0) ? 0 : swap mod limit
    until swap <= limit
    exchange cards[limit], cards[swap]

rotor = cards[1]; ratchet = cards[3]; avalanche = cards[5]
last_plain = cards[7]; last_cipher = cards[sum]

for each ciphertext byte c:
    ratchet = (ratchet + cards[rotor]) & 255;  rotor = (rotor + 1) & 255
    t = cards[last_cipher]                      ; these four moves in this order:
    cards[last_cipher] = cards[ratchet]         ; two of the indices can be equal
    cards[ratchet] = cards[last_plain]
    cards[last_plain] = cards[rotor]
    cards[rotor] = t
    avalanche = (avalanche + cards[t]) & 255
    p = c ^ cards[(cards[ratchet] + cards[rotor]) & 255]
          ^ cards[cards[(cards[last_plain] + cards[last_cipher] + cards[avalanche]) & 255]]
    last_plain = p;  last_cipher = c;  output p
```

### Open questions

- How a password character outside printable ASCII is encoded into the key. No data; the parser rejects such passwords (`dsn-reader.ts:30`). <!-- INT-enc-018 -->

Parser coverage: the parser implements all of this chapter: marker detection, the clear Library prefix, per-stream Sapphire II decryption with OrCAD's key schedule, and both password tests (`dsn-reader.ts`, `sapphire.ts`). It does not cover other `FILE_FMT_` encryptions or non-ASCII passwords.

---

## 17. Versions

The format version of a design is the pair of `u16` words right after the 32-byte introduction of the `Library` stream. It is the only version present in every file, and the only one that selects a layout. **O** (120/120; the other version-like values occur in some files only: the `DsnStream` install JSON in 9, `VariantNames` in 21, no DCF). Layout families are named by these stored numbers, not by the release of Capture that saved the file. <!-- EXT-17.1-001 -->

### 17.1 Where the version is stored

| Offset | Type | Name | Values seen | Evidence | Ids |
| --- | --- | --- | --- | --- | --- |
| `Library` +0x20 | `u16` | version_major | 3 (105 files), 2 (14), 1 (1) | **S** (120/120) | <!-- EXT-16.7.2-001 EXT-17.1-002 --> |
| `Library` +0x22 | `u16` | version_minor | 2 and 3 with major 3; 0 with major 2; 1 with major 1 (the external source lists only 2 and 3) | **S** (120/120) | <!-- EXT-17.1-003 --> |

Versions on the 120 OrCAD files: 3.2 ×98, 3.3 ×7, 2.0 ×14, 1.1 ×1. **S**. <!-- EXT-16.7.2-001 -->

- By source: 88 corpus designs are at 3.2 or 3.3 (86 at 3.2, 2 at 3.3); of the fixtures, 12 are at 3.2, 5 at 3.3 and 1 (GPR_LF) at 2.0. **O**. <!-- INT-6-030 -->
- 14 corpus designs are below major 3 (1 at 1.1, 13 at 2.0), plus the gprino-lf fixture (`GPR_LF.DSN`, from GPRino) at 2.0, whose corpus copy is one of the 13. **O**. <!-- INT-6-028 -->

The major and minor together say which record encoding the design's other streams use. **O** (1.1 and 2.0 pages use a different encoding from 3.2 and 3.3: 61 pages against 451). <!-- INT-6-023 -->

**Other version-like values** are metadata of their own storage; none selects a layout of the shared streams. **O** for the three values in the table below (they vary independently of the Library version, and no decoded layout depends on them); `FormatVersion.txt` never occurs (Unverified below). <!-- EXT-17.1-005 EXT-16.7.2-007 -->

| Value | Where | Seen | Evidence | Ids |
| --- | --- | --- | --- | --- |
| Install JSON | `DsnStream` preamble kind-7 sub-record (§12.3.2) | 9 files (4 at 3.2, 5 at 3.3); keys exactly `InstallMode`, `License`, `InstalledVersionBase`, `InstalledVersionISR`; `InstalledVersionBase` is `17.4-2019` in 9/9; 93 files with `DsnStream` lack it. It identifies the installation that saved the design and affects no layout. | **O** | <!-- EXT-17.1-006 --> |
| Variant store version | `CIS/VariantStore/VariantNames` +0x00 (§14.3), `u32` | 900 in 21/21 files; it versions the CIS variant store only | **O** | <!-- EXT-17.1-008 --> |
| `* Directory` entry tail | `tail_a`, `tail_b`, two `u16` (§12.2.1) | (3, 2) on 157 of 162 Views rows and 77 of 81 Symbols rows, also in 3.3 files (7 Views, 19 Symbols). Exceptions (2, 0): Views rows `SCHEMATIC1` in trs80_power.dsn, `Schematic` in BeagleBoard-xM, `Parallella` in parallella_schematic.dsn; Symbols `ERC` rows in BeagleBoard-xM and parallella (2). The (2, 0) rows occur in files that also carry short-form primitives (§2.9). | **O** | <!-- EXT-17.1-009 --> |
| `NetBundleMapData` version | first `u16` (§12.5) | 2 | **O** | <!-- EXT-16.7.2-007 --> |

### 17.2 Families

The major version alone selects the layout family; minor 2 against 3 changes no layout. **O** (61 pages of 1.1 and 2.0 files use the older encoding; 451 pages of 3.2 and 3.3 share one). <!-- EXT-2.2-002 -->

| Family | Version words | Layout | Evidence | Ids |
| --- | --- | --- | --- | --- |
| Library 3.2 | 3 / 2 | The reference layout; every structure in this specification is given in 3.2 unless noted | **S** (98 files) | <!-- EXT-16.7.2-002 EXT-17.2-001 EXT-17.5-001 --> |
| Library 3.3 | 3 / 3 | The same record layouts as 3.2; no framed record, list or stream header differs | **S** (7 files) | <!-- EXT-16.7.2-003 EXT-17.2-002 --> |
| Library 1.1 and 2.0 | 1 / 1, 2 / 0 | An older record encoding (below) | **O** (15 files, 61 pages) | <!-- INT-6-036 --> |

**3.2 and 3.3 share every byte layout.** No byte layout differs between them: Library, Cache, pages, `Packages/<n>`, `Symbols/<n>` and primitives read to the exact end with one layout, 0 framing differences. **S** (98 files at 3.2, 7 at 3.3). <!-- EXT-17.3-001 EXT-17.5-002 EXT-17.5-003 -->

- In every structure both families share, the prefix shape (number of full prefixes, presence of the short prefix), the presence of a preamble, the list order and the field widths are identical. **S**. <!-- EXT-17.3-002 -->
- No framing rule depends on the Library version: the same prefix counts, short-prefix and preamble rules and extension kinds read all 7 Library-3.3 files (124 pages and 7 Caches to the exact end, 0 prefix-count mismatches). **S**. <!-- EXT-3.12-001 -->
- Every field of the Library stream has the same layout and value rules in both, `string_count` a `u32` in both. **S** (98 at 3.2, 7 at 3.3). <!-- EXT-4.3-003 -->
- The Cache, `Packages/<p>` and `Symbols/<s>` layouts are the same: 7 3.3 Caches, 1,273 `Packages/<n>` streams (all files) and 81 `Symbols/<n>` decode with the 3.2 layout, 0 mismatches. **S**. <!-- EXT-5.9-001 -->
- The page stream layout is the same: 124 pages of the 7 Library-3.3 files read to the exact end with the 3.2 page layout. **S**. <!-- EXT-6.11-001 -->
- The graphic primitive (§8) and text, font, colour and display (§9) layouts are the same: primitive lists and display properties in 3.3 files decode with the same layout, 0 mismatches. **S**. <!-- EXT-8-007 EXT-9-004 -->
- The Cache and page layouts are unchanged in 3.3. **S**. The Schematic and Hierarchy streams (§10) were not decoded here, so their sameness is untested. <!-- EXT-17.5-004 -->

**Library 1.1 and 2.0 use an older record encoding** in which the page stream's structures carry no `u32` prefix lengths. **O** (all 61 pages of the 15 files below 3). <!-- INT-6-036 -->

- A 3.x page record opens with its type byte, a `u32` length (stream length − 9) and four zero bytes: `0A <u32 len> 00 00 00 00 0A ...`; in the multio fixture (`MULTIO.DSN`, `Views/SCHEMATIC1/Pages/P1`) `0A C1 57 00 00 00 00 00 00 0A`. **O** (451/451 3.x pages). <!-- INT-6-037 -->
- A 1.1 or 2.0 page record opens `0A 00 00` followed directly by the page-name `lstr`, for example `0A 00 00 05 00 50 41 47 45 31 00` (`PAGE1`) in GPR_LF.DSN and HD6309_SBC.DSN. **O** (61/61). <!-- INT-6-038 -->
- The streams present do not tell the encodings apart: of the 14 below-3 corpus designs, 8 have `Packages/<n>` streams and 6 do not. The Library version does. **O**. <!-- INT-6-039 -->
- Read with the 3.x page layout, a below-3 design fails on its first page (issue #246, a string-decoding error), which is why the parser refuses it. This is shown for the GPR_LF fixture; the 14 corpus designs were not re-run through the 3.x page parser. **T** (GPR_LF). <!-- INT-6-040 INT-6-043 -->

### 17.3 Differences between Library 3.2 and 3.3

The only observed difference is the content of `NetBundleMapData` (§12.5), and it is a difference of content, not of layout.

| Item | Library 3.2 | Library 3.3 | Evidence | Ids |
| --- | --- | --- | --- | --- |
| `NetBundleMapData` | exactly `02 00 00 00` (empty), on 95/95 3.2 files that have it (3 lack it) | non-empty on 7/7 | **S** (3.2) / **O** (3.3) | <!-- EXT-17.3-004 EXT-17.5-005 --> |
| NetGroup record (type 103, `0x67`) | not seen | inside `NetBundleMapData` | **O** (7 files) | <!-- EXT-17.3-003 --> |

- Net bundles occur only in 3.3 files. **O** (7 of 7 3.3 files non-empty; 95 of 95 3.2 files with the stream empty; the 3.2 empty form is a whole-stream compare, **S**, and the 3.3 bundle contents are not decoded). <!-- EXT-12.5-018 -->
- The non-empty form starts with `u16` version 2 and a `u16` bundle count at +0x02; the count is 1 in 6 files and 2 in 1 file. The bundle internals (per bundle a name, one NetGroup record, a `u16` member count, then a name and `u16` flag per member) were not decoded. **O** (7 files). <!-- EXT-17.3-005 -->

### 17.4 Optional storage is not a family

Several storages occur only in some files (`CIS`, `LayoutReuse`, `AnnotateCtrl`, `BundleMapData`); files with and without them decode their shared streams with one layout. **S** (451 pages, 105 Caches). <!-- EXT-17.4-001 -->

### 17.5 Version gate in the parser

`parseDsnFile` reads the version from the root `Library` stream before any page (`readLibraryVersion`, called at `dsn-parser.ts:67`) and sorts it four ways (`libraryVersionSupport`, `library-parser.ts:47`). **T**. <!-- INT-6-024 -->

| Library | Outcome | Evidence | Ids |
| --- | --- | --- | --- |
| absent, or shorter than 36 bytes | read as before, with an empty string table (every one of the 120 files has a Library of at least 36 bytes) | **T** | <!-- INT-6-026 --> |
| major below 3 (1.1 and 2.0 seen) | refused with `UnsupportedDsnVersionError`, naming the version and asking for a re-save in a newer Capture | **T** | <!-- INT-6-027 --> |
| 3.2 or 3.3 | read | **T** | <!-- INT-6-029 --> |
| any other version from 3 up (none in the data) | read as 3.2/3.3 are; a parse that throws has the version appended to its message | **T** | <!-- INT-6-031 --> |

- The root `Library` is matched by its full path, because a page may itself be named `Library` (`Views/<s>/Pages/Library`); `DsnReader` matches it the same way for decryption (§16). No page named `Library` occurs in the data. **T**. <!-- INT-6-025 -->
- `list_designs` applies the same refusal while listing (`assertListableDsn`, called from the Cadence handler's `listVariants`, `src/parsers/cadence/index.ts:247`): a design below 3 is listed with `unsupported: true` and the refusal as its error. **T**. <!-- INT-6-033 -->
- Listing reads the container without a password, so a protected design, whose Library version is encrypted, is listed normally and judged when a query decrypts it (the encrypted-stream check returns before the gate; tested on synthetic encryption only). **T**. <!-- INT-6-034 -->
- The GPR_LF fixture is at version 2.0; `library-parser.test.ts` shows its first page failing the page parser and the gate refusing it, and the golden test expects the refusal (`UNSUPPORTED_FIXTURES`, `test/utils.ts:59`). **T**. <!-- INT-6-041 -->
- The C++ reference (`StreamLibrary.cpp`) logs the version without acting on it, reads every version the same way, and picks the width of `str_lst_len` from its predicted file-format version. The parser diverges from it by gating on the version. <!-- INT-6-042 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| Every file has major 3, minor 2 or 3 | EXT §2.2 | 15 files are below 3: `a3640.dsn` at 1.1; GPR_LF.DSN (fixture and corpus), HD6309_SBC.DSN, ROBOT.DSN and 10 more at 2.0. The `u16` major/minor at +0x20 and the 3.2/3.3 sameness hold | **O** (15 files) | <!-- EXT-2.2-001 --> |
| Majors below 72 (other than 3) share this document's layout | EXT §2.2, §16.7.2 | Majors 1 and 2 do not: their 61 page streams open `0A 00 00` then an `lstr` name with no `u32` prefix length. No file exists for majors 4 to 71 | **O** (61 pages) | <!-- EXT-2.2-003 EXT-16.7.2-004 --> |

### Unverified

- *unverified*: a Library major of 72 or more denotes a different layout family not defined by either source, with 72 and above-72 as separate families of unknown layout. No file has a major above 3. <!-- EXT-2.2-004 EXT-2.2-005 EXT-3.12-003 EXT-4.3-005 EXT-16.7.2-005 EXT-16.7.2-006 EXT-17.2-003 -->
- *unverified*: the Constraint storage is known only in Library 3.2 files, and its archive carries its own version string, independent of the Library version. No file has a Constraint storage. <!-- EXT-13.1-008 -->
- *unverified*: `FormatVersion.txt` as a version-like value that selects no layout of the shared streams; no file has it. <!-- EXT-16.7.2-007 EXT-17.1-005 -->
- *unverified*: `Views/<s>/Constraint/DCF` member `FormatVersion.txt` (§1, Unverified) holds the constraint-store version (for example `17.220`, `23.100`) and versions that store only. Known values and their optional members: `17.220` with `Xnet.xml`; `17.440` with `NetClass.xml` and `Xnet.xml`, sometimes `DiffPair.xml`; `23.100` with any subset of `DiffPair.xml`, `NetClass.xml`, `Xnet.xml`; `25.100` with `Xnet.xml`, sometimes `DiffPair.xml` or `NetClass.xml`. All four use the same container and document grammar; only the optional members vary. No DCF in the data. <!-- EXT-17.1-007 EXT-13.3.5-013 EXT-13.3.5-014 EXT-13.3.5-015 EXT-13.3.5-016 EXT-13.3.5-017 -->
- *unverified*: format changes inside optional storages are versioned by their own stored values, not by the Library header. The only optional-storage version seen is `VariantNames` 900; there is no change to compare. <!-- EXT-17.5-006 -->

### Open questions

- Whether a Library major other than 3 changes any field beyond the page encoding, and how majors 72 and above differ. Majors 1 and 2 change the page encoding (61 pages); no major of 72 or more exists. <!-- EXT-4.oq-007 EXT-17.2-004 -->
- Whether net bundles require Library 3.3, or the non-empty `NetBundleMapData` form is tied to minor 3 rather than to the use of net groups. All 7 3.3 files carry bundles and no 3.2 file does, so version and feature cannot be separated. <!-- EXT-12.5-019 EXT-17.3-006 -->
- Whether the `* Directory` tail pair is a per-object format version. Pairs seen: Views and Symbols (3, 2) and (2, 0); Packages, Cells and Parts (3, 2), (2, 0) and (1240 to 2260, 2). A version-stamp reading fits the legacy (2, 0) objects. <!-- EXT-17.1-010 -->

Parser coverage: the parser reads `Library` +0x20/+0x22 and gates on them (refusing majors below 3, reading 3.2, 3.3 and any other major of 3 or more as 3.2). It does not read the `DsnStream` install JSON, the `* Directory` tails, the `NetBundleMapData` version or any DCF `FormatVersion.txt`; it reads `VariantNames` only for the variant store (§14).

<!-- meta: EXT-0.2-017 EXT-2.2-006 EXT-5.9-002 EXT-17.1-004 INT-6-032 INT-6-035 -->

---

## 18. Worked example: a blank design

This chapter is a byte-by-byte walk through a minimal design file built from the layouts of the earlier chapters. It shows how the streams fit together and which values must agree across streams. Every byte table gives the example's bytes and, in the **Real files** column, what the 105 version-3 designs show at the same place in the same field order:

- **fixed: v on n/n** means the layout holds and every real record carries the same value, so the value belongs to the format.
- **layout holds on all n; value is content** means the field sits at this position on every real record and each walk ends exactly at its stream end, while its value (a name, id, count, time or coordinate) is specific to the example.
- Anything else states the values the files carry, with counts, where the example's value is one legal choice among several or occurs in no real file.

Offsets are stream offsets in hex unless a table says otherwise; `00 × N` is N zero bytes, and a long run is shown as its first eight bytes and its total length.

### 18.1 Design content

The design holds one schematic folder with one page. The page carries one placed part with one pin, one wire ending on that pin, one net alias on the wire, and one displayed property on the part. Every one of these record kinds occurs on real pages **S**: PlacedInstance 14,988, pins 60,258, wires 82,550, aliases 16,165, display properties 43,281. <!-- EXT-18-002 -->

| Object | Stored as | Evidence on real files | Ids |
| --- | --- | --- | --- |
| Folder `SCHEMATIC1` | storage `Views/SCHEMATIC1`, an entry in `Views Directory`, and the Library root schematic name; it is the root schematic | **S** the root name names a `Views/<s>` storage and a `Views Directory` entry in 105/105 (the first entry in 98, a later one in 7) | <!-- EXT-18.1-001 --> |
| Page `PAGE1` | stream `Views/SCHEMATIC1/Pages/PAGE1`, the only page in the Schematic page list | **S** the Schematic page list equals the set of page streams in 162/162 Schematic streams | <!-- EXT-18.1-002 --> |
| Part definition `PART1` | in `Cache`: part view `PART1.Normal`, part cell `PART1`, package `PART1` with one device | **S** Cache tables 2, 3 and 4 hold only types 24, 6 and 31 (2,604, 2,570 and 2,375 records); devices (type 32, 2,735) sit inside packages | <!-- EXT-18.1-003 --> |
| Placed part `R1` | PlacedInstance in page list 6, `db_id` 10 | **S** list 6 holds the PlacedInstance (type 13) records: 14,988 on 450 pages | <!-- EXT-18.1-004 --> |
| The wire | scalar wire in page list 5, `db_id` 11 | **S** list 5 holds 82,550 scalar wires (type 20) | <!-- EXT-18.1-005 --> |
| Page net `NET1` | page lists 2 and 4, net id 12 | **S** 27,116 SchematicNets in list 2, 25,479 net-name rows in list 4; every scalar wire's net id names a list-2 net (82,550/82,550) | <!-- EXT-18.1-006 --> |
| Net alias `NET1` | Alias record inside the wire | **S** aliases (type 49) nest inside wires: 16,165, every alias stop correct | <!-- EXT-18.1-007 --> |
| Displayed `Part Reference` | SymbolDisplayProp inside the placed part | **S** 43,281 SymbolDisplayProps (type 39) nest in placed parts; `Part Reference` is the most common name (14,955) | <!-- EXT-18.1-008 --> |
| Design net `NET1` | Hierarchy net list, occurrence id 1 | **S** the net list holds type-67 records: 16,541 in 109 streams | <!-- EXT-18.1-009 --> |
| Occurrences of `R1` and its pin | Hierarchy occurrence tree, occurrence ids 2 and 3 | **S** the tree holds 18,375 instance and 93,833 pin occurrences; occurrence ids are unique in 108/108 streams | <!-- EXT-18.1-010 --> |

The names `SCHEMATIC1`, `PAGE1`, `R1`, `NET1`, `PART1` and the library path `C:\EXAMPLE.OLB` are placeholders. Every time stamp is Unix time 1700000000 (2023-11-14 22:13:20 UTC), stored as `00 F1 53 65`. Each time field the example sets (Library created and modified, PageSettings created and modified, directory `saved`, Cache id) is a `u32` at the stated place **S**; the instant itself is content. <!-- EXT-18-004 --> The compound-file directory times follow a fixed pattern on real files **S**: the root entry has creation time 0 and a non-zero modification time (105/105), every storage has non-zero creation and modification times (1,300/1,300), and every stream has both times 0 (3,841/3,841). The example puts its single instant in the non-zero slots. <!-- EXT-18-005 -->

The wire runs from (60, 110) to (100, 110). Its end point is the pin's hot point, so the pin is wired. On real pages a wired pin's connection field names a wire with an end point at the pin point on 58,511 pins (0 on 4,265, `FFFFFFFF` on 840) **O**. Scope: those counts cover all 63,616 pin records of placed and drawn instances on all 451 pages; the field walk of this chapter covers the 450 pages it reads to the end, with 60,258 placed-part pins (55,363 wired) and 3,300 drawn-instance pins (3,096 wired). <!-- EXT-18.1-015 --> The symbol is a rectangle from (10, 0) to (30, 20) with one pin drawn from (10, 10) to its hot point (0, 10). Placed at (100, 100), this gives the page rectangle (110, 100)-(130, 120) and the pin hot point (100, 110). The arithmetic follows the bbox placement rule, which places every pin correctly on 14,131 real parts and no pin on 710 **O**; the coordinates are content. <!-- EXT-18.1-014 -->

### 18.2 Stream inventory

| Path | Kind | Size in the example | Content | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| `Library` | stream | 432 | header, one font row, defaults, 6-entry string table, design suffix (18.3) | **S** this content order walks to the exact end in 105/105; the size is content (smallest real `Library` 934 bytes) | <!-- EXT-18.2-001 --> |
| `Cache` | stream | 564 | tables 0 to 4: one part view, one part cell, one package (18.6) | **S** tables 0 to 4 walk to the exact end in 105/105; every real `Cache` has a non-empty table 1 | <!-- EXT-18.2-002 --> |
| `DsnStream` | stream | 20 | DesignProperties record with no properties and no extension (18.5) | **O** exactly these 20 bytes occur in one real file; 90 files have 28 bytes (one property pair) | <!-- EXT-18.2-003 --> |
| `HSObjects` | stream | 16 | empty form (18.5) | **S** 16 zero bytes in 105/105 (and 4/4 pre-version-3 files that have it) | <!-- EXT-18.2-004 --> |
| `NetBundleMapData` | stream | 4 | no bundles (18.5) | **S** the 4 bytes `02 00 00 00` in 95/102; 7 hold bundles | <!-- EXT-18.2-005 --> |
| `AdminData` | stream | 6 | flag and reserved bytes (18.5) | **S** 6 bytes in 105/105: flag (0 in 41, 1 in 64), then 5 zero bytes | <!-- EXT-18.2-006 --> |
| `Views Directory` | stream | 41 | one entry, `SCHEMATIC1` (18.4) | **S** a one-entry directory of 25 + n bytes walks to its exact end; 41 bytes in 82 files | <!-- EXT-18.2-007 --> |
| `Views/SCHEMATIC1/Schematic` | stream | 68 | Schematic header (18.7) | **S** the header layout walks to the exact end in 162/162; the size is content | <!-- EXT-18.2-008 --> |
| `Views/SCHEMATIC1/Pages/PAGE1` | stream | 614 | page record (18.8) | **S** the page layout walks to the exact end in 450/451 page streams (one walker abort on a SchematicNet prefix false positive) | <!-- EXT-18.2-009 --> |
| `Views/SCHEMATIC1/Hierarchy/Hierarchy` | stream | 167 | occurrence tree of the root schematic (18.9) | **S** walks to the exact end in 108/109 | <!-- EXT-18.2-010 --> |
| `Symbols Directory`, `Packages Directory`, `Cells Directory`, `Parts Directory`, `ExportBlocks Directory`, `Graphics Directory` | streams | 6 each | header only, no entries (18.4) | **S** `ExportBlocks` and `Graphics Directory` are 6-byte empty headers in 105/105; `Symbols`, `Packages`, `Cells` and `Parts Directory` are empty in 48, 40, 40 and 40 files | <!-- EXT-18.2-011 --> |
| `Symbols/$Types$` | stream | 0 | empty: no standalone symbols | **S** present in 105/105; 0 bytes in 48, non-empty in 57 | <!-- EXT-18.2-012 --> |
| `Graphics/$Types$` | stream | 0 | always empty | **S** 0 bytes in 105/105 | <!-- EXT-18.2-013 --> |
| `Views`, `Views/SCHEMATIC1`, `Views/SCHEMATIC1/Pages`, `Views/SCHEMATIC1/Hierarchy` | storages | | folder structure | **S** present in every version-3 file walked (105) | <!-- EXT-18.2-014 --> |
| `Symbols`, `Packages`, `Cells`, `Parts`, `ExportBlocks`, `Graphics` | storages | | `Symbols` and `Graphics` hold only their `$Types$` stream; the other four are empty | **S** `Cells`, `Parts`, `ExportBlocks` empty in 105/105; `Graphics` holds only `$Types$` in 105/105; `Symbols` holds only `$Types$` in 48 (57 have symbol streams); `Packages` empty in 43 (62 have `Packages/<p>`) | <!-- EXT-18.2-015 --> |

The optional parts are absent: `AnnotateCtrl`, `CIS`, `CCSStorage`, `LayoutReuse`, and the folder's `CISSchematic` and `Constraint` storages. This is a configuration real files have **S**: `AnnotateCtrl` is absent in 104/105, `CIS` in 84, `CCSStorage` in 105, `LayoutReuse` in 100. <!-- EXT-18.2-016 -->

Directory entry times: the root entry has creation FILETIME 0 and modification FILETIME 133444736000000000 (the example instant); every storage carries that FILETIME for creation and modification; every stream carries 0 for both. On real files the root creation time is 0 and its modification time non-zero in 105/105, storage times are non-zero on 1,300/1,300 entries, and stream times are 0 on 3,841/3,841 entries **S**; the instant is content. <!-- EXT-18.2-018 EXT-18.2-019 EXT-18.2-020 --> Every example stream is shorter than the 4096-byte mini-stream cutoff, so its data sits in the mini stream; the header cutoff is 4096 in 105/105 **S**. <!-- EXT-18.2-021 -->

### 18.3 `Library` (432 bytes)

With one font row (F = 1), `default_font_count` sits at +0x6E = +0x32 + 60·F; the count sits at +0x32 + 60·F in 105/105 **S**. <!-- EXT-18.3-001 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `4F 72 43 41 44 20 57 69 … (32 bytes)` | introduction | "OrCAD Windows Design", 11 spaces, NUL | **S** fixed: 'OrCAD Windows Design', 11 spaces, NUL on 105/105 | <!-- EXT-18.3-004 --> |
| +0x20 | `03 00` | version_major | 3 | **S** fixed: 3 on 105/105 | <!-- EXT-18.3-005 --> |
| +0x22 | `02 00` | version_minor | 2 (Library version 3.2) | **S** layout holds on all 105; value is content | <!-- EXT-18.3-006 --> |
| +0x24 | `00 F1 53 65` | created | 1700000000 | **S** layout holds on all 105; value is content | <!-- EXT-18.3-007 --> |
| +0x28 | `00 F1 53 65` | modified | 1700000000 | **S** layout holds on all 105; value is content | <!-- EXT-18.3-008 --> |
| +0x2C | `00 00 00 00` | reserved | 0 | **S** fixed: 0 on 105/105 | <!-- EXT-18.3-009 --> |
| +0x30 | `02 00` | font_count | 2 (F + 1, F = 1 row) | **S** rule: font_count = F + 1 on 105/105; F is content | <!-- EXT-18.3-010 --> |
| +0x32 | `F7 FF FF FF` | lfHeight | -9 | **S** layout holds on all 105; value is content | <!-- EXT-18.3-011 --> |
| +0x36 | `00 00 00 00` | lfWidth | 0 | **S** layout on 105/105; 0 is legal (range 0 to 12) but row 1 holds 4 in all 105 files | <!-- EXT-18.3-012 --> |
| +0x3A | `00 00 00 00` | lfEscapement | 0 | **S** fixed: 0 (row 1) on 105/105 | <!-- EXT-18.3-013 --> |
| +0x3E | `00 00 00 00` | lfOrientation | 0 | **S** fixed: 0 (row 1) on 105/105 | <!-- EXT-18.3-014 --> |
| +0x42 | `90 01 00 00` | lfWeight | 400 | **S** layout holds on all 105; value is content | <!-- EXT-18.3-015 --> |
| +0x46 | `00 00 00 00 00 00 01 00` | lfItalic … lfPitchAndFamily | italic 0, underline 0, strike 0, charset 0, out 0, clip 0, quality 1, pitch 0 | **S** layout holds on all 105; value is content | <!-- EXT-18.3-016 --> |
| +0x4E | `41 72 69 61 6C 00 00 00 … (32 bytes)` | lfFaceName | "Arial", zero-filled | **S** layout holds on all 105; value is content | <!-- EXT-18.3-017 --> |
| +0x6E | `18 00` | default_font_count | 24 | **S** fixed: 24 on 105/105 | <!-- EXT-18.3-018 --> |
| +0x70 | `01 00 01 00 01 00 01 00 … (48 bytes)` | default_fonts[0..23] | every slot = row 1 | **S** layout (24 u16) on 105/105; every real file has zero slots 3, 4 and 17 to 23, so all-row-1 occurs in 0/105 | <!-- EXT-18.3-019 --> |
| +0xA0 | `00 00 00 00` | default_drawn_instance_primitive | 0 | **S** layout on 105/105; 0 in 104/105, 1 in one file (8MICS.DSN) | <!-- EXT-18.3-020 --> |
| +0xA4 | `01 00 00 00` | default_placed_instance_primitive | 1 | **S** layout on 105/105; 1 in 101/105, 0 in 4 | <!-- EXT-18.3-021 --> |
| +0xA8 | `00 × 24` | default_part_fields[0..7] | 8 empty lstr (empty form) | **S** layout (8 lstr) on 105/105; all-empty occurs in 0/105 (real files carry 1ST to 7TH PART FIELD and PCB Footprint) | <!-- EXT-18.3-022 --> |
| +0xC0 | `00 00 00 00 00 00 00 00 … (156 bytes)` | default_page_settings | Empty form (non-zero fields below) | **S** layout (156 bytes) on 105/105; the empty form occurs in 0/105 | <!-- EXT-18.3-023 --> |
| +0x15C | `06 00 00 00` | string_count | 6 (S = 6) | **S** layout holds on all 105; value is content | <!-- EXT-18.3-024 --> |
| +0x160 | `00 00 00` | strings[0] | empty | **S** fixed: empty on 105/105 | <!-- EXT-18.3-025 --> |
| +0x163 | `0E 00 43 3A 5C 45 58 41 … (17 bytes)` | strings[1] | "C:\EXAMPLE.OLB" | **S** layout (u16 length, bytes, 00) on 105/105; string is content | <!-- EXT-18.3-026 --> |
| +0x174 | `04 00 49 4E 53 31 00` | strings[2] | "INS1" | **S** layout (u16 length, bytes, 00) on 105/105; string is content | <!-- EXT-18.3-027 --> |
| +0x17B | `05 00 56 61 6C 75 65 00` | strings[3] | "Value" | **S** layout (u16 length, bytes, 00) on 105/105; string is content | <!-- EXT-18.3-028 --> |
| +0x183 | `02 00 31 6B 00` | strings[4] | "1k" | **S** layout (u16 length, bytes, 00) on 105/105; string is content | <!-- EXT-18.3-029 --> |
| +0x188 | `0E 00 50 61 72 74 20 52 … (17 bytes)` | strings[5] | "Part Reference" | **S** layout (u16 length, bytes, 00) on 105/105; string is content | <!-- EXT-18.3-030 --> |
| +0x199 | `00 00` | alias_count | 0 | **S** fixed: 0 on 105/105 | <!-- EXT-18.3-031 --> |
| +0x19B | `00 00 00 00` | reserved | 0 | **S** fixed: 0 on 105/105 | <!-- EXT-18.3-032 --> |
| +0x19F | `03 00 00 00` | occurrence_id_watermark | 3 (last occurrence id allocated) | **S** partial: layout on 105/105; equals the largest root occurrence id in 66, exceeds it in 34, is below it in 4 | <!-- EXT-18.3-033 --> |
| +0x1A3 | `0A 00 53 43 48 45 4D 41 … (13 bytes)` | root_schematic_name | "SCHEMATIC1" | **S** layout holds on all 105; value is content | <!-- EXT-18.3-034 --> |

The default page-settings block, offsets relative to its start at Library +0xC0. The example lists only its non-zero fields; every other field is 0, including the opaque `u16` at +0x2A. <!-- EXT-18.3-035 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x20 | `64 00 00 00` | pin_to_pin | 100 | **S** layout on 105/105; 100 in every block with IsMetric 0 (97/97); the 8 IsMetric 1 blocks hold 2540 (5) or 1000 (3) | <!-- EXT-18.3-036 --> |
| +0x34 | `30 00 00 00` | color | 48 | **S** fixed: 48 on 105/105 | <!-- EXT-18.3-037 --> |
| +0x38 | `30 00 00 00` | label_color | 48 | **S** fixed: 48 on 105/105 | <!-- EXT-18.3-038 --> |
| +0x5C | `01 00 00 00` | outer_border_visible | 1 | **S** fixed: 1 on 105/105 | <!-- EXT-18.3-039 --> |
| +0x64 | `01 00 00 00` | horizontal_char | 1 (empty form) | **S** layout on 105/105; 1 occurs in 0/105 (all real files hold 0) | <!-- EXT-18.3-040 --> |
| +0x6C | `01 00 00 00` | horizontal_ascending | 1 (empty form) | **S** layout on 105/105; 1 occurs in 0/105 (all real files hold 0) | <!-- EXT-18.3-041 --> |
| +0x70 | `01 00 00 00` | vertical_char | 1 | **S** fixed: 1 on 105/105 | <!-- EXT-18.3-042 --> |
| +0x78 | `01 00 00 00` | vertical_ascending | 1 (empty form) | **S** layout on 105/105; 1 occurs in 0/105 (all real files hold 0) | <!-- EXT-18.3-043 --> |
| +0x80 | `01 00 00 00` | border_displayed | 1 | **S** fixed: 1 on 105/105 | <!-- EXT-18.3-044 --> |
| +0x84 | `01 00 00 00` | border_printed | 1 | **S** fixed: 1 on 105/105 | <!-- EXT-18.3-045 --> |

The string table holds the empty string at index 0, then every string another stream refers to by index. Entry 0 is empty and is the only empty entry, and no entry repeats, in 105/105 **S**. <!-- EXT-18.3-046 -->

| Index | String | Referred to by | Real files | Ids |
| --- | --- | --- | --- | --- |
| 1 | `C:\EXAMPLE.OLB` | PlacedInstance library index | **S** the library index is a non-zero string index on 14,988/14,988; the string is content | <!-- EXT-18.3-047 --> |
| 2 | `INS1` | PlacedInstance name index | **S** a `u32` string index (14,988) | <!-- EXT-18.3-048 --> |
| 3 | `Value` | name of the PlacedInstance property pair (short prefix) | **S** every placed part has short-prefix pairs, but a pair named `Value` occurs on 2/14,988 (`PCB Footprint` on all 14,988); real parts keep the value in the value index | <!-- EXT-18.3-049 --> |
| 4 | `1k` | the property pair's value and the PlacedInstance value index | **S** the value index is a `u32` string index (14,988) | <!-- EXT-18.3-050 --> |
| 5 | `Part Reference` | SymbolDisplayProp name index | **S** the name index resolves to `Part Reference` on 14,955 of 43,281 page display properties | <!-- EXT-18.3-051 --> |

### 18.4 Directory streams

`Views Directory` is 41 bytes and lists the one schematic folder; its entry layout walks to the exact end in 105/105 **S**. <!-- EXT-18.4-001 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `00 F1 53 65` | saved | 1700000000 (= Library.modified) | **S** partial: layout on 105/105; equals Library.modified in 92, a few seconds later in 13 | <!-- EXT-18.4-002 --> |
| +0x04 | `01 00` | count | 1 | **S** layout holds on all 105; value is content | <!-- EXT-18.4-003 --> |
| +0x06 | `0A 00 53 43 48 45 4D 41 … (13 bytes)` | name | "SCHEMATIC1" | **S** layout holds on all 162; value is content | <!-- EXT-18.4-004 --> |
| +0x13 | `09 00` | kind | 9 (Schematic) | **S** fixed: 9 on 162/162 | <!-- EXT-18.4-005 --> |
| +0x15 | `00 00 6D C6 47 17 DA 01` | created | 133444736000000000 (filetime64,) | **S** layout holds on all 162; value is content | <!-- EXT-18.4-006 --> |
| +0x1D | `00 00 6D C6 47 17 DA 01` | modified | 133444736000000000 (filetime64,) | **S** layout holds on all 162; value is content | <!-- EXT-18.4-007 --> |
| +0x25 | `03 00` | tail_a | 3 | **S** layout on 162/162; 3 on 157, 2 on 5 | <!-- EXT-18.4-008 --> |
| +0x27 | `02 00` | tail_b | 2 | **S** layout on 162/162; 2 on 157, 0 on 5 (the same 5 entries, tail (2, 0)) | <!-- EXT-18.4-009 --> |

The six other directories have no entries. Each is the 6-byte header `00 F1 53 65 00 00`: `saved`, then `count` 0. The header layout holds on real files, where `saved` equals `Library.modified` on 554 of 630 directory headers and is later on 76 **S**. <!-- EXT-18.4-010 --> They are empty because the design has no `Packages/<p>` or `Symbols/<s>` streams, and definitions held only in `Cache` are never listed **O**: the `Packages`, `Cells` and `Parts` directories are empty in 40 files while the `Packages` storage is empty in 43 (3 files list packages that have no stream), and `Symbols Directory` is empty exactly when `Symbols` holds only its types stream (48/48). <!-- EXT-18.4-011 -->

### 18.5 Small fixed streams

`DsnStream` is 20 bytes: one DesignProperties record with one full prefix, no property pairs and an empty extension. Exactly these bytes occur in one real file; the frame (one full prefix whose stop is the stream end) holds in 102/102 **S**. <!-- EXT-18.5-001 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `04 0B 00 00 00 00 00 00 00` | full prefix | type 4, end_offset 11 (stop 0x14) | **S** fixed: type 4, one full prefix on 102/102 | <!-- EXT-18.5-002 --> |
| +0x09 | `04 00 00` | short prefix | type 4, count 0 | **S** type 4 on 102/102; count 0 in 1, above 0 in 101 (count is content) | <!-- EXT-18.5-003 --> |
| +0x0C | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** magic on 102/102; length 0 in 93, a kind-7 extension in 9 | <!-- EXT-18.5-004 --> |

`HSObjects` is 16 bytes, the empty form (15.1); it is 16 zero bytes in 105/105 **S**. <!-- EXT-18.5-005 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `00 00 00 00` | table1_count | 0 | **S** fixed: 0 (stream all zero) on 105/105 | <!-- EXT-18.5-006 --> |
| +0x04 | `00 00 00 00` | table2_count | 0 | **S** fixed: 0 (stream all zero) on 105/105 | <!-- EXT-18.5-007 --> |
| +0x08 | `00 00 00 00` | terminal[0] | 0 | **S** fixed: 0 (stream all zero) on 105/105 | <!-- EXT-18.5-008 --> |
| +0x0C | `00 00 00 00` | terminal[1] | 0 | **S** fixed: 0 (stream all zero) on 105/105 | <!-- EXT-18.5-009 --> |

`NetBundleMapData` is 4 bytes, the form without net bundles, as in 95/102 files **S**. <!-- EXT-18.5-010 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `02 00` | version | 2 | **S** fixed: 2 on 102/102 | <!-- EXT-18.5-011 --> |
| +0x02 | `00 00` | bundle_count | 0 | **S** 0 with a 4-byte stream in 95/102; above 0 in 7 | <!-- EXT-18.5-012 --> |

`AdminData` is 6 bytes, as in 105/105 files **S**. <!-- EXT-18.5-013 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `00` | flag | 0 | **S** layout on 105/105; 0 in 41, 1 in 64 (content) | <!-- EXT-18.5-014 --> |
| +0x01 | `00 00 00 00 00` | reserved | 0 | **S** fixed: five zero bytes on 105/105 | <!-- EXT-18.5-015 --> |

### 18.6 `Cache` (564 bytes)

Table 0 and table 1 are empty; tables 2, 3 and 4 each hold one group with one variant. Table 0 is empty in 105/105 real files, but table 1 is non-empty in 105/105, so the empty table 1 is content **S**. The part view is shown in full, with its one Rect primitive and one pin. <!-- EXT-18.6-001 -->

Table headers:

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `00 00` | table0.group_count | 0 | **S** fixed: 0 on 105/105 | <!-- EXT-18.6-002 --> |
| +0x02 | `00 00` | table1.group_count | 0 (no terminal symbols) | **S** layout (u16) on 105/105; 0 occurs in 0/105 (every real Cache has terminal symbols), so 0 is content | <!-- EXT-18.6-003 --> |
| +0x04 | `01 00` | table2.group_count | 1 | **S** layout holds on all 105; value is content | <!-- EXT-18.6-004 --> |
| +0x06 | `0C 00 50 41 52 54 31 2E … (15 bytes)` | group.name | "PART1.Normal" | **S** layout holds on all 11,900; value is content | <!-- EXT-18.6-005 --> |
| +0x15 | `01 00` | group.variant_count | 1 | **S** layout holds on all 11,900; value is content | <!-- EXT-18.6-006 --> |
| +0x17 | `0E 00 43 3A 5C 45 58 41 … (17 bytes)` | variant.source_library | "C:\EXAMPLE.OLB" | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-007 --> |
| +0x28 | `00 F1 53 65` | variant.id | 1700000000 | **S** fixed: non-zero on 2,604/2,604 | <!-- EXT-18.6-008 --> |
| +0x2C | `00 F1 53 65` | variant.id_copy | 1700000000 | **S** fixed: = id on 2,604/2,604 | <!-- EXT-18.6-009 --> |
| +0x30 | `18 00` | variant.type | 24 | **S** fixed: 24 on 2,604/2,604 | <!-- EXT-18.6-010 --> |

The LibraryPart (record at 0x32) has five full prefixes. Their stops, outermost first, are the record end (0x11C), the end of the display list (0x10D), the end of the bbox (0xCA), the end of `source_library` (0x8A) and the end of the preamble (0x6A). Real LibraryParts have five full prefixes with stops at these five places on 2,604/2,604 **S**. <!-- EXT-18.6-011 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x32 | `18 E1 00 00 00 00 00 00 00` | full prefix 1 | type 24, end_offset 225 (stop 0x11C) | **S** fixed: type 24 on 2,604/2,604 | <!-- EXT-18.6-012 --> |
| +0x3B | `18 C9 00 00 00 00 00 00 00` | full prefix 2 | type 24, end_offset 201 (stop 0x10D) | **S** fixed: type 24 on 2,604/2,604 | <!-- EXT-18.6-013 --> |
| +0x44 | `18 7D 00 00 00 00 00 00 00` | full prefix 3 | type 24, end_offset 125 (stop 0xCA) | **S** fixed: type 24 on 2,604/2,604 | <!-- EXT-18.6-014 --> |
| +0x4D | `18 34 00 00 00 00 00 00 00` | full prefix 4 | type 24, end_offset 52 (stop 0x8A) | **S** fixed: type 24 on 2,604/2,604 | <!-- EXT-18.6-015 --> |
| +0x56 | `18 0B 00 00 00 00 00 00 00` | full prefix 5 | type 24, end_offset 11 (stop 0x6A) | **S** fixed: type 24 on 2,604/2,604 | <!-- EXT-18.6-016 --> |
| +0x5F | `18 00 00` | short prefix | type 24, count 0 | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-017 --> |
| +0x62 | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 2,604/2,604 | <!-- EXT-18.6-018 --> |
| +0x6A | `0C 00 50 41 52 54 31 2E … (15 bytes)` | name | "PART1.Normal" | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-019 --> |
| +0x79 | `0E 00 43 3A 5C 45 58 41 … (17 bytes)` | source_library | "C:\EXAMPLE.OLB" | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-020 --> |
| +0x8A | `30 00 00 00` | color | 48 | **S** fixed: 48 on 2,604/2,604 | <!-- EXT-18.6-021 --> |
| +0x8E | `01 00` | primitive_count | 1 | **S** layout holds on all 2,548; value is content | <!-- EXT-18.6-022 --> |
| +0x90 | `28` | selector | 40 (Rect) | **S** fixed: 40 (Rect selector) on 1,647/1,647 | <!-- EXT-18.6-023 --> |
| +0x91 | `28` | kind | 40 | **S** fixed: kind = selector on 1,647/1,647 | <!-- EXT-18.6-024 --> |
| +0x92 | `28 00 00 00` | length | 40 | **S** 40 on 1,272/1,662 Rects; 32 on 390 Rects, which use the short primitive form and carry no preamble | <!-- EXT-18.6-025 --> |
| +0x96 | `00 00 00 00` | reserved | 0 | **S** fixed: 0 on 1,647/1,647 | <!-- EXT-18.6-026 --> |
| +0x9A | `0A 00 00 00` | x1 | 10 | **S** layout holds on all 1,647; value is content | <!-- EXT-18.6-027 --> |
| +0x9E | `00 00 00 00` | y1 | 0 | **S** layout holds on all 1,647; value is content | <!-- EXT-18.6-028 --> |
| +0xA2 | `1E 00 00 00` | x2 | 30 | **S** layout holds on all 1,647; value is content | <!-- EXT-18.6-029 --> |
| +0xA6 | `14 00 00 00` | y2 | 20 | **S** layout holds on all 1,647; value is content | <!-- EXT-18.6-030 --> |
| +0xAA | `00 00 00 00` | line_style | 0 (Solid) | **S** layout holds on all 1,647; value is content | <!-- EXT-18.6-031 --> |
| +0xAE | `00 00 00 00` | line_width | 0 (Thin) | **S** layout holds on all 1,647; value is content | <!-- EXT-18.6-032 --> |
| +0xB2 | `01 00 00 00` | fill | 1 (None) | **S** layout holds on all 1,647; value is content | <!-- EXT-18.6-033 --> |
| +0xB6 | `FF FF FF FF` | hatch | -1 | **S** layout holds on all 1,647; value is content | <!-- EXT-18.6-034 --> |
| +0xBA | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** present on 1,272/1,662 Rects; absent on the 390 short-form Rects | <!-- EXT-18.6-035 --> |
| +0xC2 | `00 00 00 00 1E 00 14 00` | bbox | x1 0, y1 0, x2 30, y2 20 | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-036 --> |
| +0xCA | `01 00` | pin_slot_count | 1 | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-037 --> |
| +0xCC | `1A 36 00 00 00 00 00 00 00` | full prefix 1 | type 26, end_offset 54 (stop 0x10B) | **S** fixed: type 26 on 30,571/30,571 | <!-- EXT-18.6-038 --> |
| +0xD5 | `1A 0B 00 00 00 00 00 00 00` | full prefix 2 | type 26, end_offset 11 (stop 0xE9) | **S** fixed: type 26 on 30,571/30,571 | <!-- EXT-18.6-039 --> |
| +0xDE | `1A 00 00` | short prefix | type 26, count 0 | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-040 --> |
| +0xE1 | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 30,571/30,571 | <!-- EXT-18.6-041 --> |
| +0xE9 | `01 00 31 00` | name | "1" | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-042 --> |
| +0xED | `0A 00 00 00` | start_x | 10 | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-043 --> |
| +0xF1 | `0A 00 00 00` | start_y | 10 | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-044 --> |
| +0xF5 | `00 00 00 00` | hotpt_x | 0 | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-045 --> |
| +0xF9 | `0A 00 00 00` | hotpt_y | 10 | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-046 --> |
| +0xFD | `20 00` | shape | 32 (Visible) | **S** layout on 30,571/30,571; Visible bit set on 30,465, clear on 106 (content) | <!-- EXT-18.6-047 --> |
| +0xFF | `00 00` | opaque_word | 0 | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-048 --> |
| +0x101 | `04 00 00 00` | pin_type | 4 (Passive) | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-049 --> |
| +0x105 | `1A` | tail_tag | 26 | **S** fixed: 26 (= record type) on 30,571/30,571 | <!-- EXT-18.6-050 --> |
| +0x106 | `00 00 00` | tail_opaque | 0 | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-051 --> |
| +0x109 | `00 00` | display_count | 0 | **S** layout holds on all 30,571; value is content | <!-- EXT-18.6-052 --> |
| +0x10B | `00 00` | display_count | 0 | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-053 --> |
| +0x10D | `00 00 00` | contents_library | empty | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-054 --> |
| +0x110 | `00 00 00` | contents_view | empty | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-055 --> |
| +0x113 | `01 00 52 00` | reference | "R" | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-056 --> |
| +0x117 | `00 00 00` | value | empty | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-057 --> |
| +0x11A | `00 00` | part_flags | 0 | **S** layout holds on all 2,604; value is content | <!-- EXT-18.6-058 --> |

Primitives have a second, short encoding (new): `length` stops 8 bytes before the end of the fields and no preamble follows, so the entry is 2 + `length` + 8 bytes. It is the bare form of §8.3 (11,508 entries over all containers). Counted over LibraryPart primitive walks and kinds 40 to 45 only, it covers 3,082 entries in 23 files, among them 390 Rects with length 32 whose fill and hatch words take the preamble's 8 bytes (for example `parallella-aafm/HB1A-AAFM.DSN`, Cache offset 11027) **S**. With it, all 2,604 LibraryPart primitive lists walk exactly to their bbox; it accounts for the 56 cached symbols an earlier reader could not walk. <!-- EXT-18.6-025 EXT-18.6-035 -->

Table 3, the PartCell (record at 0x143):

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x11C | `01 00 05 00 50 41 52 54 … (39 bytes)` | table 3 header | group_count 1 (group "PART1"; 1 variant; source_library "C:\EXAMPLE.OLB"; id and id_copy 1700000000; type 6. Same layout as the table-2 header) | **S** layout holds on all 2,570; value is content | <!-- EXT-18.6-060 --> |
| +0x143 | `06 47 00 00 00 00 00 00 00` | full prefix 1 | type 6, end_offset 71 (stop 0x193) | **S** fixed: type 6 on 2,570/2,570 | <!-- EXT-18.6-061 --> |
| +0x14C | `06 2D 00 00 00 00 00 00 00` | full prefix 2 | type 6, end_offset 45 (stop 0x182) | **S** fixed: type 6 on 2,570/2,570 | <!-- EXT-18.6-062 --> |
| +0x155 | `06 0B 00 00 00 00 00 00 00` | full prefix 3 | type 6, end_offset 11 (stop 0x169) | **S** fixed: type 6 on 2,570/2,570 | <!-- EXT-18.6-063 --> |
| +0x15E | `06 FF FF` | short prefix | type 6, count -1 | **S** fixed: count -1 on 2,570/2,570 | <!-- EXT-18.6-064 --> |
| +0x161 | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 2,570/2,570 | <!-- EXT-18.6-065 --> |
| +0x169 | `05 00 50 41 52 54 31 00` | name | "PART1" | **S** layout holds on all 2,570; value is content | <!-- EXT-18.6-066 --> |
| +0x171 | `0E 00 43 3A 5C 45 58 41 … (17 bytes)` | source_library | "C:\EXAMPLE.OLB" | **S** layout holds on all 2,570; value is content | <!-- EXT-18.6-067 --> |
| +0x182 | `01 00` | view_count | 1 | **S** layout holds on all 2,570; value is content | <!-- EXT-18.6-068 --> |
| +0x184 | `0C 00 50 41 52 54 31 2E … (15 bytes)` | view[0] | "PART1.Normal" | **S** fixed: <cell>.Normal / .Convert on 2,570/2,570 | <!-- EXT-18.6-069 --> |

Table 4, the Package with one Device (record at 0x1BA):

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x193 | `01 00 05 00 50 41 52 54 … (39 bytes)` | table 4 header | As table 3, with type 31 | **S** layout holds on all 2,375; value is content | <!-- EXT-18.6-070 --> |
| +0x1BA | `1F 71 00 00 00 00 00 00 00` | full prefix 1 | type 31, end_offset 113 (stop 0x234) | **S** fixed: type 31 on 2,375/2,375 | <!-- EXT-18.6-071 --> |
| +0x1C3 | `1F 2D 00 00 00 00 00 00 00` | full prefix 2 | type 31, end_offset 45 (stop 0x1F9) | **S** fixed: type 31 on 2,375/2,375 | <!-- EXT-18.6-072 --> |
| +0x1CC | `1F 0B 00 00 00 00 00 00 00` | full prefix 3 | type 31, end_offset 11 (stop 0x1E0) | **S** fixed: type 31 on 2,375/2,375 | <!-- EXT-18.6-073 --> |
| +0x1D5 | `1F 00 00` | short prefix | type 31, count 0 | **S** fixed: count 0 on 2,375/2,375 | <!-- EXT-18.6-074 --> |
| +0x1D8 | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 2,375/2,375 | <!-- EXT-18.6-075 --> |
| +0x1E0 | `05 00 50 41 52 54 31 00` | name | "PART1" | **S** layout holds on all 2,375; value is content | <!-- EXT-18.6-076 --> |
| +0x1E8 | `0E 00 43 3A 5C 45 58 41 … (17 bytes)` | source_library | "C:\EXAMPLE.OLB" | **S** layout holds on all 2,375; value is content | <!-- EXT-18.6-077 --> |
| +0x1F9 | `01 00 52 00` | refdes_prefix | "R" | **S** layout holds on all 2,375; value is content | <!-- EXT-18.6-078 --> |
| +0x1FD | `00 00 00` | pcb_library | empty | **S** layout holds on all 2,375; value is content | <!-- EXT-18.6-079 --> |
| +0x200 | `00 00 00` | pcb_footprint | empty | **S** layout holds on all 2,375; value is content | <!-- EXT-18.6-080 --> |
| +0x203 | `01 00` | device_count | 1 | **S** layout holds on all 2,375; value is content | <!-- EXT-18.6-081 --> |
| +0x205 | `20 26 00 00 00 00 00 00 00` | full prefix 1 | type 32, end_offset 38 (stop 0x234) | **S** fixed: type 32 on 2,735/2,735 | <!-- EXT-18.6-082 --> |
| +0x20E | `20 0B 00 00 00 00 00 00 00` | full prefix 2 | type 32, end_offset 11 (stop 0x222) | **S** fixed: type 32 on 2,735/2,735 | <!-- EXT-18.6-083 --> |
| +0x217 | `20 FF FF` | short prefix | type 32, count -1 | **S** fixed: count -1 on 2,735/2,735 | <!-- EXT-18.6-084 --> |
| +0x21A | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 2,735/2,735 | <!-- EXT-18.6-085 --> |
| +0x222 | `00 00 00` | unit_ref | empty (single device) | **S** layout holds on all 2,735; value is content | <!-- EXT-18.6-086 --> |
| +0x225 | `05 00 50 41 52 54 31 00` | cell | "PART1" | **S** layout holds on all 2,735; value is content | <!-- EXT-18.6-087 --> |
| +0x22D | `01 00` | pin_slot_count | 1 | **S** layout holds on all 2,735; value is content | <!-- EXT-18.6-088 --> |
| +0x22F | `01 00 31 00` | pin_numbers[0].number | "1" | **S** layout holds on all 32,254; value is content | <!-- EXT-18.6-089 --> |
| +0x233 | `7F` | pin_numbers[0].flag | 127 | **S** 127 on 32,116/32,254 slots; other values below 128 on 96, 128 or above on 42 | <!-- EXT-18.6-090 --> |

The Package ends exactly at the end of the `Cache` stream. Every real `Cache` ends exactly after table 4 (105/105), though in real files table 4 may end with zero-variant groups rather than a package **S**. <!-- EXT-18.6-091 --> The three Cache records share id 1700000000, which is within 2 s of `Library.modified`; every real Cache id is at most `Library.modified` + 2 s (7,549/7,549 variants) **S**. <!-- EXT-18.6-092 -->

### 18.7 `Views/SCHEMATIC1/Schematic` (68 bytes)

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `09 0B 00 00 00 00 00 00 00` | full prefix | type 9, end_offset 11 (stop 0x14) | **S** fixed: type 9, one full prefix on 162/162 | <!-- EXT-18.7-001 --> |
| +0x09 | `09 00 00` | short prefix | type 9, count 0 | **S** fixed: count 0 on 162/162 | <!-- EXT-18.7-002 --> |
| +0x0C | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 162/162 | <!-- EXT-18.7-003 --> |
| +0x14 | `0A 00 53 43 48 45 4D 41 … (13 bytes)` | name | "SCHEMATIC1" | **S** layout on 162/162; equals the folder name on 161, differs on 1 | <!-- EXT-18.7-004 --> |
| +0x21 | `0C 00 00 00` | max_id | 12 | **S** layout holds on all 162; value is content | <!-- EXT-18.7-005 --> |
| +0x25 | `01 00` | page_count | 1 | **S** fixed: = number of page streams on 162/162 | <!-- EXT-18.7-006 --> |
| +0x27 | `05 00 50 41 47 45 31 00` | pages[0] | "PAGE1" | **S** layout holds on all 162; value is content | <!-- EXT-18.7-007 --> |
| +0x2F | `02 00` | registry_count | 2 | **S** layout holds on all 162; value is content | <!-- EXT-18.7-008 --> |
| +0x31 | `0A 00 00 00` | id_registry[0] | 10 (placed part) | **S** layout holds on all 162; value is content | <!-- EXT-18.7-009 --> |
| +0x35 | `0B 00 00 00` | id_registry[1] | 11 (wire) | **S** layout holds on all 162; value is content | <!-- EXT-18.7-010 --> |
| +0x39 | `01 00` | tail_count | 1 | **S** layout holds on all 162; value is content | <!-- EXT-18.7-011 --> |
| +0x3B | `52` | tail[0].key | 82 ('R') | **S** layout holds on all 917; value is content | <!-- EXT-18.7-012 --> |
| +0x3C | `02 00 00 00` | tail[0].value | 2 | **S** layout holds on all 917; value is content | <!-- EXT-18.7-013 --> |
| +0x40 | `00 00 00 00` | reserved | 0 | **S** fixed: 0 on 162/162 | <!-- EXT-18.7-014 --> |

The registry holds the ids of the placed part and the wire, and the wire id is also the pin's connection field. On real files the registry holds every wire id and every placed or drawn instance id, and never a SchematicNet id, in 162/162 folders **S**. <!-- EXT-18.7-016 --> `max_id` 12 is the largest object id in use (part 10, wire 11, net 12). It is at least every wire id in 162/162 folders, and larger than every root occurrence id and the occurrence watermark in 103 of 104 root folders (1 exception) **S**. <!-- EXT-18.7-015 -->

### 18.8 `Views/SCHEMATIC1/Pages/PAGE1` (614 bytes)

The outer full prefix's stop is the end of the stream, as on 451/451 real pages **S**. <!-- EXT-18.8-008 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `0A 5D 02 00 00 00 00 00 00` | full prefix 1 | type 10, end_offset 605 (stop 0x266) | **S** fixed: type 10 on 451/451 | <!-- EXT-18.8-001 --> |
| +0x09 | `0A 0B 00 00 00 00 00 00 00` | full prefix 2 | type 10, end_offset 11 (stop 0x1D) | **S** fixed: type 10 on 451/451 | <!-- EXT-18.8-002 --> |
| +0x12 | `0A 00 00` | short prefix | type 10, count 0 | **S** fixed: count 0 on 451/451 | <!-- EXT-18.8-003 --> |
| +0x15 | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 451/451 | <!-- EXT-18.8-004 --> |
| +0x1D | `05 00 50 41 47 45 31 00` | page name | "PAGE1" | **S** fixed: = page stream name on 451/451 | <!-- EXT-18.8-005 --> |
| +0x25 | `01 00 41 00` | page size name | "A" | **S** layout holds on all 451; value is content | <!-- EXT-18.8-006 --> |
| +0x29 | `00 F1 53 65 00 F1 53 65 … (156 bytes)` | PageSettings | Non-zero fields below | **S** layout holds on all 451; value is content | <!-- EXT-18.8-007 --> |

The PageSettings block starts at page +0x29; offsets below are relative to it. Unlisted fields are 0, including `horizontal_char` at +0x64 (0 on 451/451 real pages) and the `u16` at +0x2A (0 on 367/451, other values on the rest, so it is content) **S**. <!-- EXT-18.8-009 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `00 F1 53 65` | created | 1700000000 | **S** fixed: non-zero time on 451/451 | <!-- EXT-18.8-010 --> |
| +0x04 | `00 F1 53 65` | modified | 1700000000 | **S** fixed: non-zero time on 451/451 | <!-- EXT-18.8-011 --> |
| +0x18 | `E4 25 00 00` | width | 9700 mil | **S** layout holds on all 451; value is content | <!-- EXT-18.8-012 --> |
| +0x1C | `20 1C 00 00` | height | 7200 mil | **S** layout holds on all 451; value is content | <!-- EXT-18.8-013 --> |
| +0x20 | `64 00 00 00` | pin-to-pin | 100 | **S** 100 on 259/451 pages, exactly the pages with IsMetric 0; 2540 on 183 and 1000 on 9 (the IsMetric 1 pages) | <!-- EXT-18.8-014 --> |
| +0x26 | `05 00` | horizontal count | 5 | **S** layout on 451/451; 5 on 442, 4 on 7, 10 on 2 (content) | <!-- EXT-18.8-015 --> |
| +0x28 | `04 00` | vertical count | 4 | **S** layout holds on all 451; value is content | <!-- EXT-18.8-016 --> |
| +0x2C | `64 00 00 00` | horizontal width | 100 | **S** layout holds on all 451; value is content | <!-- EXT-18.8-017 --> |
| +0x30 | `64 00 00 00` | vertical width | 100 (equal to +0x2C) | **S** fixed: equal to +0x2C on 451/451 | <!-- EXT-18.8-018 --> |
| +0x34 | `30 00 00 00` | colour | 48 | **S** fixed: 48 on 451/451 | <!-- EXT-18.8-019 --> |
| +0x38 | `30 00 00 00` | label colour | 48 | **S** fixed: 48 on 451/451 | <!-- EXT-18.8-020 --> |
| +0x5C | `01 00 00 00` | outer border visible | 1 | **S** fixed: 1 on 451/451 | <!-- EXT-18.8-021 --> |
| +0x6C | `01 00 00 00` | horizontal ascending | 1 | **S** layout on 451/451; 1 on 9, 0 on 442 (content) | <!-- EXT-18.8-022 --> |
| +0x70 | `01 00 00 00` | vertical labels are characters | 1 | **S** fixed: 1 on 451/451 | <!-- EXT-18.8-023 --> |
| +0x78 | `01 00 00 00` | vertical ascending | 1 | **S** layout on 451/451; 1 on 9, 0 on 442 (content) | <!-- EXT-18.8-024 --> |
| +0x80 | `01 00 00 00` | border displayed | 1 | **S** fixed: 1 on 451/451 | <!-- EXT-18.8-025 --> |
| +0x84 | `01 00 00 00` | border printed | 1 | **S** fixed: 1 on 451/451 | <!-- EXT-18.8-026 --> |
| +0x88 | `01 00 00 00` | grid reference displayed | 1 | **S** fixed: 1 on 451/451 | <!-- EXT-18.8-027 --> |
| +0x8C | `01 00 00 00` | grid reference printed | 1 | **S** fixed: 1 on 451/451 | <!-- EXT-18.8-028 --> |
| +0x90 | `01 00 00 00` | title block displayed | 1 | **S** fixed: 1 on 451/451 | <!-- EXT-18.8-029 --> |
| +0x94 | `01 00 00 00` | title block printed | 1 | **S** fixed: 1 on 451/451 | <!-- EXT-18.8-030 --> |
| +0x98 | `01 00 00 00` | ANSI grid references | 1 | **S** fixed: 1 on 451/451 | <!-- EXT-18.8-031 --> |

Label colour 48 with HorizontalChar 0, VerticalChar 1, TitleBlockPrinted 1 and ANSIGridRefs 1 is the combination every real page carries (451/451); the other listed combination (label colour 12, HorizontalChar 1, VerticalChar 0, TitleBlockPrinted 0, ANSIGridRefs 0) occurs on no page **S** (partial). <!-- EXT-18.8-032 -->

List 2 holds the net header, list 4 the net-name row, list 5 the wire with its alias, list 6 the placed part with its display property and pin. The 14 lists in their fixed order walk to the exact end of 450/451 real pages **S**. <!-- EXT-18.8-033 -->

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0xC5 | `00 00` | list 1 count | 0 (title blocks) | **S** layout holds on all 451; value is content | <!-- EXT-18.8-034 --> |
| +0xC7 | `01 00` | list 2 count | 1 (scalar nets) | **S** layout holds on all 451; value is content | <!-- EXT-18.8-035 --> |
| +0xC9 | `34 17 00 00 00 00 00 00 00` | full prefix | type 52, end_offset 23 (stop 0xE9) | **S** type 52, one full prefix, no short prefix on 27,116/27,116 | <!-- EXT-18.8-036 --> |
| +0xD2 | `0C 00 00 00` | net id | 12 | **S** layout holds on all 27,117; value is content | <!-- EXT-18.8-037 --> |
| +0xD6 | `00 00 00` | name | empty | **S** fixed: empty on 27,116/27,116 | <!-- EXT-18.8-038 --> |
| +0xD9 | `00 00 00 00` | reserved | 0 | **S** fixed: 0 on 27,116/27,116 | <!-- EXT-18.8-039 --> |
| +0xDD | `30 00 00 00` | net colour | 48 | **S** fixed: 48 on 27,116/27,116 | <!-- EXT-18.8-040 --> |
| +0xE1 | `05 00 00 00` | net line style | 5 | **S** fixed: 5 on 27,116/27,116 | <!-- EXT-18.8-041 --> |
| +0xE5 | `03 00 00 00` | net line width | 3 | **S** fixed: 3 on 27,116/27,116 | <!-- EXT-18.8-042 --> |
| +0xE9 | `00 00` | list 3 count | 0 (bus nets) | **S** layout holds on all 450; value is content | <!-- EXT-18.8-043 --> |
| +0xEB | `01 00` | list 4 count | 1 (net names) | **S** layout holds on all 450; value is content | <!-- EXT-18.8-044 --> |
| +0xED | `04 00 4E 45 54 31 00` | row.net name | "NET1" | **S** layout holds on all 25,479; value is content | <!-- EXT-18.8-045 --> |
| +0xF4 | `0C 00 00 00` | row.net id | 12 | **S** layout holds on all 25,479; value is content | <!-- EXT-18.8-046 --> |
| +0xF8 | `01 00` | list 5 count | 1 (wires) | **S** layout holds on all 450; value is content | <!-- EXT-18.8-047 --> |
| +0xFA | `14 75 00 00 00 00 00 00 00` | full prefix 1 | type 20, end_offset 117 (stop 0x178) | **S** fixed: type 20 on 82,550/82,550 | <!-- EXT-18.8-048 --> |
| +0x103 | `14 0B 00 00 00 00 00 00 00` | full prefix 2 | type 20, end_offset 11 (stop 0x117) | **S** fixed: type 20 on 82,550/82,550 | <!-- EXT-18.8-049 --> |
| +0x10C | `14 00 00` | short prefix | type 20, count 0 | **S** layout holds on all 82,550; value is content | <!-- EXT-18.8-050 --> |
| +0x10F | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 82,550/82,550 | <!-- EXT-18.8-051 --> |
| +0x117 | `0B 00 00 00` | db_id | 11 | **S** layout holds on all 82,550; value is content | <!-- EXT-18.8-052 --> |
| +0x11B | `0C 00 00 00` | net id | 12 | **S** fixed: a SchematicNet id of the page on 82,550/82,550 | <!-- EXT-18.8-053 --> |
| +0x11F | `30 00 00 00` | colour | 48 (use net colour) | **S** 48 on 82,530/82,550; 8 on 20 | <!-- EXT-18.8-054 --> |
| +0x123 | `3C 00 00 00` | start x | 60 | **S** layout holds on all 82,550; value is content | <!-- EXT-18.8-055 --> |
| +0x127 | `6E 00 00 00` | start y | 110 | **S** layout holds on all 82,550; value is content | <!-- EXT-18.8-056 --> |
| +0x12B | `64 00 00 00` | end x | 100 | **S** layout holds on all 82,550; value is content | <!-- EXT-18.8-057 --> |
| +0x12F | `6E 00 00 00` | end y | 110 | **S** layout holds on all 82,550; value is content | <!-- EXT-18.8-058 --> |
| +0x133 | `00` | junction flags | 0 | **S** layout holds on all 82,550; value is content | <!-- EXT-18.8-059 --> |
| +0x134 | `01 00` | alias count | 1 | **S** layout holds on all 82,550; value is content | <!-- EXT-18.8-060 --> |
| +0x136 | `31 2F 00 00 00 00 00 00 00` | full prefix 1 | type 49, end_offset 47 (stop 0x16E) | **S** fixed: type 49 on 16,165/16,165 | <!-- EXT-18.8-061 --> |
| +0x13F | `31 0B 00 00 00 00 00 00 00` | full prefix 2 | type 49, end_offset 11 (stop 0x153) | **S** fixed: type 49 on 16,165/16,165 | <!-- EXT-18.8-062 --> |
| +0x148 | `31 FF FF` | short prefix | type 49, count -1 | **S** fixed: count -1 on 16,165/16,165 | <!-- EXT-18.8-063 --> |
| +0x14B | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 16,165/16,165 | <!-- EXT-18.8-064 --> |
| +0x153 | `46 00 00 00` | x | 70 | **S** layout holds on all 16,165; value is content | <!-- EXT-18.8-065 --> |
| +0x157 | `6E 00 00 00` | y | 110 | **S** layout holds on all 16,165; value is content | <!-- EXT-18.8-066 --> |
| +0x15B | `30 00 00 00` | colour | 48 | **S** 48 on 15,910/16,165; other colours (1, 8, 10, 17 and more) on 255 | <!-- EXT-18.8-067 --> |
| +0x15F | `00 00 00 00` | rotation | 0 | **S** layout holds on all 16,165; value is content | <!-- EXT-18.8-068 --> |
| +0x163 | `01 00 00 00` | font reference | 1 (row 1) | **S** layout holds on all 16,165; value is content | <!-- EXT-18.8-069 --> |
| +0x167 | `04 00 4E 45 54 31 00` | name | "NET1" | **S** layout holds on all 16,165; value is content | <!-- EXT-18.8-070 --> |
| +0x16E | `00 00` | display count | 0 | **S** layout holds on all 82,550; value is content | <!-- EXT-18.8-071 --> |
| +0x170 | `03 00 00 00` | line width | 3 (Default) | **S** 3 on 82,524/82,550; 1 on 20, 0 on 6 | <!-- EXT-18.8-072 --> |
| +0x174 | `05 00 00 00` | line style | 5 (Default) | **S** fixed: 5 on 82,550/82,550 | <!-- EXT-18.8-073 --> |
| +0x178 | `01 00` | list 6 count | 1 (part instances) | **S** layout holds on all 450; value is content | <!-- EXT-18.8-074 --> |
| +0x17A | `0D D3 00 00 00 00 00 00 00` | full prefix 1 | type 13, end_offset 211 (stop 0x256) | **S** fixed: type 13 on 14,988/14,988 | <!-- EXT-18.8-075 --> |
| +0x183 | `0D C0 00 00 00 00 00 00 00` | full prefix 2 | type 13, end_offset 192 (stop 0x24C) | **S** fixed: type 13 on 14,988/14,988 | <!-- EXT-18.8-076 --> |
| +0x18C | `0D 75 00 00 00 00 00 00 00` | full prefix 3 | type 13, end_offset 117 (stop 0x20A) | **S** fixed: type 13 on 14,988/14,988 | <!-- EXT-18.8-077 --> |
| +0x195 | `0D 13 00 00 00 00 00 00 00` | full prefix 4 | type 13, end_offset 19 (stop 0x1B1) | **S** fixed: type 13 on 14,988/14,988 | <!-- EXT-18.8-078 --> |
| +0x19E | `0D 01 00 03 00 00 00 04 00 00 00` | short prefix | type 13, count 1, pair (3, 4) | **S** type 13 with count above 0 on 14,988/14,988; a pair named Value on only 2/14,988 (content) | <!-- EXT-18.8-079 --> |
| +0x1A9 | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-080 --> |
| +0x1B1 | `02 00 00 00` | name index | 2 ("INS1") | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-081 --> |
| +0x1B5 | `01 00 00 00` | library index | 1 | **S** fixed: a non-zero string index on 14,988/14,988 | <!-- EXT-18.8-082 --> |
| +0x1B9 | `0C 00 50 41 52 54 31 2E … (15 bytes)` | symbol name | "PART1.Normal" | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-083 --> |
| +0x1C8 | `0A 00 00 00` | db_id | 10 | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-084 --> |
| +0x1CC | `64 00 64 00 78 00 82 00` | bbox y1, x1, y2, x2 | 100, 100, 120, 130 | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-085 --> |
| +0x1D4 | `64 00` | loc x | 100 | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-086 --> |
| +0x1D6 | `64 00` | loc y | 100 | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-087 --> |
| +0x1D8 | `30 00` | transform | 48 (colour 48, r 0, no mirror) | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-088 --> |
| +0x1DA | `0D` | type echo | 13 | **S** fixed: 13 (= record type) on 14,988/14,988 | <!-- EXT-18.8-089 --> |
| +0x1DB | `00` | reserved | 0 | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-090 --> |
| +0x1DC | `01 00` | display count | 1 | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-091 --> |
| +0x1DE | `27 22 00 00 00 00 00 00 00` | full prefix 1 | type 39, end_offset 34 (stop 0x209) | **S** fixed: type 39 on 43,281/43,281 | <!-- EXT-18.8-092 --> |
| +0x1E7 | `27 0B 00 00 00 00 00 00 00` | full prefix 2 | type 39, end_offset 11 (stop 0x1FB) | **S** fixed: type 39 on 43,281/43,281 | <!-- EXT-18.8-093 --> |
| +0x1F0 | `27 FF FF` | short prefix | type 39, count -1 | **S** fixed: count -1 on 43,281/43,281 | <!-- EXT-18.8-094 --> |
| +0x1F3 | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** magic, length 0 on 43,236/43,281; length above 0 on 45 | <!-- EXT-18.8-095 --> |
| +0x1FB | `05 00 00 00` | name_index | 5 ("Part Reference") | **S** layout holds on all 43,281; value is content | <!-- EXT-18.8-096 --> |
| +0x1FF | `23 00` | x | 35 | **S** layout (i16) on 43,281/43,281; value is content | <!-- EXT-18.8-097 --> |
| +0x201 | `05 00` | y | 5 | **S** layout (i16) on 43,281/43,281; value is content | <!-- EXT-18.8-098 --> |
| +0x203 | `01 00` | font_rotation | 1 (font row 1, rotation 0) | **S** layout holds on all 43,281; value is content | <!-- EXT-18.8-099 --> |
| +0x205 | `30` | color | 48 | **S** layout holds on all 43,281; value is content | <!-- EXT-18.8-100 --> |
| +0x206 | `00` | opaque | 0 | **S** layout holds on all 43,281; value is content | <!-- EXT-18.8-101 --> |
| +0x207 | `01 00` | display_mode | 1 (ValueOnly) | **S** 1 on 42,268/43,281; 0 on 967, 2 on 28, 3 on 18 | <!-- EXT-18.8-102 --> |
| +0x209 | `18` | symbol kind | 24 (LibraryPart) | **S** fixed: 24 on 14,988/14,988 | <!-- EXT-18.8-103 --> |
| +0x20A | `02 00 52 31 00` | reference | "R1" | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-104 --> |
| +0x20F | `04 00 00 00` | value index | 4 ("1k") | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-105 --> |
| +0x213 | `00 00 00 00` | contents library index | 0 | **S** 0 on 14,984/14,988; non-zero on 4 | <!-- EXT-18.8-106 --> |
| +0x217 | `00 00 00 00` | contents view index | 0 | **S** 0 on 14,930/14,988; non-zero on 58 | <!-- EXT-18.8-107 --> |
| +0x21B | `02 00` | primitive word | 2 (IsPrimitive = 2 (inherited)) | **S** IsPrimitive 2 on 14,984/14,988; 1 on 4 (all in one design) | <!-- EXT-18.8-108 --> |
| +0x21D | `01 00` | pin count | 1 | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-109 --> |
| +0x21F | `10 24 00 00 00 00 00 00 00` | full prefix 1 | type 16, end_offset 36 (stop 0x24C) | **S** fixed: type 16 on 60,258/60,258 | <!-- EXT-18.8-110 --> |
| +0x228 | `10 0B 00 00 00 00 00 00 00` | full prefix 2 | type 16, end_offset 11 (stop 0x23C) | **S** fixed: type 16 on 60,258/60,258 | <!-- EXT-18.8-111 --> |
| +0x231 | `10 00 00` | short prefix | type 16, count 0 | **S** layout holds on all 60,258; value is content | <!-- EXT-18.8-112 --> |
| +0x234 | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 60,258/60,258 | <!-- EXT-18.8-113 --> |
| +0x23C | `01 00` | pin word | 1 (ordinal 1) | **S** layout holds on all 60,258; value is content | <!-- EXT-18.8-114 --> |
| +0x23E | `64 00` | point x | 100 | **S** layout holds on all 60,258; value is content | <!-- EXT-18.8-115 --> |
| +0x240 | `6E 00` | point y | 110 | **S** layout holds on all 60,258; value is content | <!-- EXT-18.8-116 --> |
| +0x242 | `0B 00 00 00` | wire id | 11 | **S** layout holds on all 60,258; value is content | <!-- EXT-18.8-117 --> |
| +0x246 | `00 00 00 00` | net id | 0 (wired pin) | **S** 0 on every wired pin, 55,363/55,363 | <!-- EXT-18.8-118 --> |
| +0x24A | `00 00` | display count | 0 | **S** layout holds on all 60,258; value is content | <!-- EXT-18.8-119 --> |
| +0x24C | `05 00 50 41 52 54 31 00` | source package | "PART1" | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-120 --> |
| +0x254 | `00 00` | device index | 0 | **S** layout holds on all 14,988; value is content | <!-- EXT-18.8-121 --> |
| +0x256 | `00 × 16` | list 7 to list 14 counts | 0 each: no ports, globals, off-page connectors, ERC markers, bus entries or graphics | **S** layout holds on all 450; value is content | <!-- EXT-18.8-122 --> |

Rules the example shows, each checked on real pages **S**:

- The SchematicNet (0xC9) has one full prefix and no short prefix, and its region ends right after the line-width word (27,116/27,116). <!-- EXT-18.8-123 -->
- The PlacedInstance (0x17A) has four full prefixes, with stops after the device index (0x256), after the last pin (0x24C), after the symbol-kind byte (0x20A) and at the end of the preamble (0x1B1); all four are correct on 14,988/14,988. <!-- EXT-18.8-124 -->
- A wire stores line width before line style (width 3 on 82,524, style 5 on 82,550, ending at the stop); a net header stores style before width (27,116/27,116). <!-- EXT-18.8-125 -->
- The pin's net id (pin +0x0A) is 0 because a wire touches the pin; every wired pin has net id 0 (55,363/55,363). <!-- EXT-18.8-126 -->
- The display property and the alias use the explicit font reference 1. Explicit references (1 or more) occur on 10,717 aliases and 3,380 display properties; 0 (implicit) on the rest. The example's choice is content. <!-- EXT-18.8-127 -->
- The placed part's bbox (100, 100)-(130, 120) is the symbol bbox moved to the location and contains the location; every non-zero placed-part bbox contains its location (14,617/14,617; 371 boxes are all zero). The bbox value is content. <!-- EXT-18.8-128 -->
- The page record ends exactly after the count of list 14, at the end of the stream (450/451). <!-- EXT-18.8-129 -->

### 18.9 `Views/SCHEMATIC1/Hierarchy/Hierarchy` (167 bytes)

| Offset | Bytes | Field | Example value | Real files | Ids |
| --- | --- | --- | --- | --- | --- |
| +0x00 | `42 45 00 00 00 00 00 00 00` | full prefix (root frame) | type 66, end_offset 69 (stop 0x4E) | **S** fixed: type 66, one full prefix on 109/109 | <!-- EXT-18.9-001 --> |
| +0x09 | `0A 00 53 43 48 45 4D 41 … (13 bytes)` | name | "SCHEMATIC1" | **S** fixed: = folder name on 109/109 | <!-- EXT-18.9-002 --> |
| +0x16 | `00 00 00 00 00 00 00` | reserved | 0 | **S** fixed: seven zero bytes on 109/109 | <!-- EXT-18.9-003 --> |
| +0x1D | `00 00` | port_count | 0 | **S** 0 on 76/109; non-zero on 33: 1 (2), 2 (2), 3 (2), 4 (3), 5 (3), 6 (5), 8 (5), 9, 10, 11, 12, 32, 43 (1 each), 81 (2), 84 (3) | <!-- EXT-18.9-004 --> |
| +0x1F | `01 00` | net_count | 1 | **S** layout holds on all 109; value is content | <!-- EXT-18.9-005 --> |
| +0x21 | `43 0B 00 00 00 00 00 00 00` | full prefix | type 67, end_offset 11 (stop 0x35) | **S** fixed: type 67 on 16,541/16,541 | <!-- EXT-18.9-006 --> |
| +0x2A | `43 00 00` | short prefix | type 67, count 0 | **S** layout holds on all 16,541; value is content | <!-- EXT-18.9-007 --> |
| +0x2D | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 16,541/16,541 | <!-- EXT-18.9-008 --> |
| +0x35 | `01 00 00 00` | id | 1 (net occurrence id) | **S** layout holds on all 16,541; value is content | <!-- EXT-18.9-009 --> |
| +0x39 | `04 00 4E 45 54 31 00` | name | "NET1" | **S** layout holds on all 16,541; value is content | <!-- EXT-18.9-010 --> |
| +0x40 | `00 00` | title_count | 0 | **S** layout holds on all 109; value is content | <!-- EXT-18.9-011 --> |
| +0x42 | `00 00 00 00` | offpage_count | 0 | **S** layout holds on all 109; value is content | <!-- EXT-18.9-012 --> |
| +0x46 | `FF E4 5C 39 00 00 00 00` | root_data: empty preamble | magic, len 0 | **S** form 1 (empty preamble) on 27/109; root data absent (0 bytes) on 81; form 2 on 1 | <!-- EXT-18.9-013 --> |
| +0x4E | `01 00` | root_occurrence_count | 1 | **S** layout holds on all 109; value is content | <!-- EXT-18.9-014 --> |
| +0x50 | `42 0B 00 00 00 00 00 00 00` | full prefix (occurrence link) | type 66, end_offset 11 (stop 0x64) | **S** fixed: type 66 on 13,490/13,490 | <!-- EXT-18.9-015 --> |
| +0x59 | `42 00 00` | short prefix | type 66, count 0 | **S** layout holds on all 13,490; value is content | <!-- EXT-18.9-016 --> |
| +0x5C | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** layout holds on all 13,490; value is content | <!-- EXT-18.9-017 --> |
| +0x64 | `02 00 00 00` | occurrence_id | 2 | **S** layout holds on all 18,375; value is content | <!-- EXT-18.9-018 --> |
| +0x68 | `0A 00 00 00` | instance_id | 10 (db_id of R1) | **S** layout holds on all 18,375; value is content | <!-- EXT-18.9-019 --> |
| +0x6C | `42 30 00 00 00 00 00 00 00` | full prefix (derived frame) | type 66, end_offset 48 (stop 0xA5) | **S** fixed: type 66, one full prefix, no short prefix on 18,375/18,375 | <!-- EXT-18.9-020 --> |
| +0x75 | `00 00 00` | contents | empty (part occurrence) | **S** empty on every part occurrence (18,038); non-empty on every block occurrence (337; one of them sits in the ROHM SENSORS EXPO stream, whose walk stops before that block's child count) | <!-- EXT-18.9-021 --> |
| +0x78 | `02 00` | reference_length | 2 | **S** layout holds on all 18,375; value is content | <!-- EXT-18.9-022 --> |
| +0x7A | `52 31` | reference | "R1" | **S** layout holds on all 18,375; value is content | <!-- EXT-18.9-023 --> |
| +0x7C | `00` | terminator | 0 | **S** fixed: 0 on 18,375/18,375 | <!-- EXT-18.9-024 --> |
| +0x7D | `00 00 00 00` | designator_index | 0 (none) | **S** layout holds on all 18,375; value is content | <!-- EXT-18.9-025 --> |
| +0x81 | `01 00` | pin_count | 1 | **S** layout holds on all 18,375; value is content | <!-- EXT-18.9-026 --> |
| +0x83 | `44 0B 00 00 00 00 00 00 00` | full prefix | type 68, end_offset 11 (stop 0x97) | **S** fixed: type 68 on 83,575/83,575 | <!-- EXT-18.9-027 --> |
| +0x8C | `44 00 00` | short prefix | type 68, count 0 | **S** layout holds on all 83,575; value is content | <!-- EXT-18.9-028 --> |
| +0x8F | `FF E4 5C 39 00 00 00 00` | preamble | magic, len 0 | **S** fixed: magic, len 0 on 83,575/83,575 | <!-- EXT-18.9-029 --> |
| +0x97 | `03 00 00 00` | occurrence_id | 3 (pin occurrence id) | **S** layout holds on all 93,833; value is content | <!-- EXT-18.9-030 --> |
| +0x9B | `00 00` | pin_index | 0 (pin 1) | **S** layout holds on all 93,833; value is content | <!-- EXT-18.9-031 --> |
| +0x9D | `00 00 00 00 00 00 00 00` | trailing_data | part occurrence: 8 zero bytes | **S** fixed: 8 zero bytes on part occurrences on 18,038/18,038 | <!-- EXT-18.9-032 --> |
| +0xA5 | `00 00` | child_count | 0 | **S** 0 on every part occurrence (18,038/18,038); above 0 on all 336 block occurrences whose child count is read (the 337th is in the stopped ROHM stream) | <!-- EXT-18.9-033 --> |

Frame rules, each checked on real Hierarchy streams **S**:

- The root frame (0x00) has one full prefix and no short prefix, and its region ends at the end of the root data (109/109). The example's root data is the empty preamble at 0x46 (form 1). Real streams have form 1 in 27, no root data at all in 81, and form 2 in 1. <!-- EXT-18.9-034 -->
- The design net (0x21), the occurrence link (0x50) and the pin occurrence (0x83) each open with one full prefix whose region covers only the short prefix and the preamble; their fields follow the stop (net 16,541, link 18,375, pin 93,833). <!-- EXT-18.9-035 -->
- The derived frame (0x6C) has no short prefix (18,375/18,375). For a part occurrence its region ends right after the 8 zero bytes of `trailing_data`, just before `child_count` (18,038/18,038). <!-- EXT-18.9-036 -->
- `reference` is an `lstr`-shaped field on all 18,375 occurrences; the example repeats the page instance reference `R1`, which is content. <!-- EXT-18.9-037 -->

### 18.10 Cross-stream references

`Cache`, the pages, the Hierarchy stream and `DsnStream` refer to the `Library` string table, and `Library` holds the occurrence watermark and the root schematic name. PlacedInstance, display-property and property-pair indices resolve into the string table in 105 files **S**. <!-- EXT-18.10.1-001 -->

Values that must agree in the example: the root name in `Library`, the `Views Directory` entry, the storage `Views/SCHEMATIC1`, the Schematic `name` and the Hierarchy root `name` are one string; the page name equals the page stream name and the Schematic page list entry; the wire's net id equals the page net id and the net-name row's net id; the pin's wire id equals the wire's `db_id`; the Hierarchy `instance_id` equals the placed part's `db_id`; the Schematic registry holds the part and wire ids; `max_id` covers all three object ids.

### 18.11 Pin-number resolution examples

These two parts from real designs show how a pin's number comes from the device pin map.

- **A 4-pad crystal with 2 schematic pins: E.** In BeagleBoard-xM, package `QUARTZ-32KHz-CM200S_0` has the `Packages/` pin map [1, 3, 2, 4] and the `Cache` pin map [1, 2], and the part has 2 pin records (pin index 1 and 2). Resolution through the `Cache` map gives pin index 1 → 1 and 2 → 2, which `pstchip.dat` (`CM200S_4`) confirms. INT names the part `XTAL-CM200S`; no part in the design has that name. <!-- INT-12.1-011 -->
- **A quad RJ45 with an extra shield tab: S, E.** `RJ45_1x4_LPJE104-0BENL` in reServer J401 is a package of 4 devices; only device 4 has a 14th pin, `S5`, without the Pin Ignore bit. <!-- INT-12.1-014 --> Pins 13 and 14 per device are: device 1 `S1`/`SS1` (14 ignored), device 2 `S2`/`SS2` (ignored), device 3 `S3`/`SS3` (ignored), device 4 `S4`/`S5` (not ignored) **S**. <!-- INT-12.1-015 --> The design's `pstchip.dat` agrees: the second shield pin is `SHD2` with `PIN_NUMBER='(0,0,0,S5)'`, present only on the fourth device, while `SHD1` is `(S1,S2,S3,S4)` **E**. <!-- INT-12.1-016 -->

### Unverified

- *Unverified:* example geometry is in object coordinates of 1/100 inch. Confirming the unit needs Capture. <!-- EXT-18.1-011 -->
- *Unverified:* the example drawing: a wire from x = 60 to x = 100 at y = 110 with alias `NET1` at x = 70, and the `PART1` rectangle spanning x = 110 to 130, y = 100 to 120, the pin joining the wire at x = 100. No real file holds it. <!-- EXT-18.1-012 -->
- *Unverified:* the part is placed at (100, 100) with no rotation and no mirror. Example content; no real file holds it. <!-- EXT-18.1-013 -->
- *Unverified:* the empty form of the `Library` defaults: eight empty default part fields and an all-default page-settings block. The layout (8 `lstr` and 156 bytes) holds in 105/105, but no real file uses the empty form; all 105 carry the eight named part fields and the common page-settings block. <!-- EXT-18.3-002 -->
- *Unverified:* in the empty defaults form, either slot 10 alone or no default-font slot is zero, and in the example every slot names row 1. No real file has the empty form; every real file has zero slots 3, 4 and 17 to 23. A design saved with empty defaults would settle it. <!-- EXT-18.3-003 -->

- *Unverified:* the second known PageSettings combination: label colour 12 with HorizontalChar 1, VerticalChar 0, TitleBlockPrinted 0 and ANSIGridRefs 0. No real page carries it (0/451). <!-- EXT-18.8-032 -->

### Open questions

- Whether a symbol bbox must cover its pins. The example bbox (0, 0, 30, 20) covers the rectangle and the pin by choice; no check tested the rule. <!-- EXT-18.6-059 -->
- Whether a Schematic tail entry such as (`R`, 2) is the next free reference number for its prefix. Tail keys are uppercase letters in 894 of 917 entries and values are 1 or more in 917/917; the next-free-number reading is untested. <!-- EXT-18.7-018 -->

### Refuted

| Claim | Source | What the files show | Evidence | Ids |
| --- | --- | --- | --- | --- |
| The symbols types stream is named `Symbols/Types` | EXT §18.2 | No stream is named `Types`; it is `Symbols/$Types$` in 105/105 (0 bytes in 48). Its emptiness without standalone symbols holds | **S** | <!-- EXT-18.2-012 --> |
| The graphics types stream is named `Graphics/Types` | EXT §18.2 | `Graphics/Types` is absent in 105/105; the stream is `Graphics/$Types$`, 0 bytes in 105/105 | **S** | <!-- EXT-18.2-013 --> |

### Parser divergences

Resolved: the parser reads pin +0x06 as `wireId` and +0x0A as `netId` (`structures.ts`). A pin no wire reaches joins the net its `net_id` names (the golden table `pin-net` in `docs/decision-tables/dsn-net-assignment`, replayed by `net-assignment.table.test.ts`): the net a page wire with that id carries, or for `wire_id = 0` a net shared with the pins of the same `net_id`; a sentinel pin with no such wire keeps the pin-to-pin rule (§13). **E**: on the 31 corpus designs with Capture exports, every such pin the export puts on a multi-pin net is on a net (4 were left unconnected before, `SENSOR_BOARD` U1.18, U1.20, U1.38, U1.40 on 5V and 3V3); across all 192 corpus and fixture DSNs, 19 designs change, each only by pins leaving NC for a net, and no pin moves between nets. <!-- EXT-18.1-015 EXT-18.8-118 EXT-18.8-126 -->

<!-- meta: EXT-18-001 EXT-18-003 EXT-18-006 EXT-18-007 EXT-18-008 EXT-18.1-016 EXT-18.2-017 EXT-18.7-017 EXT-18.10.1-002 EXT-18.10.1-003 EXT-18.10.1-004 EXT-18.10.1-005 EXT-18.10.1-006 EXT-18.10.1-007 EXT-18.10.1-008 EXT-18.10.1-009 EXT-18.10.1-010 EXT-18.10.1-011 EXT-18.10.1-012 EXT-18.10.1-013 -->

Parser coverage: the parser reads the example's `Library` header and string table, the `Cache` part views, cells and packages (it skips primitive bodies to their boundary), the page lists up to the off-page connectors (it skips the PageSettings block and lists 10 to 14), and the Hierarchy occurrence tree (it skips some occurrence fields); it does not read the directory streams, `DsnStream`, `HSObjects`, `NetBundleMapData`, `AdminData`, the Schematic stream's registry and tail, the Library defaults block, or the compound-file entry times.
