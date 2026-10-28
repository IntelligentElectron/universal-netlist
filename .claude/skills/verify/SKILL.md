---
name: verify
description: Build the real universal-netlist binary and drive its CLI and MCP surfaces to verify a change.
---

# Verify universal-netlist

## Build a binary to drive

```bash
V=$(mktemp -d)
scripts/build-binary.sh host $V/universal-netlist packaged
codesign --force -s - --entitlements entitlements.plist $V/universal-netlist   # macOS: unsigned exits 137
$V/universal-netlist --version
```

Build the `packaged` channel. A `github`-channel binary self-updates when it
starts serving MCP, which would replace the build under test with a release.
Bun should match `.bun-version`; the script does not check it.

## Surfaces

- **CLI:** `$V/universal-netlist <tool> <design> --flag value`. Capture stdout,
  stderr and the exit code (0 result, 1 `error` field, 2 usage error).
- **MCP:** run the binary with no arguments and speak JSON-RPC over stdio:
  `initialize`, `notifications/initialized`, then `tools/list` / `tools/call`.
  A short Python driver with `subprocess.Popen` and one JSON object per line works.

## Fixtures worth driving

`test/fixtures` (submodule; `npm run setup`). Designs with named variants:

- `kicad/kicad-qa-variants/variants.kicad_pro`: `Variant 1`, `Variant2` (DNS differs: J1 / R14)
- `cadence/LAUNCHXL-CC1310/.../Cadence/LAUNCHXL-CC1310.DSN`: `Standard`
- `altium/solarcar-bms/bms_mainboard-1_1.PrjPcb`: a variant named `0`
- `altium/fmc-dio-32chlvdsa/FMC_DIO_32ch_lvds_a.PrjPcb`: `VHDCI only` (space)

`universal-netlist list_designs --path test/fixtures/<format>` lists each design's variants.

## Gotchas

- `search_components_by_*` refuses a pattern that matches every part (`.*`);
  use narrower patterns to cross-check a whole design.
- Old Universal Netlist files: `git show main:test/golden/<format>/<name>.netlist.json`.
