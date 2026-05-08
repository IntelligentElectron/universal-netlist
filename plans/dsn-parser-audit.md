# DSN Parser Audit: TypeScript vs C++ Reference

**Date**: 2026-03-08
**Scope**: All files under `src/parsers/cadence/dsn/` compared against `references/OpenOrCadParser/`

## Module Mapping

| TypeScript | C++ Reference |
|---|---|
| `cache-parser.ts` | `src/Streams/StreamCache.cpp` |
| `page-parser.ts` | `src/Streams/StreamPage.cpp` |
| `page-parser.ts` (parsePackageStream) | `src/Streams/StreamPackage.cpp` |
| `library-parser.ts` | `src/Streams/StreamLibrary.cpp` |
| `page-parser.ts` (parseHierarchyNetNames) | `src/Streams/StreamHierarchy.cpp` |
| `generic-parser.ts` | `src/GenericParser.cpp` |
| `structures.ts` | `src/Structures/Struct*.cpp` (12 covered) |

---

## 1. What We Do That C++ Does Not

### 1.1 Semantic Field Extraction

| Feature | Location | Detail |
|---|---|---|
| **GraphicInst.pairingId** | `structures.ts` parseGraphicInstBase | First uint32 of body is strLst index for OPC net name. C++ skips this as "unknown data" (`printUnknownData(8)`). We correctly identified its semantic meaning, enabling OPC net resolution without cross-page wire matching. |
| **PlacedInstance.partValueIdx** | `structures.ts` parsePlacedInstance | Extracted from the 14-byte block that C++ skips entirely. Used for Value resolution (3-source priority: prefix "Value" property, partValueIdx, LibraryPart defaultValue). |
| **PlacedInstance prefix properties** | `structures.ts` parsePlacedInstance | Extract (nameIdx, valIdx) pairs from short prefix. C++ reads prefixes but doesn't expose property key/value pairs. Used for MPN and Value extraction via Library strLst lookup. |
| **T0x10.pinIndex computation** | `structures.ts` parseT0x10 | Immediately compute `sth < 32768 ? sth : 65536 - sth`. C++ stores raw `sth` field without transformation. |

### 1.2 Error Recovery

| Feature | Location | Detail |
|---|---|---|
| **Cache brute-force recovery** | `cache-parser.ts` scanForStructures | Scan for preamble magic `FF E4 5C 39` when sequential metadata parsing fails. Checks 3 bytes before magic for valid structure type (Package=0x1F, LibraryPart=0x18). C++ `discard_until_preamble()` re-reads linearly from a checkpoint. |
| **LibraryPart try-catch recovery** | `page-parser.ts` parsePackageStream | If `parseLibraryPart()` fails, seek back and `skipStructure()`. C++ has no equivalent; exceptions propagate up. |
| **GeneralProperties optional parsing** | `structures.ts` parseLibraryPart | Try-catch around 4 string reads + 2-byte skip. C++ uses conditional checkpoint position logic (less forgiving). |

### 1.3 Pin Resolution Pipeline

| Feature | Location | Detail |
|---|---|---|
| **Cache dual pin map indexing** | `cache-parser.ts` indexCachePackage | `pinMaps` (primary) + `cachePinMaps` (fallback when Packages/ pinMap has more entries than T0x10 count, i.e. physical pads > schematic pins). No C++ equivalent. |
| **Multi-section component keying** | `cache-parser.ts` indexCachePackage | Index cache packages with `baseName + unitRef` compound keys for multi-section components (e.g., dual op-amps). C++ doesn't track unitRef. |
| **Multi-fallback pin resolution** | `pin-resolver.ts` | Packages/ -> Cache -> brute-force -> positional device -> unitRef fallback chain. C++ reference shows no pin resolution strategy at all. |
| **Device.pinMap null entries** | `structures.ts` parseDevice | Store `null` for `-1` strLen pins, preserving positional alignment. C++ skips `-1` entries (vector shrinks, losing index correspondence). |

### 1.4 Net Connectivity

| Feature | Location | Detail |
|---|---|---|
| **Net table storage + uppercasing** | `page-parser.ts` parsePage | Store `Map<netId, string[]>` with uppercased names (matching Cadence Allegro DAT export convention). C++ reads the net table but only logs it. |
| **Hierarchy stream parsing** | `page-parser.ts` parseHierarchyNetNames | Dedicated parser with 0x43 magic marker scanning for cross-page net name aliases. C++ has `StreamHierarchy.cpp` but no equivalent net name extraction. |

