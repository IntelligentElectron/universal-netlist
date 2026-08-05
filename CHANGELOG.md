# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-08-05

### Fixed

- Cadence DSN cross-page net disambiguation no longer merges designer-authored sibling nets into one. A hierarchy name `<net>_<suffix>` is treated as a netlister collision rename only when the suffix is entirely digits and the name is not already some wire group's resolved name. Previously `parseInt()` stopped at the first non-digit, so a rail-suffixed sibling like `SIGNAL_1V8` read as suffix `1`, and an entirely-numeric family like `SIGNAL_01`/`_02` cleared the digit test outright; either way the bare net's pins were silently absorbed into unrelated nets (#85, #88)
- XNET traversal stops at power rails whose names the stop-net regex did not recognize. `PVCC*`, `PVNN*`, and `P<n>V*` join the rail alternatives, `NC` is aligned with the existing query-xnet special case, and a configurable pin-count guard (`TraversalOptions.stopNetPinThreshold`, default 40) stops expansion at structurally rail-shaped nets regardless of name. An explicitly queried rail still expands. Previously every pull-up on such a rail acted as a pass-through and traversal fused much of the board into one false supernet (#84)
- `circuit_hash` is now backend-invariant. The canonical form hashes connectivity only (`refdes`, pins, net) and no longer folds in `mpn`, which is a best-effort field populated differently by the `.dat` and `.DSN` paths, so an XNET that is pin-for-pin identical across backends hashed differently. Agreement between the two backends across the Cadence fixture corpus rises from 6.8% to 94.6% (#92)
- Design discovery and test collection skip macOS AppleDouble (`._*`) sidecars. On network volumes these shadow every file, so `._board.DSN` surfaced in `list_designs` as a phantom design that failed to parse

### Added

- The DSN-vs-DAT coverage report gains a `Conn` column comparing the actual `{refdes.pin}` set of every net present in both netlists. Net and component coverage match on names alone, so a net that kept its name but lost pins to another net scored as fully covered; connectivity agreement is what a wrong-connectivity bug actually moves

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
