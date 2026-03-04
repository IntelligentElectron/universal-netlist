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
