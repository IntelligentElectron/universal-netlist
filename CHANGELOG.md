# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
