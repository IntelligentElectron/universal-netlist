# Scripts

Developer and agent utility scripts for the universal-netlist project. All scripts run with `npx tsx`.

## gen-golden.ts

Generate golden JSON fixtures from parsed design files. Golden files are the reference output that integration tests compare against.

```bash
npx tsx scripts/gen-golden.ts <format> <name> <path>
npx tsx scripts/gen-golden.ts --all
```

- `format`: `cadence` or `altium`
- `name`: output file name (without extension)
- `path`: path to the design file (.DSN, .PrjPcb, or pstxnet.dat)
- `--all`: regenerate all golden files from discovered fixtures

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

Summary mode prints a table with net/component coverage, per-net connectivity agreement, and field-level parity (Value, PinNum, PinName, MPN) for each fixture. The MPN column shows `hasDsn/total` since DSN extracts real part numbers while DAT golden uses composite format, so exact match is not meaningful.

The `Nets` and `Comps` columns match on names, so a net that survives with the wrong pins on it still scores as covered. The `Conn` column is the one that catches that: for every net present in both netlists it compares the actual `{refdes.pin}` set, which is what a wrong-connectivity bug moves. A design reading `Nets 100%` / `Conn 82.7%` has every expected net present and pins on the wrong ones.

Single-fixture (verbose) mode adds the differing nets with their reference-only and dsn-only pins, field mismatch examples, missing nets grouped by category (auto-generated, named, no-connect, bus-range), and extra nets.

Aggregate stats at the bottom show totals across all fixtures.

## dsn-gap-analysis.ts

Deep-dive into gaps between DSN parser output and a DAT golden file for a single fixture. Categorizes every missing and extra net, maps extra nets to their likely golden counterpart via refdes Jaccard similarity, identifies schematic-to-PCB net renames, and traces "stolen" refs (refdes that moved from a golden net to an extra DSN net).

```bash
npx tsx scripts/dsn-gap-analysis.ts <golden-name>
```

- `golden-name`: name of the golden JSON file (without extension), e.g. `BEAGLEBONEBLK_C3`

Run without arguments to see available golden files.

Report sections:
- **Refdes accuracy**: Per-net refdes match rate on common nets, with mismatch details
- **Missing nets**: Nets in golden but not in DSN, grouped by category
- **Extra net mapping**: Each extra DSN net mapped to its likely golden counterpart
- **Schematic vs PCB renames**: Extra named nets that are schematic-side aliases for golden PCB net names
- **Stolen refs**: Golden nets missing a refdes, showing which extra DSN net captured it
- **Summary**: Coverage percentage with missing/extra breakdowns by category

## verify-pin-numbers.ts

Compare DSN parser pin numbers against DAT golden files for all Cadence fixtures. Reports per-fixture pin number match rate and shows mismatch examples.

```bash
npx tsx scripts/verify-pin-numbers.ts
```

Useful for validating Package stream pin map resolution. Fixtures without Package streams use sequential pin numbering (1, 2, 3...) which may not match DAT golden when physical pin numbers differ.

## dsn-inspect.ts

Single tool for inspecting all internal DSN binary structures. Covers OLE container, hierarchy stream, page-level data (wires, pins, net tables, symbols), and wire connectivity tracing.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> <command> [args...]
```

### Page-level commands

#### summary

Wire and pin statistics, page list, coordinate match rates.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> summary
```

#### component \<REFDES\>

All pins for a component with T0x10 index, coordinates, netId, coordinate-resolved net name, and final resolved net name. Shows disagreements between coordinate and netId resolution.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> component U11
```

#### net \<NET_NAME\>

All pins and wires on a named net. Shows which components connect and the wire segments.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> net HDMI_1V8
```

#### netid \<ID\>

Trace a T0x10 netId (Cadence database net object ID) across all pages. Shows all pins sharing that ID and how the net name is resolved.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> netid 21667305
```

#### unnamed

List all unnamed wire groups (wires without an alias or net table entry), grouped by wire ID. Shows which pins connect at wire endpoints.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> unnamed
```

#### nettable [filter]

Per-page net table entries with wire counts. Optional filter matches net names (case-insensitive substring).

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> nettable          # All entries
npx tsx scripts/dsn-inspect.ts <dsn-file> nettable I2C       # Filter by name
```

#### symbols [page]

Ports, globals, and off-page connectors with full detail: coordinates, dbId, pairingId, bounding box. Optional page filter (substring match).

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> symbols            # All pages
npx tsx scripts/dsn-inspect.ts <dsn-file> symbols P10         # Filter by page
```

#### wire \<page\> \<name-regex\>

Search wires by name pattern on a specific page (or all pages with empty string). Matches case-insensitively against all aliases and net table entries. Shows segmentId, wireId, coordinates, aliases, and table name.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> wire P10 HDMI
npx tsx scripts/dsn-inspect.ts <dsn-file> wire "" OSC         # Search all pages
```

#### wiretrace \<page\> \<x\> \<y\>

Trace wire connectivity from a coordinate using union-find. Shows all wire segments in the connected group, their names, and all coordinates in the group.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> wiretrace P03 400 410
```

#### conflicts

Compare wire aliases against net table entries for all pages. Reports conflicts (alias != table name for the same wire), alias-only wires, and table-only entries (net table entry with no matching wire).

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> conflicts
```

### OLE-level commands

These commands do not parse page data (faster execution).

#### hierarchy

Hierarchy stream net names with hierarchy node IDs. Shows canonical net list used for cross-page name resolution.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> hierarchy
```

#### streams

List all CFBF streams and directories in the OLE container with sizes.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> streams
```

#### stream \<path\> [offset] [length]

Hex dump of a specific OLE stream with ASCII sidebar and string extraction. Defaults to first 500 bytes.

```bash
npx tsx scripts/dsn-inspect.ts <dsn-file> stream "Views/BeagleBoneBlack/Hierarchy/Hierarchy"
npx tsx scripts/dsn-inspect.ts <dsn-file> stream Cache 1000 256
```
