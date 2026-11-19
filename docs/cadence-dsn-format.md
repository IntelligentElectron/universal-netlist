# Cadence OrCAD Capture `.DSN` Format Specification

This is universal-netlist's specification of the OrCAD Capture design file (`.DSN`), and the golden reference for the parser. Every fact in it carries the evidence that verified it. It is merged from two source specifications that are not published:

| Name | Status |
| --- | --- |
| INTERNAL spec | Ours, built with the parser. Frozen 2026-11-19. |
| EXTERNAL spec | Third-party, received 2026-11-19. Frozen; unverified unless a fact here cites it. |

Section references to the sources are written `INT §n` and `EXT §n`.

## Evidence levels

| Code | Meaning |
| --- | --- |
| **E** | **Export.** Reproduces Capture's own netlist output (`pstxnet.dat`, `pstchip.dat`, `pstxprt.dat`) or an Allegro netlist on the Cadence fixture designs. The parser that applies it reads 100% of nets, connections, pin numbers, pin names and DNS flags of those exports (INT §13.5). |
| **S** | **Structural.** An independent reader built only from the stated layout consumed every stream to its exact last byte, with every field check passing, on the 18 version-3 fixture designs and 88 version-3 designs of `designs-dataset/cadence-corpus` (2026-11-19: 485 page streams, 106 Cache streams, 331,656 framed records). Proves the layout, not the meaning of a field. |
| **T** | **Test.** A unit or integration test in universal-netlist reproduces it on real or reference data. |
| **O** | **Observed.** Holds on every case in our data, with a stated count, but is not tied to an export or a full-stream read. |

---

## 1. Container and protection

### 1.1 Password-protected designs (`SYENCRYPT01`): T

Source: INT (Password-protected streams). Tests: `src/parsers/cadence/dsn/dsn-reader.test.ts` (a protected design reads with its variants and Do Not Stuff set identical to the unprotected one), `sapphire.test.ts` with `sapphire-vectors.json`.

- The container directory stays in clear: stream and storage names, including BOM variant names, read without the password.
- The root `Library` stream keeps its first 22 bytes in clear, then carries the 20-byte ASCII marker `FILE_FMT_SYENCRYPT01`, then ciphertext. Every other encrypted stream starts with the marker. A page named `Library` (`Views/<s>/Pages/Library`) has no clear bytes; match the root stream by full path.
- The plain stream is the clear bytes followed by the decrypted ciphertext, marker removed. It equals the stream of an unprotected design.
- A marker spelled `FILE_FMT_` or `FILE_FMT=` with another name is an encryption we do not cover.
- Cipher: Sapphire II (Michael Paul Johnson), a fresh state per stream, keyed by the password's bytes. Key length 1 to 255. A printable-ASCII password is its own key; other characters are not covered.
- OrCAD's key schedule differs from the published cipher in one step: the loop runs down to card 0 and still draws a key byte for it.

