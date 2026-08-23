# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.1] - 2026-08-23

Every command is now a word as well as a flag: `universal-netlist update` and
`universal-netlist --update` are the same call, `upgrade` is another name for
`update`, and the help is laid out as options and commands, the way a
command-line tool reads.

### Added

- CLI: every command is accepted as a word as well as a flag, and `upgrade` is an alias of `update`. `update`, `uninstall`, `export-telemetry`, `coverage [path]`, `version`, `help` and `verbose` each work with or without the leading dashes; the value after `export-json` is always a path, and the token after `coverage` is a path unless it is a command word. The README and the install scripts show the word form (PR #175)

- CLI: `export-json` is a documented command: `universal-netlist export-json <design> [output.json]` writes the design's netlist in the Universal Netlist schema, to `<design>.json` in the working directory or to the given path. The written file is itself a design every tool reads, so an export round-trips, and takes an optional output path (PR #176)

- Docs: the binary's command line has its own page, `docs/cli.md`: every command with usage, output, and exit behaviour, linked from the README and the docs index (PR #177)
- Docs: the README is trimmed to the high level; format details, CLI usage, and the privacy policy live in `docs/` and `PRIVACY.md` (PR #178)

### Changed

- CLI: `help` lists options (`-v, --version`, `-h, --help`, `--verbose`) and commands (`update|upgrade`, `uninstall`, `export-telemetry`, `coverage`) separately, and names every supported format; it still said Cadence and Altium (PR #175)

## [1.7.0] - 2026-08-23

The Universal Netlist is now an input as well as an output. A `.json` file in
the schema every parser converts into is a design: `list_designs` finds it,
every tool reads it, and what `--export-json` writes round-trips. The file is
validated on load, because the parsers build a consistent netlist by
construction and a file may have been written or edited by anyone. Running that
validation over the repository's own golden files found that 8 of the 38, all
Altium, contradicted themselves: a pin listed under one net in `nets` while
`components` put it on another, or on no declared pin at all. Three Altium
parser defects were behind that, and they are fixed in the same release. Every
fixture design of every format, 40 in all, now parses into a netlist whose two
indices agree, and the tests hold it there. Separately, `list_components` stops
suggesting prefixes it would then return nothing for (#169).

### Added

- Universal Netlist JSON files (`.json`, the schema in `docs/schemas/universal-netlist.md`) are designs. `list_designs` discovers them, every tool accepts their path, and `--export-json` output round-trips. A file is refused, naming the first defect, when `nets` and `components` are not exact inverses or a refdes or pin does not resolve; a file in the right shape that fails validation is listed by `list_designs` with its `error`. Fixtures live in `test/universal/` so the handler's tests run without the fixtures submodule (PR #171)

### Fixed

- `list_components`: the unmatched-type error suggests only the prefixes the same query would return, and names apart those whose components are all DNS, with the argument that reaches them. It used to build the list from every component, DNS included, so it could point at a prefix that then came back empty. A prefix that exists but is entirely DNS now returns an empty list with a note saying how many parts were left out and that `include_dns=true` lists them, instead of a bare empty list that read as "none" (#169, PR #173)
- Altium: pins of a component's other display modes no longer connect. They sit where the alternate graphic would draw them, which can be on another net's wire, so a header drawn in its default mode had the alternate mode's pins on GND, and a capacitor whose alternate mode swaps its pins sat on GND and 3V3 at once (PR #172)
- Altium: a multi-part component drawn on several sheets keeps every part's pins. Only the first sheet's instance was kept, so an FPGA split over three sheets declared 157 of its 484 pins while every net listed all of them (PR #172)
- Altium: a duplicate designator (two instances of the same part, or an unannotated `X?` repeated across sheets) keeps its first instance in document order; the others connect nothing. Their instances used to be merged pin by pin with the last write winning, which put one pin on several nets (PR #172)
- Altium: `nets` and `components` always agree. A final pass removes any net listing the component map contradicts, so a design reads the same from either index, and every Altium fixture project is validated that way in the tests (PR #172)

## [1.6.1] - 2026-08-18

Three ways a tool could answer the wrong question and look right doing it. A
search given a directory name it did not recognise searched the one the server
was launched in and returned real designs from it. A design that ships without
its schematic answered to `pstxnet` rather than to its own name, so two of them
side by side were the same design as far as any result showed. And an argument
whose name was slightly wrong was dropped before the tool saw it, which turned
a typo into a default: `list_designs` given `search_path` walked 41,105 designs
to answer a question about fourteen, and `run_erc` given `rules` ran every rule
and reported that as the selection. Each returned a well-formed result with
nothing in it to check. Every tool was exercised against all 40 fixtures across
Cadence, Altium and KiCad over a real MCP connection, which is how the first was
found and how the third was found twice.

### Changed

- A tool refuses an argument its schema does not define instead of dropping it. Every tool declared its inputs as a plain shape, which is parsed by an object that strips what it does not recognise, so a misspelled argument arrived as no argument at all. Where that argument was optional the tool ran its default: `list_designs` given `search_path` instead of `path` searched the server's working directory, and `run_erc` given `rules` instead of `include_rules` ran all four rules and reported that as the selection. Misspelling a required argument always failed loudly, and correct calls are unaffected. Each tool's published schema now carries `additionalProperties: false`, so a client is told the tool is closed to arguments it does not define (PR #167)
- `list_designs` returns `{ root, designs }` in place of a bare list. `root` is the directory the search actually ran in, which is the one thing a caller cannot check from the designs alone. A result cut short by `max_results` now says so, with the number found alongside the number shown (PR #165)
- `@modelcontextprotocol/sdk` moves to 1.30.0 and `zod` to 4.4.3, since the argument handling above lives in the SDK's Zod compatibility layer (PR #167)

### Fixed

- A Cadence design that ships without its schematic is queried through its exported netlist, and every result for one came back keyed `pstxnet` rather than named after the design. Every such design names its three `.dat` files identically, so all of them shared that one key and two placed side by side were indistinguishable, which is exactly the comparison this server exists for. Each is now named after its directory, which holds at most one exported netlist. Affects `search_nets`, `search_components_by_*`, `list_components`, `query_component` and `query_xnet_*` (PR #166)
- `list_designs` gave no sign when no directory was named and the search fell back to the server's working directory, which is where the server was launched rather than where the caller is. It says so now, and says the same for a `path` left blank, which reached that default by the same route (PR #165)

## [1.6.0] - 2026-08-18

Two things about what the tools hand back. A Cadence query now names the
schematic rather than a netlist exported from it, because the schematic is the
design as it stands and carries what the export cannot. And a group of
components now speaks only for the parts it actually describes. Grouping keyed
on MPN alone, so a design that gives every resistor the same placeholder MPN
answered with a single group whose one value stood for hundreds of physically
different parts. Every tool here was exercised against all 40 fixtures across
Cadence, Altium and KiCad over a real MCP connection, which is how that was
found.

### Changed

- `list_designs` returns one path per design, the design's own file: a `.DSN`, a `.PrjPcb`, a `.kicad_pro`, or the netlist of a design that is only a netlist. For a Cadence design with an exported triad beside it, `path` was the `pstxnet.dat` and the schematic was reported separately as `source`; `path` is now the `.DSN` and `source` is gone. The schematic is the design as it stands, and it carries what an exported netlist cannot: a part a CIS variant leaves off the board is written to the triad exactly like a part that is stuffed. Reading a `.DSN` takes longer than reading a triad, and nothing is held between tool calls, so that cost lands on each query (PR #162)
- `export_cadence_netlist` is deprecated. It stays for backward compatibility and still writes a netlist for Allegro, which is the reason to call it, and it is no longer a step towards querying a design. The instruction to run it and re-run `list_designs` before querying is gone (PR #162)
- Tool detail moved out of the server instructions and into the descriptions of the tools it belongs to, so a tool carries its own gotchas: the whole-prefix rule on `list_components`, the sheet-path prefixing of KiCad hierarchical nets on `search_nets`, the `NC` marker on `query_component` (PR #162)
- `query_xnet_by_net_name` and `query_xnet_by_pin_name` said traversal stops at power and ground nets without saying which nets those are. They now name both tests, the rail name pattern and carrying more than 40 pins, and say that a rail named outside them is traversed like a signal. LimeSDR's `VDIO_LMS` is a 22-pin rail matching neither, so a query on `LMS_TXEN` crosses its pull-up and returns 31 components across 15 nets. `visited_nets` is where that breadth is visible, and `skip_types` now names `R` alongside `C` and `L`, since the passive that opens a rail like this is a pull-up resistor. `run_erc`'s `skipped` counts are documented too (PR #163)

### Fixed

- Component grouping reported one part's value and description for every part sharing its MPN. A design that gives every resistor the MPN `R` and every capacitor `CC`, which the OSHW Jetson carriers do, collapsed into a single group: `list_components(type: "R")` on reComputer J202 answered one group of 271 resistors valued `5.1R`, where R1 is `0R` and R2 is `5.1K`. Placeholder MPNs do the same elsewhere, with `N.A.` on pca10056 putting a resistor and a capacitor in one group described as a 12pF ceramic. Parts now share a group only when MPN, description, comment and value all agree, so every field a group reports is true of every part in it, and those 271 resistors become 30 groups. Across six designs from all three vendors this was 73 mixed groups hiding 347 distinct value and description combinations. Affects `list_components`, `search_components_by_*`, `query_xnet_by_net_name` and `query_xnet_by_pin_name` (PR #163)
- Altium parts marked Do Not Populate by writing the marker into their Value field, which is the usual convention, were reported as stuffed and counted in every result that leaves Do Not Stuff out (PR #163)
- A value written with a space before its unit, such as `2.2 nF`, could be read as a "no fit" marker and reported Do Not Stuff. Value fields are now read against a marker set that leaves out `NF`, the one token that is also a unit. `NC` stays, because a Cadence value writes `10K_NC` to mean the part is off the board (PR #163)
- `ParsedNetlist` no longer claims to be cached in memory. Nothing is held between tool calls: every call reads and parses the design again (PR #162)

## [1.5.4] - 2026-08-18

A Cadence design records Do Not Install two ways, and this release reads both.
A marker written into a part's value travels with it into every file the design
exports. A CIS variant does not: it is held in the schematic's own database and
reaches the BOM alone, leaving the part indistinguishable from a stuffed one in
the exported netlist. Each of the two parse paths could see one of them, so the
same board answered differently depending on which file a query named. Both now
read both, and the numbers below are measured against a board's own
CIS-generated BOM, which is the only independent statement of what gets built.

### Added

- The parts a CIS variant leaves off the board are read from the schematic's `CIS/VariantStore` and reported as Do Not Stuff. Such a part keeps an ordinary `VALUE` in `pstchip.dat`, an ordinary part name in `pstxprt.dat` and both of its `NODE_NAME`s in `pstxnet.dat`, so no marker names it and no amount of reading the exported netlist finds it. Measured against `LAUNCHXL-CC1310`'s own CIS-generated BOM, the 25 part references it writes with Quantity 0 are exactly the 25 now reported, none missing and none invented, where 11 were reported before; `reServer J2032` reports 77 and `reServer J401` 291, not one of which any marker names. The store is read whether a query names the `.DSN` or the `pstxnet.dat` beside it, so `include_dns`, `list_components` and ERC's `skipped.dns` give the same answer on either path. The eight designs in the corpus that declare no variant are unchanged (#159, PR #160)

### Fixed

- A `.DSN` read on its own now flags a part whose own value carries a Do Not Install marker. The value was being stripped of `DNI`, `DNM` or `_NC` with nothing recording what the marker said, so a design answered differently depending on which of its files a query named: 65 parts across BeagleBoard-xM, CutiePi and CC13xx were flagged through the netlist and not through the schematic. The marker is now read before the value is cleaned, with the matcher the DAT and Altium paths already share. DSN coverage against the DAT golden goes from 391/456 to 456/456, and the golden suite asserts the two paths agree on the flag across 6360 components (PR #160)

### Documentation

- [How Cadence Records Do Not Install](docs/cadence-dni.md) is a new page describing both mechanisms, what each leaves on disk, and why a netlist handed on without its schematic cannot carry the second. `docs/dsn-format.md` links to it and keeps the byte layout: the variant store's encoding, the occurrence numbering and how it joins to a refdes, and why `BOMPartData` is decoded but deliberately not read. Two things the format reference leaves open are settled there: the Hierarchy stream's "24 bytes of fixed metadata" per net record are the record's own framing, and type 66 (`SthInHierarchy1`), which OpenOrCadParser marks unidentified, is the part occurrence that pairs an occurrence id with an instance (PR #160)

## [1.5.3] - 2026-08-14

An Altium net now carries the name and the reach the board gives it. A net that
never leaves its sheet is that sheet's own and is numbered after it, a net named
after one of its pins is named after the pin Altium picks, and a repeated sheet
or a signal harness names its nets the way the board writes them. Every rule
here was settled against a board's own `PcbDoc` netlist rather than inferred
from the schematic alone, and the numbers below are that comparison.

### Fixed

#### Altium net scoping

- A `.PrjPcb`'s `[Design]` block is read for `HierarchyMode`, which gives the project's Net Identifier Scope, and a net carrying no port, sheet entry, power port or harness belongs to the sheet it is drawn on. Every sheet's nets were previously merged into one map keyed by name alone, so two sheets that each labelled a wire `SCL` became one net. Where the project sets `AppendSheetNumberToLocalNets`, such a net now carries its sheet number the way Altium writes it to the board. `Automatic` resolves as Altium resolves it: sheet entries give Hierarchical, ports alone give Flat, neither gives Global. Over-merged nets measured against three independent boards: MiSKo3 10 to 0, A7-Minima 33 to 3, ZXEvoPro 163 to 34 (#128, PRs #143, #146)
- A sheet-local net is numbered for being its sheet's own, not for colliding with another sheet's. The MiSKo3 board carries `VBAT_8` for a label drawn on sheet 8 alone, so a name two sheets reuse is separated as a consequence of the rule rather than as a special case (PR #146)
- A net named after one of its own pins is left bare. `NetC3_1` is already unique across a board because the refdes is, and every board read for this carries those unnumbered. Numbering them took `mixr-power` from 6 unmatched board nets to 57 (PR #146)
- A net named on a parent sheet and wired straight into a sheet entry keeps its pins on the child sheet, so the parent's pinless copy was dropped and the sheet that named the net never registered its claim. Named nets are now recorded whether or not they reached the netlist, and the name follows the net onto every sheet carrying it onward through a port or harness. Nets emitted bare where the board numbers them: A7-Minima 3 to 0, ZXEvoPro 34 to 22, solarcar-bms 37 to 35 (#148, PR #151)
- A harness member is numbered after the sheet whose net label names its bundle, which is the sheet Altium numbers it after, rather than going out with no number at all. Altium builds a member's name as `<the bundle's net label>.<member>`, so the bundle is read back out of the member's own name. On the solarcar-bms board 40 of 44 member names are numbered this way, none after the member's own sheet, and board agreement rises from 56.6% to 61.8% (#153, PR #156)
- `HierarchyMode` maps only the values a design has demonstrated. `1` was mapped to Flat on the reasoning that the table follows the Net Identifier Scope drop-down, a premise `solarcar-bms` disproved for `4`; it now falls through to `Automatic`, which reads the scope from what the design actually draws. No design in the corpus records `1`, so no output changes (PR #152)

#### Altium net naming

- Designators are ordered by their number when a net is named after one of its pins, so `R9` precedes `R11` and the net Altium calls `NetR9_2` is no longer named `NetR11_1`. The sort compared designators as text, which only shows once a design has ten or more of a prefix. Agreement on auto-generated names: mixr-power 96.1% to 100.0%, pca10056 96.1% to 99.0%, LimeSDR-USB_1v4 98.4% to 98.8% (#149, PR #150)
- A multi-channel design names an auto-named net from the channel's expanded designator, placing the channel inside the name as `NetDD12_AY1_5` rather than after it as `NetDD12_5_AY1`. Altium expands the designator before it names the net, so the channel lands within. On `aberrant-sound-module`, agreement on auto-generated names goes from 65.4% to 100.0% and overall agreement from 88.5% to 97.9% (#154, PR #155)

### Added

- `scripts/build-binary.sh <target> <outfile> packaged` builds a binary with self-update disabled, for installs a package manager owns: no startup update check, and `--update` and `--uninstall` explain that the install is managed externally instead of modifying it. Release builds are unaffected, and an unknown channel is rejected rather than quietly compiling one of these (PRs #140, #142)
- `npm run compile:all` builds the five per-arch binaries on any host; the macOS universal binary has its own `npm run compile:darwin-universal` (PR #138)
- `VERSION=<string> scripts/build-binary.sh ...` stamps a version without editing `package.json`, which is what a downstream packager building `1.5.2-3` or a snapshot wants. Building the binary now needs only Bun, not an undeclared Node install (PR #145)

### Changed

- Release binaries are reproducible from the tree: they are compiled with a pinned Bun version rather than whichever was latest at build time, built by `scripts/build-binary.sh` so anyone can reproduce one locally, and dependencies install from committed lockfiles rather than re-resolving per run (PRs #135, #136, #139)

## [1.5.2] - 2026-08-12

Every tool now says what it is and what it can do. A title, and whether calling
it writes anything: clients read those annotations to decide what needs your
confirmation, so the eleven tools that only read a design run without
interrupting you, and the one that writes to disk always asks first. The server
also ships a privacy policy, which is what a local extension is required to
carry, and what anyone pointing this at a confidential schematic ought to read.

### Added

- Every tool carries a `title` and MCP annotations. The eleven query tools and `run_erc` declare `readOnlyHint`, so a client may run them without a per-call confirmation; `export_cadence_netlist` declares `destructiveHint`, because it runs Cadence's exporter and writes a netlist directory over any earlier one, so it always prompts. `openWorldHint` is false throughout: these tools read the design files already on the machine rather than an open-ended set of external services. `src/server.test.ts` asserts the metadata over a real client connection, so a tool registered without a title or a hint fails the build (PR #125)
- `PRIVACY.md`, linked from `manifest.json`'s `privacy_policies` and summarised in the README. It covers what the server reads, what it retains (nothing), and the two network calls it can make: the standalone binary's update check against the GitHub releases API, and OpenTelemetry, which stays off unless you point `OTEL_*` at your own backend. Neither carries design data. It is explicit that query results reach your MCP client and that client's model provider, which is the part that matters for a confidential design (PR #125)
- `manifest.json` gains a `support` URL, and `PRIVACY.md` ships with the npm package (PR #125)

### Documentation

- The README, docs, and extension manifest describe the server as it is today. KiCad joins Cadence and Altium in every format list, Cadence `.DSN` schematics are documented as read natively, and the claim that Cadence and Altium users need their own EDA licence is gone: no EDA installation and no EDA licence are required to read a design, and the optional `export_cadence_netlist` remains Windows plus Cadence SPB. The unsupported-format error in `docs/tools/list_nets.md` matches the one the code returns, `CONTRIBUTING.md` points at the `test-fixtures` submodule that replaced the three per-design ones, and the schema doc gains the KiCad field mapping (PRs #122, #123)
- The README intro no longer repeats the per-format detail the Supported Formats table gives directly below it, and the "no EDA installation" claim is scoped to Cadence and Altium, since a KiCad project without a committed `.net` export uses the free `kicad-cli` (PR #124)

## [1.5.1] - 2026-08-07

Altium signal harnesses were only bridging nets by coincidence. A harness entry
named the net it touched, so the two ends of a harness agreed only where the
entry name and both wire labels happened to be the same word, and half of all
harness entries were never placed on the sheet at all. This release reads the
harness the way Altium describes it, as a container that carries nets rather
than one that names them.

### Fixed

- Altium nets are traced through a signal harness by the bundle it carries, so a net keeps its identity when the wires either side of the harness are labelled differently, whether the two ends are on one sheet or on different ones. A bundle is identified by the harness-typed port its connector reaches, or by the signal harness line it meets, and entries of one bundle sharing a name are one net. A bundle known by a different port name at each end, as a bulkhead sheet gives it, is reconciled from the harness line the parent sheet draws between the two sheet entries naming it (#115, PR #118)
- Altium harness entries drawn on the right-hand edge of a connector are now placed. Which edge the entries sit on is written two ways, `HarnessConnectorSide=1` on the connector or `Side=1` on each entry, and only the first was read, so 62 of the 115 connectors in the fixture corpus contributed no connectivity whatsoever. Entries at a fractional `DistanceFromTop` are placed exactly rather than half a grid step out. Together the rules put 364 of the 365 entries across two harness designs exactly on the end of a wire (PR #118)
- Altium harness entries no longer name the nets they touch. An entry name is unique only inside its own harness, so a design drawing one sensor harness per sensor had every sensor's `SIGNAL` collapse under one name. The one case Altium documents is kept: a net label placed on the signal harness line names the harness, and the nets it carries become `<label>.<entry>` (PR #118)
- Altium harness entries that cannot be placed no longer collapse onto the origin, where every one of them appeared to touch every other. A connector with no coordinates, and a harness sheet entry on a top or bottom edge whose geometry has not been confirmed against a real design, are passed over rather than guessed at (PR #118)
- Two Altium nets sharing a name on one sheet are merged instead of the second replacing the first and silently dropping its pins. On `aberrant_sound_module` this restores 41 pin connections that the netlist had simply left out (PR #118)
- `OwnerIndex` written in a `.SchDoc`'s `Additional` stream numbers that stream's own records, so it is rebased when the two record lists are joined. Harness entries now nest under their connector instead of under an unrelated `FileHeader` record (PR #118)

### Documentation

- `docs/altium-format.md` covers the harness entry placement rules for both connector arrangements, the fixed-point `DistanceFromTop`, how a bundle is identified and named, and how one crosses a sheet boundary (PR #118)

## [1.5.0] - 2026-08-06

This release brings Cadence `.DSN` parsing to exact agreement with Cadence's own
netlist export across the whole fixture corpus, traces Altium designs through
signal harnesses and multi-channel sheets, and stops several classes of silently
wrong answer where a design was served another design's circuit.

### Fixed

#### Cadence connectivity

- Cadence DSN cross-page net disambiguation no longer merges designer-authored sibling nets into one. A hierarchy name `<net>_<suffix>` is treated as a netlister collision rename only when the suffix is entirely digits and the name is not already some wire group's resolved name. Previously `parseInt()` stopped at the first non-digit, so a rail-suffixed sibling like `SIGNAL_1V8` read as suffix `1`, and an entirely-numeric family like `SIGNAL_01`/`_02` cleared the digit test outright; either way the bare net's pins were silently absorbed into unrelated nets (#85, #88, PR #91)
- Cadence DSN multi-section parts (resistor packs, transistor arrays, multi-gate logic) resolve each section's pins from the section index stored in the file rather than from `dbId` ordering. `PlacedInstance` now decodes the `uint16` after `source_package`, which holds the 0-based section; `dbId` order is not section order, so on parts whose sections are not allocated in placement order the pins of one section were reported against another section's pin numbers. Nets whose pin set disagrees with the DAT export across the Cadence fixture corpus fall from 79 to 24 (#89, PR #98)
- Cadence `.DSN` designs now produce the same connectivity as Cadence's own netlist export on every test fixture, closing the remaining 24 disagreements: 4936 of 4936 nets across 11 designs. Power and ground symbols were keyed by placement origin, so neighbouring rails one grid step apart fused into a single net wherever their drawn symbol boxes overlapped; symbols are now attached to the wire group they actually touch, preferring the group that already carries the symbol's own net name. Pins that connect straight to a power port with no wire in between resolve through the design's string list. Pins a package section has no pad for (`pinIgnore`, bit 7 of the byte following each pin name in a Device pin map) are no longer reported as connected. Connector pin numbering follows the pin map that fits the placed symbol rather than the first map found, which had swapped adjacent signals on multi-map connectors (PR #108)
- Cadence `.DSN` designs report pin function names for every component, up from 96.5%. The Cache stream's part records were located by assuming a fixed prefix length, so any record whose prefix carried property pairs was skipped and the design returned pin-to-net mappings with no function names at all; a part's own name also lost precedence to a stripped alias belonging to a different variant of the same base part (#50, PR #109)

#### Cadence netlist export

- `export_cadence_netlist` writes to `<design>_netlist/` beside the schematic, so several Cadence designs in one folder no longer overwrite each other's exported netlist. pstswp names its output the same way for every design, so two designs exporting to one directory left only the second design's netlist behind. A folder holding a single design that already has an `allegro/` directory keeps using it (#29, PR #110)
- The exporter and design discovery now agree on which directory holds a design's netlist. They ranked the candidates in opposite orders, so an export could write to `allegro/` while every query read `<design>_netlist/`: each re-export reported success and every answer came from a netlist that had stopped updating (PR #110)
- A `.DSN` and a `.cpm` sharing a stem no longer contend for one export directory in a way that leaves the design that produced it with nothing (PR #110)
- `export_cadence_netlist` no longer moves the design file itself into the temporary directory when given a path that is not a `.DSN`. Deriving the lock-file path by substituting the extension returned the input unchanged for any other path, and `list_designs` hands out `pstxnet.dat` for a dat-only design and the `.cpm` for an HDL one, so the documented workflow reached it (PR #110)
- The `.DSNlck` lock file is moved to a sibling name rather than into the system temporary directory. On the UNC and mapped shares these projects live on, that rename crossed volumes and failed with `EXDEV`, reported as advice to close a design nobody had open, and no design on a share could be exported at all (PR #110)
- Large designs can be exported again. pstswp at the verbosity the exporter requests emits megabytes, while the child process ran under Node's 1 MiB output cap, which kills the child at the limit; the export died partway through writing the netlist and the failure was reported as Cadence's (PR #110)
- A failed export no longer leaves a partially written netlist behind for later queries to read, and only removes a directory the failed run itself created (PR #110)
- An export that Cadence reports as successful but that did not write all three `.dat` files, or left an earlier run's, is now reported as a failure instead of sending the caller to read stale or missing files (PR #110)

#### Discovery

- A design whose netlist cannot be told apart from a neighbour's is reported with no netlist and an explanation, rather than being served the neighbour's circuit. A shared export directory that two designs reach equally well, and that neither names, is attributed to neither (PR #110)
- `list_designs` no longer fails for an entire directory tree when one `pstxprt.dat` cannot be read. A single ACL-locked or Cadence-held file made every design of every format, Cadence, Altium and KiCad alike, invisible behind one "Failed to search" error (PR #110)
- Queries resolve the same netlist whichever case the `.DSN` extension is written in. Cadence writes `.DSN` and callers write `.dsn`, which name one file on Windows and macOS, and the mismatch could return a neighbouring design's netlist (PR #110)
- Design discovery and test collection skip macOS AppleDouble (`._*`) sidecars. On network volumes these shadow every file, so `._board.DSN` surfaced in `list_designs` as a phantom design that failed to parse (PR #87)
- Which netlist a design receives no longer depends on the host locale. Ordering used `localeCompare`, whose collation follows `LANG` and which reports two distinct paths as equal when they differ only by a soft hyphen (PR #110)

#### Altium

- Nets are traced through Altium signal harnesses. Harness objects live in a separate `Additional` OLE stream that was never read, so harness connectors, entries and types were absent from the parse entirely and any net reaching a harness ended there, leaving connected components reported as unconnected. Harness entries are now parsed, positioned and connected, and harness types, including nested ones, resolve to their member signals (#43, PRs #104, #105)
- Altium signal harnesses connect across sheet boundaries. A harness-typed sheet entry carries its bundle's member signals into the child sheet, including members of nested harness types, so components joined by a harness across pages are reported as connected instead of as separate unconnected nets (#43, PR #106)
- Altium multi-channel designs expand correctly regardless of the project's channel designator format, and no longer require a compiled `.PrjPcbStructure` to be committed. Previously only `$Component_$RoomName` projects that shipped a structure file expanded; every other configuration silently reported one channel, under-counting components and merging per-channel nets (#44, PR #102)

#### Traversal

- XNET traversal stops at power rails whose names the stop-net regex did not recognize. `PVCC*`, `PVNN*`, and `P<n>V*` join the rail alternatives, `NC` is aligned with the existing query-xnet special case, and a configurable pin-count guard (`TraversalOptions.stopNetPinThreshold`, default 40) stops expansion at structurally rail-shaped nets regardless of name. An explicitly queried rail still expands. Previously every pull-up on such a rail acted as a pass-through and traversal fused much of the board into one false supernet (#84, PR #86)
- `circuit_hash` is now backend-invariant. The canonical form hashes connectivity only (`refdes`, pins, net) and no longer folds in `mpn`, which is a best-effort field populated differently by the `.dat` and `.DSN` paths, so an XNET that is pin-for-pin identical across backends hashed differently. Agreement between the two backends across the Cadence fixture corpus rises from 6.8% to 94.6% (#92, PR #93)

### Added

- The DSN-vs-DAT coverage report gains a `Conn` column comparing the actual `{refdes.pin}` set of every net present in both netlists. Net and component coverage match on names alone, so a net that kept its name but lost pins to another net scored as fully covered; connectivity agreement is what a wrong-connectivity bug actually moves (PR #95)
- Golden-file tests assert connectivity, pin names, and the number of designs covered, against Cadence's own export where one exists. Coverage was measured on net and component names alone, and compared only the nets both sides had, so a net that lost pins to another net or went missing entirely could not fail a test (PR #108)
- The Altium schematic file format is documented in `docs/altium-format.md`, including the record types, the `Additional` stream, and how harnesses and multi-channel sheets are represented (PR #103)

### Changed

- Type-checking and linting now cover test files. `tsconfig.check.json` and the ESLint config both excluded them, so `npm run type-check && npm run lint && npm test` passed on a test file TypeScript rejects outright (PR #110)

### Thanks

- [@Neil-Liao-TW](https://github.com/Neil-Liao-TW) reported the false-supernet traversal bug (#84), the cross-sheet false connectivity (#85), and the backend-dependent `circuit_hash` (#92), and contributed the fixes for all three plus the AppleDouble sidecar fix (PRs #86, #87, #91, #93). Three of this release's connectivity fixes are their work end to end, from diagnosis to patch.
- [@WLaney](https://github.com/WLaney) reported that nets were not traced through Altium signal harnesses (#43) and that multi-channel designs were not expanded (#44). Both are the basis of this release's Altium work.

## [1.4.0] - 2026-07-16

### Added

- The per-call OpenTelemetry log record now also carries `enduser.id` (mirroring the resource attribute) and, when `OTEL_CAPTURE_TOOL_ARGS` is enabled, `tool.args` (the same JSON already recorded on the span) as log-record attributes. Log/label-based backends index only log-record attributes (resource attributes are dropped and span attributes are never carried), so per-user and per-input analytics are now possible from logs alone. Args stay opt-in behind the existing `OTEL_CAPTURE_TOOL_ARGS` flag; `enduser.id` mirrors a value already exported on every signal (#82)

## [1.3.0] - 2026-06-24

### Added

- `run_erc` tool: deterministic electrical rule checks over a design's netlist, returning findings grouped by severity. Flags single-pin nets (`net.single_pin`), test-point-only nets (`net.testpoint_orphan`), test-point stubs (`net.testpoint_stub`), and auto-generated names on real multi-pin nets (`net.unnamed`). Supports `include_dns` and `include_rules`/`exclude_rules`; output is complete (never truncated) with endpoints in `REFDES.PIN` form. Unconnected pins without a no-connect symbol are intentionally not checked (parsers cannot distinguish them from intentional no-connects).

## [1.2.0] - 2026-06-24

### Changed

- Tool outputs now always represent multi-value fields as JSON arrays, even for a single element. The `refdes` field (`list_components`, `search_components_by_*`, `query_xnet_*`) and the connection `pins` field (`query_xnet_*`) previously collapsed a one-element list to a bare string; a single result is now `["U5"]` / `["1"]` rather than `"U5"` / `"1"`. This removes the string-or-array ambiguity so every consumer has one shape to parse. Note this is an output-shape change for existing consumers. (`query_component`'s own `refdes`, a single component designator, is unchanged.)

## [1.1.1] - 2026-06-23

### Fixed

- The XNET tools (`query_xnet_by_net_name`, `query_xnet_by_pin_name`) now recognize suffixed and hierarchical ground nets. The ground guard previously matched a hardcoded exact list (`GND`, `VSS`, `AGND`, `DGND`, `PGND`, `SGND`, `CGND`), so KiCad's own default global ground `GNDREF` (and `GNDD`, `GNDS`, `GNDPWR`, …) plus sheet-path-prefixed grounds like `/GND` slipped through and the trace flooded the entire ground tree, overflowing the output token limit. Ground tokens now allow a trailing suffix and the sheet-path prefix is stripped before classification, so these nets are correctly rejected; a suffix-only signal-ground such as `SIG_GND` is still treated as a signal
- `list_components` now reports the correct `Available prefixes` on designs with unannotated components. Refdes still carrying KiCad's `?` placeholder (e.g. `C?`, `D?`, `PS?`) were dropped from the suggestion list, so a query for an absent prefix on an otherwise-populated design wrongly reported `Available prefixes: []`. The list is now derived with the same prefix logic the matcher uses, so every suggested prefix resolves to real components

## [1.1.0] - 2026-06-19

### Added

- KiCad support: read a `.kicad_pro` project (or root `.kicad_sch`) and query its netlist like any other format. Discovery keys off `.kicad_pro`; a committed kicadsexpr export (`.net`) beside the project is parsed directly (keeping CI tool-free), otherwise one is generated on demand via `kicad-cli` (set `KICAD_CLI_PATH` for a non-standard install). Hierarchical sheets, buses, and global/hierarchical labels are resolved into flat net membership by kicad-cli. Validated against 10 curated golden fixtures spanning flat to depth-5 hierarchy across KiCad formats v6–v9

### Changed

- `search_nets` and the server instructions now note that KiCad nets declared inside a hierarchical sheet are sheet-path-prefixed (e.g. `/Peripherals/D0`, not `/D0`), so unanchored search patterns are preferred to avoid missing bussed/hierarchical nets

## [1.0.0] - 2026-06-17

First stable release.

### Added

- OpenTelemetry instrumentation: every tool call emits a span (`tool/<tool_name>`), metrics (`tool.calls`, `tool.duration`, `tool.errors`), and a structured log correlated by trace/span id, exported to any OTLP-compatible backend purely via the standard `OTEL_*` environment variables. Disabled and zero-overhead unless an OTLP endpoint is configured ([#66](https://github.com/IntelligentElectron/universal-netlist/issues/66))
- `enduser.id` resource attribute set from the host OS account name, attributing telemetry to the per-session user across traces, metrics, and logs
- Opt-in raw tool-argument capture on spans via `OTEL_CAPTURE_TOOL_ARGS=1` (off by default)

### Changed

- Consolidated telemetry into `src/telemetry/`: local JSONL usage analytics (`local`) and OpenTelemetry (`otel`) behind a single barrel

### Fixed

- Self-update now runs only for the compiled standalone binary; running from source (tsx/node) no longer performs a GitHub update check or re-execs into a downloaded binary

## [0.1.4] - 2026-06-12

### Added

- `VREG`-prefixed rails (e.g. `VREG`, `VREG_3V3`) recognized by the power/stop net patterns, so xnet traversal stops at voltage-regulator nets ([#63](https://github.com/IntelligentElectron/universal-netlist/pull/63))
- Net naming conventions guide (`docs/net-naming-conventions.md`) ([#58](https://github.com/IntelligentElectron/universal-netlist/pull/58))

### Changed

- Internal refactors: shared `getDesignName` helper in the service layer ([#62](https://github.com/IntelligentElectron/universal-netlist/pull/62)), deduplicated CLI executable-path resolution ([#61](https://github.com/IntelligentElectron/universal-netlist/pull/61))

## [0.1.3] - 2026-03-21

### Fixed

- Altium parser: add cross-product collinearity check to `pointOnSegment()`, preventing false net merges when diagonal wire bounding boxes overlap ([#54](https://github.com/IntelligentElectron/universal-netlist/issues/54))
- Altium parser: clean up `undefined` keys (`mpn`, `description`) from component output
- Cadence export: use `cmd.exe` instead of `bash` for `pstswp.exe` invocation, fixing failures on Windows systems without Git Bash ([#42](https://github.com/IntelligentElectron/universal-netlist/issues/42))

## [0.1.2] - 2026-03-10

### Added

- Altium PORT cross-sheet connectivity: PORT records connect signals across sheet boundaries by name ([#44](https://github.com/IntelligentElectron/universal-netlist/issues/44))
- Altium multi-channel expansion via PrjPCBStructure parsing: repeated sheets are expanded into N channel instances with renamed components and correctly classified nets ([#44](https://github.com/IntelligentElectron/universal-netlist/issues/44))
- Altium bus notation expansion in SHEET_ENTRY classification for shared signal detection

### Fixed

- DSN parser: handle 0x00 skip marker in LibraryPart SymbolPin parsing, fixing pin name extraction for certain component libraries

## [0.1.1] - 2026-03-10

### Fixed

- Preserve leading/trailing whitespace in DSN net names instead of silently trimming ([#49](https://github.com/IntelligentElectron/universal-netlist/issues/49))
- Coverage report matches nets by connectivity (component set) instead of exact name, eliminating false missing/extra net pairs caused by whitespace differences

## [0.1.0] - 2026-03-10

### Added

- DSN binary parser: complete parser for Cadence `.DSN` schematic files (CFBF/OLE container format), providing direct netlist extraction without requiring Cadence's exported `.dat` files. Achieves 100% pin number coverage and 96.1% pin name coverage across 9 test fixtures. Extracts nets, components, pin numbers, pin names, MPN, and Value fields directly from binary schematics.
- DNS (Do Not Stuff) detection at parse time: strips DNI, NF, NC, DNM markers from component fields
- `--export-json` CLI command for standalone netlist export (no MCP server required)
- `--coverage` CLI command for DSN vs DAT parity analysis
- Design descriptions extracted from Cadence project files in `list_designs`
- DSN coverage tests and golden files for 9 Cadence fixtures (BeagleBoard-xM, BeagleBone-Black, CutiePi, LAUNCHXL-CC1310, OSHW-Jetson-Series x5)

### Changed

- `list_designs` prefers `.dat` path for Cadence designs when exported files exist; falls back to `.DSN` path otherwise
- OleReader extracted to shared `parsers/ole-reader` module with hierarchical path support
- DAT parsers reorganized into `dat/` subdirectory
- DSN parser split from monolith into focused modules (`page-parser`, `cache-parser`, `package-parser`, `library-parser`, etc.)
- `service.ts` split into `service/` modules
- Developer scripts consolidated: 24 ad-hoc DSN debug scripts merged into `dsn-inspect.ts`

### Fixed

- Pin number resolution for multi-unit components and version suffix matching
- `list_components` exact refdes prefix matching (e.g., `C` no longer matches `CON`, `L` no longer matches `LED`)
- Altium parser encoding fallback: tries UTF-8 first, falls back to latin1 for Windows-1252 encoded files (fixes corrupted special characters)
- Altium net names with overbar notation (e.g., `\V\C\C`) unescaped to plain text (`VCC`)

## [0.0.22] - 2026-03-02

### Added

- Discover Cadence designs that only have exported `.dat` files (no `.DSN` schematic) ([#38](https://github.com/IntelligentElectron/universal-netlist/pull/38))

### Changed

- Omit `mpn` key from JSON output when MPN data is missing instead of emitting `"mpn": null` ([#39](https://github.com/IntelligentElectron/universal-netlist/pull/39))

## [0.0.21] - 2026-02-27

### Added

- Local JSONL telemetry for usage analytics: records session info (user, machine, version) and tool call events (tool name, args, duration, success) to a local `telemetry.jsonl` file
- `--export-telemetry` CLI flag to export telemetry as a zip archive for sharing

## [0.0.20] - 2026-02-24

### Added

- Discover standalone `.SchDoc` files when no `.PrjPcb` project file is present ([#26](https://github.com/IntelligentElectron/universal-netlist/issues/26))
- `.mcp.json` for local MCP server development with `npx tsx`

### Changed

- Remove `--no-update` flag and `UNIVERSAL_NETLIST_MCP_NO_UPDATE` env var; auto-update is always enabled
- Remove confirmation prompt from `--update` command; updates proceed immediately

### Fixed

- Reject overly broad search patterns that match all items, directing users to `list_nets` or `list_components` instead ([#27](https://github.com/IntelligentElectron/universal-netlist/issues/27))

## [0.0.19] - 2026-02-21

### Added

- Subpath exports for library consumers (`./service`, `./types`) ([#23](https://github.com/IntelligentElectron/universal-netlist/pull/23))

### Changed

- Clarify supported file formats in documentation — show actual input files instead of project file types ([#22](https://github.com/IntelligentElectron/universal-netlist/pull/22))
- Add `.plans/` to `.gitignore`

## [0.0.18] - 2026-02-12

### Fixed

- Serialize `export_cadence_netlist` calls to prevent concurrent Cadence license conflicts

## [0.0.17] - 2026-02-12

### Fixed

- Fix `export_cadence_netlist` failing silently when `.DSNlck` lock files are present ([#15](https://github.com/IntelligentElectron/universal-netlist/issues/15))
- Fix search tools rejecting `(?i)` and other PCRE-style inline regex flags ([#14](https://github.com/IntelligentElectron/universal-netlist/issues/14))

## [0.0.16] - 2026-02-10

### Fixed

- Fix `export_cadence_netlist` to reuse existing `Allegro/` or `allegro/` output directory instead of always creating `Allegro/`

### Changed

- Extract `resolveAllegroDir` for Allegro output directory resolution
- Clean up test formatting and remove redundant spy restores

## [0.0.15] - 2026-02-09

### Fixed

- Fix installation on Intel Macs: ship macOS universal binary (arm64 + x64) via `lipo`
- Fix `install.sh` creating install directory after network calls (confusing errors on failure)
- Fix auto-updater requesting arch-specific macOS binary names instead of universal

### Changed

- `.mcpb` Claude Desktop extension now contains a universal macOS binary
- Release workflow signs and notarizes a single universal binary instead of two arch-specific ones
- `install.sh` downloads `darwin-universal` on macOS regardless of architecture

## [0.0.14] - 2026-02-04

### Added

- `list_designs`: add `max_depth` parameter to limit directory recursion depth ([#2](https://github.com/IntelligentElectron/universal-netlist/issues/2))
- `list_designs`: add `max_results` parameter to cap returned designs (default: 50)
- Claude Code GitHub Actions workflows for automated PR review

### Fixed

- `list_designs`: return absolute paths instead of confusing `..\..\` relative paths ([#2](https://github.com/IntelligentElectron/universal-netlist/issues/2))
- `list_designs`: return structured error instead of crashing on nonexistent or invalid paths

## [0.0.13] - 2026-02-03

### Changed

- Use relative paths throughout: design paths are now relative to CWD instead of absolute
- Extract path resolution into dedicated `paths.ts` module
- Update all tool documentation with relative path examples

### Fixed

- Document cross-drive behavior on Windows (paths remain absolute when CWD is on a different drive)

## [0.0.12] - 2026-01-30

### Fixed

- Fix `--version` for npm/npx installs (reads from package.json at runtime)

## [0.0.11] - 2026-01-30

### Fixed

- Fix release workflow to inject BUILD_VERSION when compiling binaries

## [0.0.10] - 2026-01-30

### Fixed

- Fix `--version` showing wrong version in compiled binaries (was hardcoded to 0.0.3, now injected at build time)
- Fix `--uninstall` to remove entire install directory instead of just the binary

## [0.0.9] - 2026-01-30

### Fixed

- Use `npm install` instead of `npm ci` for cross-platform compatibility with npm 11.x

## [0.0.8] - 2026-01-29

### Fixed

- Fix npm OIDC publishing by removing `registry-url` from setup-node (was creating auth token placeholder that interfered with OIDC)
- Explicitly upgrade npm to latest version for reliable OIDC support

## [0.0.7] - 2026-01-29

### Fixed

- Use Node.js 22 for npm publish (OIDC requires npm 11.5.1+)

## [0.0.6] - 2026-01-29

### Fixed

- Exclude test files from npm package (reduces package size)

## [0.0.5] - 2026-01-29

### Fixed

- Fix npm publish workflow failing due to rollup platform-specific dependency bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828))
- Use `--ignore-scripts` during npm publish as a security best practice

### Notes

- v0.0.4 GitHub release exists but npm publish failed; this release provides npm package availability

## [0.0.4] - 2026-01-29

### Added

- npm publishing support: install via `npm install -g universal-netlist` or use with `npx`
- Simpler MCP configuration for npm global installs

### Changed

- `--update` command now provides npm-specific instructions for npm installs
- Skip auto-update for npm installs (use `npm update -g` instead)

## [0.0.3] - 2026-01-29

### Changed

- Release notes are now automatically extracted from CHANGELOG.md

## [0.0.2] - 2026-01-29

### Fixed

- Show helpful message when run directly in terminal instead of hanging

## [0.0.1] - 2026-01-29

### Added

- Initial open source release
- MCP server for querying EDA netlists
- Support for Cadence CIS (.dsn) and HDL (.cpm) formats
- Support for Altium Designer (.PrjPcb) projects
- Tools for listing and searching designs, components, and nets
- XNET traversal for tracing circuit connectivity
- Cadence netlist export (Windows only)

### Tools

- `list_designs` - Discover design projects in a directory
- `list_components` - List components by type prefix
- `list_nets` - List all nets in a design
- `search_nets` - Search nets by regex pattern
- `search_components_by_refdes` - Search by reference designator
- `search_components_by_mpn` - Search by Manufacturer Part Number
- `search_components_by_description` - Search by description
- `query_component` - Get component details with pin mappings
- `query_xnet_by_net_name` - Trace connectivity from a net
- `query_xnet_by_pin_name` - Trace connectivity from a pin
- `export_cadence_netlist` - Export to Allegro format