### 1.5 Encoding

| Feature | Location | Detail |
|---|---|---|
| **Latin-1 string decoding** | `library-parser.ts` readStringLatin1 | Explicit `toString('latin1')` for Library strLst entries. C++ uses implicit std::string encoding. |

---

## 2. What C++ Does That We Do Not

### 2.1 Structural Validation (Systematic Gap)

| Gap | C++ Behavior | Our Behavior | Risk |
|---|---|---|---|
| **`sanitizeCheckpoints()`** | Validates ALL FutureData checkpoints were visited; throws if any remain unparsed. Called in every structure parser. | Never called. `checkpoint()` is best-effort. | **Medium-High**. Binary format changes could silently shift structure boundaries without error. |
| **`assumeData()` validation** | Validates specific bytes match expected values (e.g., SymbolDisplayProp trailing 0x00). | `skip()` without checking. | **Low**. Would only catch rare format corruption. |
| **Twin ID validation in Cache** | Compares id0 vs id1 and logs ERROR on mismatch. | Uses equality test for branching only, no validation logging. | **Low**. |
| **EOF validation** | `sanitizeEoF()` called after every stream parse; throws if extra data exists. | Never checked. | **Low**. Extra trailing data is harmless for netlist extraction. |

### 2.2 Skipped Fields

These fields are extracted by C++ but skipped by us. All are rendering/graphical data, not needed for netlist connectivity.

| Field | Structure | C++ Extracts | We Do |
|---|---|---|---|
| pinIgnore (bit 7) / pinGroup (bits 0-6) | Device | `GetBit(7, cfg)` / `cfg & 0x7f` | `skip(1)` |
| Coordinates, pinShape, portType | SymbolPin | 28 bytes of geometric data | `skip(28)` |
| color, lineWidth, lineStyle | Wire | `ToColor()`, `ToLineWidth()`, `ToLineStyle()` | `skip()` each |
| color | GraphicInst | `ToColor(readUint8())` | `skip(1)` |
| sourceLibrary | Package, LibraryPart | Stored as member | Read and discarded |
| unknownStr1 | Package | Stored, logged | Read and discarded |

### 2.3 Entire Page Sections Skipped

Our page parser stops after OffPageConnectors. C++ continues with:

| Section | What C++ Does | Netlist Relevance |
|---|---|---|
| ERCObjects | Reads N structures | None (design rule checks) |
| BusEntries | Reads N structures | Low (bus segment entries) |
| GraphicInsts (post-OPC) | Reads N structures | None (schematic graphics) |
| Structure10 / Structure11 | Reads N unknown structures | Unknown |

### 2.4 Package Stream

| Gap | Detail |
|---|---|
| **PartCell structures** | C++ fully parses and stores PartCell structures in Package streams. We `skipStructure()` them entirely. PartCells contain cell-level metadata, not directly needed for pin mapping. |

### 2.5 LibraryPart Primitives

| Gap | Detail |
|---|---|
| **Primitive iteration** | C++ iterates through primitives with complex discard logic (up to 64-byte trailing data detection per primitive, boundary validation). We call `skipToNextBoundary()` to jump past the entire primitive block. Primitives are graphical shapes (lines, arcs, rectangles) inside symbol definitions. |
| **Pin 0x00 skip marker** | C++ peeks at first byte of each SymbolPin; if 0x00, skips that pin and doesn't add to symbolPins array. ~~We parse all pins unconditionally.~~ **Fixed** (2026-03-10): we now peek for 0x00 and push empty string to preserve index alignment. |

### 2.6 Library Stream

| Gap | Detail | Risk |
|---|---|---|
| **Version-dependent strLstLen** | C++ reads `uint16` for version A, `uint32` for B+. We always read `uint32`. | **Medium**. Version A DSN files would read garbage for strLstLen. Unknown how common version A files are in the wild. |
| **Format version prediction** | C++ tries 16 format versions (A-P) via `predictVersion()`. We have no version detection. | **Low** if version A files are rare. |
| **Database type detection** | C++ reads introduction string to distinguish Design vs Library files. We skip entirely. | **None** for netlist use case. |
| **Part aliases table** | C++ reads alias->package name pairs after strLst. We stop at strLst. | **Low**. Could matter if a design uses part aliases for package references. |
| **someLen validation** | C++ enforces `someLen == 24` and throws otherwise. We skip without validation. | **Low**. |
| **Timestamps** | C++ extracts createDate / modifyDate. We skip. | **None**. |
| **LOGFONTA parsing** | C++ parses font structures. We calculate byte offsets and skip. | **None**. |
| **Design footer** | C++ reads schematicName and validation bytes for Design-type files. We skip. | **None**. |

