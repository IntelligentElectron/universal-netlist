# Scripts

Developer and agent utility scripts for the universal-netlist project. All scripts run with `npx tsx`.

## gen-golden.ts

Generate golden JSON fixtures from parsed design files. Golden files are the reference output that integration tests compare against.

```bash
npx tsx scripts/gen-golden.ts <format> <name> <path>
```

- `format`: `cadence` or `altium`
- `name`: output file name (without extension)
- `path`: path to the design file (.DSN, .PrjPcb, or pstxnet.dat)

Example:

```bash
npx tsx scripts/gen-golden.ts cadence BEAGLEBONEBLK_C3 "test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN"
```

Output is saved to `test/golden/<format>/<name>.json`.

When DAT files (.dat) exist alongside a .DSN, the parser prefers DAT (richer data: pin names, MPN, values). To generate golden from DAT, pass the pstxnet.dat path.

## dsn-coverage-report.ts

Compare DSN direct parser output against DAT golden files for all Cadence fixtures. Reports net and component coverage with categorized gap analysis.

```bash
npx tsx scripts/dsn-coverage-report.ts                    # All fixtures, summary table
npx tsx scripts/dsn-coverage-report.ts BEAGLEBONEBLK_C3   # Single fixture, verbose breakdown
```

Summary mode prints a table with net/component counts and coverage percentages. Single-fixture mode adds per-net detail: missing nets grouped by category (auto-generated, named, no-connect, bus-range), extra nets, and the golden connections for each missing net.

Aggregate stats at the bottom show total coverage across all fixtures and a missing-by-category breakdown.

## dsn-gap-analysis.ts

Deep-dive into gaps between DSN parser output and a DAT golden file for a single fixture. Categorizes every missing and extra net, maps extra nets to their likely golden counterpart via refdes Jaccard similarity, identifies schematic-to-PCB net renames, and traces "stolen" refs (refdes that moved from a golden net to an extra DSN net).

```bash
npx tsx scripts/dsn-gap-analysis.ts <golden-name>
```

- `golden-name`: name of the golden JSON file (without extension), e.g. `BEAGLEBONEBLK_C3`

Run without arguments to see available golden files.

Example:

```bash
npx tsx scripts/dsn-gap-analysis.ts BEAGLEBONEBLK_C3
```

Report sections:
- **Refdes accuracy**: Per-net refdes match rate on common nets, with mismatch details
- **Missing nets**: Nets in golden but not in DSN, grouped by category
- **Extra net mapping**: Each extra DSN net mapped to its likely golden counterpart
- **Schematic vs PCB renames**: Extra named nets that are schematic-side aliases for golden PCB net names
- **Stolen refs**: Golden nets missing a refdes, showing which extra DSN net captured it
- **Summary**: Coverage percentage with missing/extra breakdowns by category

## dsn-check-ports.ts

Compare wire aliases against net table entries for all pages in a DSN file. Reports conflicts (alias != table name for the same wire), alias-only wires, and table-only entries. Useful for understanding net name resolution discrepancies.

```bash
npx tsx scripts/dsn-check-ports.ts <dsn-file>
```

Example:

```bash
npx tsx scripts/dsn-check-ports.ts test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN
```

## dsn-wire-trace.ts

Trace wire connectivity for a specific coordinate on a page. Builds a Union-Find from all wire endpoints, then shows every wire segment in the same connected group, their aliases and net table entries, and all coordinates in the group. Useful for debugging wire graph name propagation.

```bash
npx tsx scripts/dsn-wire-trace.ts <dsn-file> <page-substring> <x> <y>
```

Example:

```bash
npx tsx scripts/dsn-wire-trace.ts test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN P03 400 410
```

## dsn-find-wire.ts

Search for wires matching a name pattern on a specific page (or all pages). Shows ALL aliases on each wire (not just the first), net table entries, and coordinates. Useful for finding wires with multiple aliases or verifying name resolution.

```bash
npx tsx scripts/dsn-find-wire.ts <dsn-file> <page-substring> <name-regex>
```

The page-substring filters pages (empty string matches all). The name-regex is matched case-insensitively against all aliases and the net table entry.

Examples:

```bash
npx tsx scripts/dsn-find-wire.ts test/fixtures/cadence/BeagleBoard-xM/SCH/BeagleBoard-xM_ORCAD.DSN P10 USBDM
npx tsx scripts/dsn-find-wire.ts test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN "" OSC
```

## dsn-inspect.ts

Low-level inspector for DSN binary internals. Useful for debugging specific parsing issues, tracing net connectivity, and understanding the CFBF container contents.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> <command> [args]
```

Commands:

### summary

Wire and pin statistics, page list, coordinate match rates.

```bash
npx tsx scripts/dsn-inspect.ts test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN summary
```

### component \<REFDES\>

All pins for a component with T0x10 index, coordinates, netId, coordinate-resolved net name, and final resolved net name. Shows disagreements between coordinate and netId resolution.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> component U11
```

### net \<NET_NAME\>

All pins and wires on a named net. Shows which components connect and the wire segments.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> net HDMI_1V8
```

### netid \<ID\>

Trace a T0x10 netId (Cadence database net object ID) across all pages. Shows all pins sharing that ID and how the net name is resolved.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> netid 21667305
```

### unnamed

List all unnamed wire groups (wires without an alias or net table entry), grouped by wire ID. Shows which pins connect at wire endpoints.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> unnamed
```