```
cards[i] = i for i in 0..255;  kp = 0;  sum = 0
for limit = 255 down to 0:                      ; published cipher stops at 1
    mask = smallest 2^k − 1 ≥ limit
    tries = 0
    repeat:
        sum = (cards[sum] + key[kp]) & 255;  kp += 1
        if kp == len(key): kp = 0;  sum = (sum + len(key)) & 255
        swap = sum & mask
        tries += 1
        if tries > 11: swap = (limit == 0) ? 0 : swap mod limit
    until swap ≤ limit
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

- A key is right when the decrypted `Library` opens as a Library header: the 32-byte introduction `OrCAD Windows Design`, space-padded with `00` at byte 31; or, where other bytes follow the text, the text at +0x00, a version of 1 to 9 (minor 0 to 99) at +0x20, four zero bytes at +0x2C and a font count of 1 to 1024 at +0x30. The cipher authenticates nothing otherwise.
- A protected design's Library version is encrypted, so the version gate (§2) applies only after decryption.

## 2. Version families

### 2.1 Library versions 1.1 and 2.0: O

Source: INT §6 (Version gate). Count: 14 designs of the corpus (1 at 1.1, 13 at 2.0), and the `gprino-lf` fixture. Test: `library-parser.test.ts`.

- `Library` +0x20 / +0x22 hold 1 / 1 or 2 / 0.
- Their page records carry no `u32` region lengths. A version-3 page opens `0A <u32 len> 00 00 00 00 0A …`; every 1.1 and 2.0 page in our data opens `0A 00 00` followed directly by the page-name `lstr` (`0A 00 00 05 00 50 41 47 45 31 00` for `PAGE1`).
- The streams present do not tell the encodings apart (`Packages/<p>` streams exist in 8 of the 14); the Library version does.
- Read with the version-3 framing, every such design fails on its first page.

### 2.2 Library versions 3.2 and 3.3: S

Every layout checked in §3 to §6 below read identically in both.

## 3. Record framing: S

Source: EXT §3.

- A record is: F full prefixes `[u8 type][u32 end_offset][u32 0]`, then (except types 52 and 53) a short prefix `[u8 type][i16 n][n × (u32, u32)]` and a preamble `FF E4 5C 39 [u32 len][len bytes]`. The body follows, innermost layer first.
- The end of the prefix chain is found by the zero test plus the nesting test (EXT §3.5): a candidate is a full prefix only if bytes +5..+8 are zero **and** its stop is at or before the previous prefix's stop.
- F is fixed per type and matches EXT §3.6 for every record read (331,656), in pages and in the Cache:

| Type | F | Type | F | Type | F |
| --- | --- | --- | --- | --- | --- |
| 6 | 3 | 26 | 2 | 49 | 2 |
| 10 | 2 | 29 | 2 | 52 | 1, no short prefix |
| 12 | 3 | 31 | 3 | 53 | 1, no short prefix |
| 13 | 4 | 32 | 2 | 55–62, 88, 89 | 2 |
| 16 | 2 | 33, 34, 35 | 4 | 64 | 4 |
| **17** | **2** | 37, 38 | 2 | 65 | 3 |
| 20, 21 | 2 | 39 | 2 | 75 | 4 |
| 23 | 3 | 48 | 2 | 77 | 3 |
| 24 | 5 | | | | |

- Type 17 (BusPinInstance) **occurs**: 996 records, F = 2, layout as type 16. (EXT marks it as never seen.)

## 4. Cache stream: S

Source: EXT §5.2. Read to the exact end in all 106 Cache streams.

- Five directory tables back to back, nothing else: table 0 (always `00 00`), table 1 terminal symbols (types 33, 34, 35, 64, 75, 76), table 2 part views (type 24), table 3 part cells (type 6), table 4 packages (type 31).
- Table: `u16 group_count`, then groups. Group: `lstr name`, `u16 variant_count`, variants. Variant: `lstr source_library`, `u32 id`, `u32 id_copy` (always equal), `u16 type` (equals the body's first byte), then one framed record bounded by its first full prefix.
- Zero-variant groups occur in every table and at the end of the stream (28,167 seen).
- Every table-2 group name ends in `.Normal` or `.Convert`.

## 5. Page stream

### 5.1 Layout: S

Source: EXT §6. Read to the exact end in all 485 page streams.

1. Page record frame (type 10, F = 2), `lstr` page name, `lstr` page size name, 156-byte PageSettings.
2. Fourteen `u16`-counted lists, in this order: title blocks (65); SchematicNets (52); NetBus (53) each followed by `u16 m` and `m × u32`; net-name rows (unframed `lstr name`, `u32 id`); wires (20, 21); instances (13, 12, mixed); ports (23); Globals (37), each followed by 5 bytes; off-page connectors (38), each followed by 5 bytes; ERC objects (77); bus entries (29); page graphics (55–62, 88, 89); list 13 (always 0); list 14 (always 0).
3. The stream ends exactly after list 14.

### 5.2 Records: S

| Record | Layout after the preamble |
| --- | --- |
| SchematicNet (52) | `u32 net_id`, `lstr` (always empty), `u32` reserved, `u32 colour`, `u32 line_style`, `u32 line_width`. |
| NetBus (53) | As 52; then, after its region, `u16 m`, `m × u32` member ids. |
| Wire (20, 21) | `u32 db_id`, `u32 net_id`, `u32 colour`, `i32 × 4` start and end, `u8` junction flags (bits 2–7 always 0), `u16` alias count, aliases (49), `u16` display count, displays, `u32 line_width`, `u32 line_style`. Width before style. |
| Alias (49) | `i32 x`, `i32 y`, `u32 colour`, `u32 rotation`, `u32 font`, `lstr name`. |
| Graphic-instance base (12, 13, 23, 37, 38, 65, 77) | `u32 name_idx`, `u32 lib_idx`, `lstr symbol`, `u32 db_id`, `i16 × 4` bbox (y before x), `i16 loc_x`, `i16 loc_y`, `u16 transform`, `u8` type echo, `u8` reserved, `u16` display count, displays (39), `u8` symbol kind. |
| SymbolDisplayProp (39) | Body is exactly 14 bytes. |
| PlacedInstance (13) | Base (kind 24, R3 ends after it), `lstr reference`, `u32 value_idx`, `u32`, `u32`, `u16` primitive word, `u16` pin count, pins (16/17, R2 ends after the last), `lstr source_package`, `u16 device_index` (R1 end). |
| DrawnInstance (12) | Base (kind 24), inline LibraryPart (24, R2 ends after it), `lstr reference`, `u32 × 3`, `u16`, `u16` pin count, pins (R1 end). |
| Pin instance (16, 17) | `u16 pin_word`, `i16 x`, `i16 y`, `u32 wire_id`, `u32 net_id`, `u16` display count, displays. |
| Port (23) | Base (kind 34, R2 ends after it), then a 9-byte trailer: `u32 wire_id`, `u8 flag`, `u32 port_type` (R1 end). |
| Global (37), OffPageConnector (38) | Base, R1 ends after the kind byte. Then, outside the record: `u32 wire_id`, `u8 flag`. |
| TitleBlock (65) | Base (kind 64, R2 ends after it), then 12 bytes: `u32` corner flag (0 or 1), `u32` page count, `u32` page number. |
| ErcObject (77) | Base (R2 ends after it), then three `lstr`. |
| BusEntry (29) | Body is exactly 28 bytes. |

- The `u8 flag` in Port, Global and off-page trailers is 0 or 1: 1 on 362 of 2,135 ports and 226 of 6,968 off-page connectors, 0 on all 9,035 Globals. Its meaning is not established.
- Port type values seen: 0, 1, 2, 4, 7.

### 5.3 Net identity: S

- Every scalar wire's `net_id` names a SchematicNet on the same page (88,443 wires); every bus wire's names a NetBus (2,884).
- Net-name row ids name a SchematicNet **or a NetBus**: 1,212 rows name a NetBus (the bus's name).
- NetBus member lists are often non-empty: 1,212 lists, 12,130 member ids, every one a SchematicNet id on the same page.
- A non-zero port, Global or off-page trailer `wire_id` always names a wire on the same page.

### 5.4 Pin connection fields: S

Source: EXT §7.4, §11.1.2. INT §7.7.1 calls the first field `net_id` and skips the second as `unknown_int`; those names are wrong, though INT's connectivity results are unaffected.

- `wire_id` (pin +0x06) is always one of: 0; `0xFFFFFFFF`; or the `db_id` of a wire on the same page with an endpoint exactly at the pin point (62,335 pins). No pin names a wire that does not end at it, and none holds a non-wire id.
- `net_id` (pin +0x0A) is non-zero only on pins that no wire ends at, and then always names a SchematicNet on the same page. Every pin with `wire_id = 0xFFFFFFFF` has a non-zero `net_id`.
- The pin-word high bit (bit 15) is **not** a no-connect flag: it is set on 371 wired pins and clear on 1,516 isolated pins. Its meaning is not established.

## 6. Symbols, packages and parts

### 6.1 Device pin-map flag: E

Source: INT §12.1 (Pin Ignore). EXT §5.4.2 lists the byte as unknown.

Each physical-pin slot of a Device (32) is `lstr number` + `u8 flag`. The flag (`bitMapPinGrpCfg`):

| Bits | Mask | Meaning |
| --- | --- | --- |
| 0–6 | 0x7F | Pin group. 0x7F = no group. |
| 7 | 0x80 | Pin Ignore (Capture's *Pin Properties → Ignore*): the netlister leaves the pin out of this section. |

Evidence: the quad RJ45 `RJ45_1x4_LPJE104-0BENL`. Slot 14 maps to `SS1`, `SS2`, `SS3` with Pin Ignore set on sections 1–3, and to `S5` with it clear on section 4. The design's `pstchip.dat` writes the pin as `PIN_NUMBER='(0,0,0,S5)'`. A pin with Pin Ignore set must be dropped from the netlist.

### 6.2 Choosing a device pin map: E

Source: INT §12.1.

- A `Packages/<p>` Device map can describe the physical package, whose pad count differs from the symbol's pin count (a 4-pad crystal with 2 schematic pins: `Packages/` map `1, 3, 2, 4`, Cache map `1, 2`).
- It can also be shorter than the pin list and transposed: `CON_HDMI_RA` (23 pins) has a 20-entry `Packages/` map with entries 17 and 18 swapped; the Cache map has 23 entries in order.
- Rule: a placed pin's physical number is `map[ordinal − 1]`. Use the map whose length equals the instance's pin count. When the `Packages/` length differs and the Cache length matches, use the Cache. When neither matches, prefer the Cache if `Packages/` is longer. When the chosen map has no entry or an empty slot at the position, try the other map. Only then use the ordinal itself.

### 6.3 Repeated reference designators: T

Source: INT (`duplicate-refdes.ts`), with the `opencellular-sdr-reused-refdes` fixture.

- Each section of a part is its own placed instance with the shared reference; instances that are sections of one part are merged.
- An instance joins an existing part of its reference only when its source package matches (case-insensitively, after removing a trailing `_<digits>`), neither part-number property conflicts (both set and different), and it draws a section that part does not have yet. Otherwise it is another part, kept with its own metadata and pins.
- An instance that draws a section its part already has is kept apart until connectivity is built, then folded back when no pin of the two lies on two different nets.

### 6.4 Placement of symbol points: O (partial)

Source: EXT §11.1.4 and §2.5.2, corrected. Checked 2026-11-19 on all 106 designs.

- A symbol point `(x, y)` is transformed by the transform word (bits 8–9 rotation `r`, bit 10 mirror): mirror negates x first, then `r = 1` maps to `(y, −x)`, 2 to `(−x, −y)`, 3 to `(−y, x)`.
- The page point is the transformed point plus an offset `(ox, oy)`. The offset makes the transformed placement box start at the stored location: `ox = loc_x − min x`, `oy = loc_y − min y` over the four transformed corners of the placement box. On each axis with box extent `(lo, hi)`, the placement extent is `(0, snap(lo + hi))` if `lo ≥ 0`, else `(lo, lo + snap(hi − lo))`, where `snap` rounds up to a multiple of 10.
- **The box to use is the symbol's stored `bbox` field** (EXT §5.3.2), not the box of its primitives as EXT §11.1.4 says.

| Box used | Connectors (pin lands on its trailer wire's endpoint) | Placed parts (every stored pin point reproduced) |
| --- | --- | --- |
| Stored `bbox` field | 17,596 of 17,604 | 16,003 of 16,087 |
| Primitives, as EXT §11.1.4 | 17,212 of 17,604 | 15,261 of 16,087 |

The rule is not yet verified: 8 connectors and 84 parts do not fit it, and why is not established.

## 7. Hierarchy

### 7.1 Occurrence scope header: S (by INT's reader)

Source: INT §8 (scope layout). EXT §10.5.8 calls this region `trailing_data`, opaque.

After an instance occurrence's pin occurrences and before its `u16 child_count`, the occurrence stores its own scope header:

| Field | Type |
| --- | --- |
| `net_count`, then `net_count` design net records (type 67: frame, `u32 id`, `lstr name`) | u16 |
| `title_count`, then `title_count` type-82 links (frame, `u32`, `u32`) | u16 |
| `offpage_count`, then `offpage_count` type-91 links (frame, `u32`, `u32`) | u32 |

- A part occurrence's 8 zero bytes are these three counts at zero.
- A block occurrence's scope holds the net names of that placement.
- INT's `hierarchy-parser.ts` consumes every Hierarchy stream of the fixture corpus with this layout. The independent check of §3 to §5 did not cover the Hierarchy stream.

### 7.2 Nested hierarchy: E

Source: INT §12.6. EXT §10.8 claims blocks occur only at the root level; that is refuted.

- A child schematic may contain blocks. A block occurrence's children are part and block occurrences, each block opening a subtree of its own. Verified one level and three levels deep against Allegro netlist exports.
- For each block on a page, the block occurrence of the current scope with `instance_id` equal to the block's `db_id` names the child schematic. Pass over a block with no such occurrence, and a block whose child schematic is already open higher up the same path (a reference to another design file's schematic of the same name).
- Each placement's page copy takes from its own occurrence: the reference designators of its children, the pin numbers its pin occurrences assign (§7.3), and its net names (§7.1).

### 7.3 Per-placement pin numbers: E

Source: INT §8 (Pin records).

A pin occurrence (68) whose physical number the occurrence assigns carries a `Number` property with that number. It overrides the device pin map for that occurrence only. A hex inverter drawn once inside a block placed twice reports pins 1–4 in one placement and 5–9 in the other, as Capture's netlist does.

### 7.4 Choosing the root: E

Source: INT §6 and §8.

- The root is the schematic the `Library` stream's design suffix names.
- A folder that another folder's occurrence tree places as a block is a child schematic; its own Hierarchy stream is a stale former root and is not read.
- Several unplaced folders can be candidate roots (earlier revisions, simulation sheets; one fixture holds `PSUPPLY`, `SCHEMATIC1`, `PSUPPLY-REV2`). Capture netlists only the suffix-named one. On every fixture with an export, the export's `C_PATH='@design.<schematic>(sch_1):…'` starts from the suffix-named schematic, including designs with 2 to 6 folders. One design that differs was saved after its export with a simulation sheet made root.
- When the suffix names no candidate, read every candidate. A folder no root reaches is left out.

## 8. Connectivity and net naming

### 8.1 Placement-local nets: E

Source: INT §12.6.

- In every placement of a block, whether or not the block is repeated, a net bound to a block port takes the parent's net, a net attached to a Global keeps its bare name, and every other net is local to the placement and is suffixed with the placement path. (EXT §11.5.6 applies the suffix only to repeated blocks.)
- Path suffix: `_` plus the path elements from the root down, joined with `_`, upper-cased: `_BLK1` one level down, `_BLK1_SUB2_UNIT3` three levels down. Each element is the reference the block occurrence annotates, or the name drawn on the block.
- A net on a port follows the chain of ports upward to the first net that is local to a page. A three-deep design reports one top-level net carrying the pins of parts three placements down.
- A block port with nothing at its connection point binds nothing; the child's port net stays local and suffixed.

### 8.2 Bus members: E

Source: INT §12.6.

- On a page, scalar nets join a bus as members by name (`DATA7` is member 7 of `DATA[7:0]`). Bus entries are not needed.
- Across a block port, members bind by position in the range, not by name: member *i* of the port's range binds to member *i* of the parent bus wired to the block pin, read from that bus wire's alias or net-name row.
- When no scalar wire on the parent page carries a member, the parent bus passes it on: the member becomes a net of its own under the parent, named as the parent's member, and the binding continues upward.

### 8.3 Unnamed nets: E

Source: INT §12.4; agrees with EXT §11.4.

An unnamed net is `N` followed by its smallest wire `db_id`, zero-padded to at least 5 digits.

### 8.4 Repeated page-local names: E (as a reproducing rule)

Source: INT §12.4 (`net-assembly.ts`).

The Hierarchy net list already holds the suffixed copies `BASE_<id>`. Keep only names whose suffix is all digits and that no page net carries as its own drawn name. Order those suffixes by value, and the page copies of `BASE` by the smallest wire id on their pins. Walk both in step: a copy takes the next suffix when that suffix is at most its smallest wire id. The copy left over keeps `BASE`. This reproduces every case in the fixture exports; whether it is Capture's own rule is not established.

## 9. Do Not Install

Source: INT §13.6, §13.7 and [cadence-dni.md](cadence-dni.md). EXT does not cover DNI.

| Mechanism | Stored in | Reaches the `.dat` exports | Evidence |
| --- | --- | --- | --- |
| A. Marker in the value | Value string: `,DNI` `,DNP` `,DNM` `,DNS` `,NC` (suffix), `DNI,` `DNP,` `DNM,` `DNS,` (prefix), `_NC` (suffix), or the marker alone; case-insensitive | Yes, in the value and part name | E |
| B. Assembly property | Any user property other than the value whose value is a marker on its own (`ASSY`, `ASSY_OPT`, `Assembly`, `BuildOptions`, `INSTALL`, …), excluding `NC` and `NF` alone and blank `<NAME>` placeholders | No | O (seen on 5 fixture libraries) |
| C. CIS variant | `CIS/VariantStore`: a part with status `0` in a composed group and no status `1` in another | No: 77 and 291 unfitted parts on two fixtures keep ordinary values, part names and both pin nets | E |

- With A and C read, the DNS flag matches the Cadence reference on all 456 DNS parts of the fixture corpus.
- A variant that lists a part with status `1` fits it, overriding A and B.

## 10. CIS storages

### 10.1 Substitution stream grammar: O (one stream)

Source: EXT §14.10. Only one non-empty `UpdateStorageGroupDataStream` exists in our data (reServer Industrial J401, group `DNP`).

- Its grammar holds: records `occurrence_id 0xB0 columns 0xC0 values ~`, 14 `^`-separated columns ending in `Name`, the `Name` value `INS` + digits, the body ending in `~`.
- Columns seen: `Part Number`, `Part type`, `Value`, `Description`, `Power`, `Tolerance`, `Schematic Part`, `PCB Footprint`, `Implementation`, `Source Library`, `Source Package`, `Graphic`, `Power Pins Visible`, `Name`.
- **Not established:** that it is a substitution. Its values (`0.7pF`, `C0402`) look like the part's own properties.

### 10.2 Sub-groups: not verifiable

No design in our data stores `CIS/VariantStore/Groups/<group>/<sub>/<sub>`. EXT §14.8–14.9 cannot be checked here.

---

## Refuted claims

Claims from either spec that our checks contradict.

| Claim | Source | Finding |
| --- | --- | --- |
| Bus nets have no net-name row | EXT §6.7, §6.8 | 1,212 rows name a NetBus. |
| NetBus member count is 0 | EXT §6.7 | 1,212 non-empty lists, 12,130 members. |
| Port trailer byte +4 and Global/off-page tail byte +4 are always 0 | EXT §7.9, §7.10 | 0 or 1 (§5.2). |
| BusPinInstance (17) never occurs | EXT §3.6, §7.4 | 996 records. |
| A placement box comes from the symbol's primitives | EXT §11.1.4 | The stored `bbox` field fits far better (§6.4). |
| Blocks occur only at the root level | EXT §10.8 | Nested blocks verified to three levels (§7.2). |
| Placement-local suffix only for repeated blocks | EXT §11.5.6 | Every placement (§8.1). |
| Pin +0x06 is a net id; pin +0x0A is unknown | INT §7.7.1 | +0x06 is a wire id, +0x0A the net id (§5.4). |
| Pin-word bit 15 is a no-connect flag | INT §7.7.1, after OpenOrCadParser | Refuted (§5.4). INT already did not rely on it. |

## Not yet verified

- EXT §11.4–§11.5 net naming beyond §8 here, which needs a full net build compared with the exports.
- EXT §8 graphics bodies, §9 text and display, §12–§13 auxiliary and constraint storage, §15 `HSObjects`.
- 56 cached part symbols whose primitive list the independent reader could not walk (for example `LED.Normal`): either the reader or EXT §5.3.3 / §8.4 is wrong.
- The meaning of the trailer `flag` byte (§5.2) and of pin-word bit 15 (§5.4).