### 2.7 Logging and Debugging

C++ has comprehensive `spdlog` logging at debug/trace/error levels throughout all parsers. We have zero logging in the DSN parser. Format deviations, unexpected bytes, and structural anomalies are invisible.

### 2.8 Uncovered C++ Streams (10)

These stream parsers exist in the C++ reference but have no TypeScript equivalent. None are needed for netlist extraction:

`StreamAdminData`, `StreamBOMDataStream`, `StreamDTypeD`, `StreamDirectoryStruct`, `StreamDsnStream`, `StreamERC`, `StreamHSObjects`, `StreamNetBundleMapData`, `StreamSchematic`, `StreamSymbol`

### 2.9 Uncovered C++ Structures (~39)

All graphic rendering structures (10 files: lines, arcs, boxes, polygons, beziers, bitmaps, ellipses, polylines, OLE embeds, comment text), symbol definitions (9 files), ERC objects (2 files), title blocks (2 files), hierarchy sub-records (4 files), and miscellaneous metadata structures. None are needed for connectivity.

---

## 3. Key Implementation Differences

### 3.1 Error Handling Philosophy

| Aspect | C++ | TypeScript |
|---|---|---|
| Checkpoint enforcement | Strict: `sanitizeCheckpoints()` throws | Lenient: silent no-ops |
| Unknown flags | Exception on unmatched values (GraphicInst switch default) | Silent pass-through |
| EOF management | Clears EOF flag during prefix guessing | No EOF concept in BinaryReader |
| Structure type check | Three overloads: no type, single type, multiple types | Single function with optional type |

### 3.2 Architecture

| Aspect | C++ | TypeScript |
|---|---|---|
| Goal | Reverse-engineer and document the full DSN format | Extract netlist connectivity data |
| Data retention | All structures parsed and stored in object tree | Only netlist-critical data retained |
| Output | In-memory object tree with logging | Typed interfaces (ParsedNetlist) |
| Recovery | Linear re-read from checkpoints | Magic-based brute-force scanning |
| Extensibility | Factory pattern for new structure types | Direct function dispatch |

### 3.3 Sub-Loop Exit in Cache

- C++ breaks from sub-loop and continues parsing the rest of the Cache
- TS returns from entire function, abandoning Cache processing

---

## 4. Actionable Risks

Ranked by likelihood of causing real-world issues:

### High Priority

- [x] **SymbolPin 0x00 skip marker** (fixed 2026-03-10): Added 0x00 peek-and-skip in `parseLibraryPart()`, pushing empty string to maintain pinIndex alignment. No existing fixtures were affected (CutiePi/LAUNCHXL gaps confirmed as absent LibraryPart data, not parsing failures).

### Medium Priority

- [ ] **No `sanitizeCheckpoints()`**: Silent boundary misalignment if binary format changes. Consider adding at least a warning-level check (non-throwing) to detect when checkpoints are missed.
- [ ] **Library version A (uint16 strLstLen)**: We always read uint32. Determine if version A DSN files exist in the wild. If so, add version detection or at least a heuristic (check if uint32 value is unreasonably large).

### Low Priority

- [ ] **Port trailing bytes**: Page parser comment says 5 bytes; StructPort.cpp shows 9 bytes. Verify consistency across both call sites.
- [ ] **Part aliases table**: Could matter if designs use part aliases for package references. Monitor for unresolved package names.
- [ ] **Cache sub-loop exit scope**: TS returns from entire function vs C++ breaks from loop. Could miss structures after the metadata sub-loop in edge cases.
- [ ] **pinIgnore flags**: If a design marks pins as "ignored", we'd still include them in the netlist. Likely benign for connectivity checking.

### No Action Needed

- Graphic rendering fields (colors, line widths, coordinates)
- Uncovered streams and structures (all non-netlist)
- Logging infrastructure (nice-to-have, not a correctness issue)
- Timestamps, fonts, database type detection
