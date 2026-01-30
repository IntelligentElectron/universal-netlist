# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.9]: https://github.com/IntelligentElectron/universal-netlist/releases/tag/v0.0.9
[0.0.8]: https://github.com/IntelligentElectron/universal-netlist/releases/tag/v0.0.8
[0.0.7]: https://github.com/IntelligentElectron/universal-netlist/releases/tag/v0.0.7
[0.0.6]: https://github.com/IntelligentElectron/universal-netlist/releases/tag/v0.0.6
[0.0.5]: https://github.com/IntelligentElectron/universal-netlist/releases/tag/v0.0.5
[0.0.4]: https://github.com/IntelligentElectron/universal-netlist/releases/tag/v0.0.4
[0.0.3]: https://github.com/IntelligentElectron/universal-netlist/releases/tag/v0.0.3
[0.0.2]: https://github.com/IntelligentElectron/universal-netlist/releases/tag/v0.0.2
[0.0.1]: https://github.com/IntelligentElectron/universal-netlist/releases/tag/v0.0.1
