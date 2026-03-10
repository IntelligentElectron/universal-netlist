# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
