# KiCad schematic reader

A KiCad design is read from the first of these that works:

1. A committed `<project>.net` export beside the project: KiCad's own netlist.
2. The schematics themselves: the root `.kicad_sch` and every sheet it reaches, read by this package. No KiCad install is needed, and nothing is run.
3. `kicad-cli sch export netlist`, when KiCad is installed and the schematic reader cannot read the design (and `kicadCli` is on; it is off by default for a [library](library.md) file reader other than the local disk).

The order is a golden decision table: [resolve.rules.md](decision-tables/kicad-source/resolve.rules.md). When every source fails, the error names each reason.

## What the reader resolves

Wires and junctions; local, global and hierarchical labels; sheet pins and sheets used more than once; global and local power symbols, and the invisible power-input pins KiCad joins to a global net of the pin's name; multi-unit and De Morgan symbols, rotated and mirrored; no-connect pins and flags; buses (vectors such as `D[0..15]`, groups such as `I2C{SDA SCL}`, bus aliases from the project file or the sheets), joined across the hierarchy member by member; symbols excluded from the board, which KiCad leaves out of its netlist. Each part's fields map exactly as a saved `.net` does: the reader writes its result as a KiCad netlist and reads it with the same parser.

KiCad 6 files (schematic format before `20230121`) are read as KiCad reads them: each symbol instance's reference, unit, value and footprint come from the root sheet's `symbol_instances`, sheets name their file in `Sheet file`, and a power symbol names its net after its power pin rather than its value.

A sheet that cannot be read fails the read instead of leaving that sheet's parts and nets out of a netlist that would look complete.

## Net names

Every net is named the way KiCad's netlister names it, so a net is reported under the name an Allegro export or a KiCad BOM uses:

- A power symbol or a global label names its net over anything else.
- A bus member is named by its bus, over the labels on its own wires, and a bus that reaches other sheets names it over one that stays on a sheet. Between buses, the stronger label, then the shallower sheet, then the lower name. [net-name.rules.md](decision-tables/kicad-schematic/net-name.rules.md)
- A net no label names is named after a pin, `Net-(R1-Pad1)` or `Net-(U1A-SDA)`; the unit letter appears only beside a pin name. [pin-net-name.rules.md](decision-tables/kicad-schematic/pin-net-name.rules.md)
- A power symbol's net is its value from KiCad 7 on, its pin's name in a KiCad 6 file. [power-name.rules.md](decision-tables/kicad-schematic/power-name.rules.md)

## Parity with kicad-cli

`src/parsers/kicad/schematic/parity.test.ts` reads every KiCad design in `test/fixtures/kicad` with the reader alone and compares the result with KiCad's export, net by net and part by part. Eleven designs match exactly. One fixture ships without one of its sheets and is refused, naming the sheet. Where a fixture's saved export comes from an older KiCad whose netlister differs (yddraig-68k, saved by 10.0.0), `test/golden/kicad-cli/` holds the export of kicad-cli 10.0.5, which the reader follows. With KiCad installed, `KICAD_PARITY=live npm test` compares each design with a fresh export as well.

## Provenance

The reader began as `lib/kicad-builder/connectivity.ts` and `segment-index.ts` in IntelligentElectron's westworld (commit 255bbfb), by the same author, and is maintained here under Apache-2.0. Here it gained the netlist writer, the file reader, KiCad 6 support, and bus member naming across the hierarchy.
