# Net Naming Conventions

Consistent net naming makes schematics self-documenting, prevents ambiguity between power rails and logic signals, and allows automated analysis to correctly classify power, ground, and DNS components. This page defines the conventions you should follow on new designs.

All names are treated case-insensitively, so `gnd` and `GND` are equivalent.

## Ground Nets

Use one of these exact names for ground nets:

| Name | Typical use |
|------|-------------|
| `GND` | Default ground |
| `VSS` | Analog/power ground (common in datasheets) |
| `AGND` | Analog ground |
| `DGND` | Digital ground |
| `PGND` | Power ground |
| `SGND` | Signal ground |
| `CGND` | Chassis ground |

**Why:** these are the names every datasheet, schematic capture package, and netlist analyzer recognizes as ground. Non-standard names like `GROUND`, `0V`, `RETURN`, or `COMMON` make your ground plane indistinguishable from an arbitrary signal and require every downstream reader to special-case them. Pick one name per ground domain and stick to it.

## Power Rails

**Strongly preferred: `PP` / `PN` / `LD_` naming.** This is the convention you should use on new designs.

- `PP3V3`, `PP5V`, `PP1V8`, `PP12V` (positive power rails)
- `PN5V`, `PN12V` (negative power rails)
- `LD_PP3V3`, `LD_PN5V` (load-side of sense resistors, downstream of current-sense)

**Why this convention:**

- **Unambiguous polarity.** `PP` vs `PN` tells you the sign at a glance, without relying on a leading `+` or `-` that can be lost when the net name appears in CSVs, BOMs, or plain text.
- **Explicit voltage in the name.** `PP3V3` is self-documenting; you never have to cross-reference a rail map to know what voltage it carries, the way you do with `VCC_IO` or `VDD_CORE`.
- **No collision with IC pin names.** Chip datasheets reuse `VCC`, `VDD`, `VIN`, `VOUT` for pins. Using them as net names blurs the line between "the IC's VCC pin" and "the board's VCC rail", which confuses both humans and automated analysis.
- **Upstream and downstream are explicit.** `LD_PP3V3` clearly distinguishes the load side of a sense resistor from its source side `PP3V3`. This matters for every current-measurement circuit and cannot be recovered from a name like `VCC_3V3_SENSE`.

**Alternative styles that are also acceptable** (less preferred, but workable):

- **Explicit voltage:** `+3V3`, `+5V`, `+12V`, `-12V`, `+1V8`. Self-documenting, but fragile in contexts that strip or reinterpret the leading sign.
- **Functional rails:** `VCC`, `VCC_IO`, `VDD`, `VDD_CORE`, `VBAT`, `VBUS`, `VSYS`, `VREG`, `VIN`, `VOUT`. Familiar from datasheets, but they collide with IC pin names.
- **Explicit prefixes:** `PWR_3V3`, `PWR_12V`, `RAIL_5V`, `RAIL_ANALOG`. Verbose but unambiguous.

## Signal Naming Gotchas

These signal name patterns look like logic but are easily misread as power rails, both by humans skimming a schematic and by automated netlist classifiers. Avoid them:

| Bad name | Why it is ambiguous | Use instead |
|----------|---------------------|-------------|
| `-RESET`, `+SENSE` | A leading `+` or `-` is universally read as power-rail polarity | `nRESET`, `RESET_L`, `SENSE` |
| `PN_BUS`, `PPI_CLK` | Collides with the preferred `PP*` / `PN*` power-rail convention | `PERIPH_BUS`, `PERIPH_CLK` |
| `VIN_SEL`, `VOUT_EN` | `VIN` / `VOUT` reads as a rail, not as "the IC's VIN pin" | `U5_VIN_SEL`, `U5_VOUT_EN` |
| `VCC_OK`, `VDD_GOOD` | `VCC*` / `VDD*` reads as a rail | `PG_VCC_CORE`, `PG_VDD_IO` |

**Rule of thumb:** prefix logic signals with their functional domain (`USB_`, `I2C_`, `SPI_`, `GPIO_`, `CLK_`, `PG_`, `EN_`, `RST_`) instead of leading with `+`, `-`, `V`, `PP`, or `PN`, which all carry power-rail connotations.

## Differential Pairs

Use matching `_P` / `_N` (or `_DP` / `_DN`) suffixes on both halves of a differential pair:

```text
USB_DP, USB_DN
PCIE0_TX_P, PCIE0_TX_N
PCIE0_RX_P, PCIE0_RX_N
HDMI_D0_P, HDMI_D0_N
```

**Why:** matching suffixes let any reader pair the two halves by string manipulation alone. Mixing conventions within a single design (e.g., `USB_DP` / `USB_DM` alongside `PCIE_TX_P` / `PCIE_TX_N`) breaks that property and forces every downstream consumer to maintain a per-pair lookup. Pick one suffix style per design.

## Buses

Use a consistent bit suffix, either `[0]..[N]` or `_0.._N`, and number every bit:

```text
ADDR[0], ADDR[1], ... ADDR[15]
DATA_0, DATA_1, ... DATA_31
```

**Why:** width, bit ordering, and membership are all derivable from the name. Gapped or mixed numbering (`ADDR[0]`, `ADDR[1]`, `ADDR_HI`) hides the bus structure and makes it impossible to enumerate bits programmatically.

## DNS (Do Not Stuff) Markers

Components that should not be populated must be marked in a structured field so the BOM, assembly package, and any netlist reader know to skip them. Put the marker in the component's **MPN**, **value**, **description**, or **comment** field. Altium designs can also use the `Assembly Info` parameter.

**Do not rely on graphical text annotations** placed next to the component on the sheet. Free-floating text has no structured relationship to the part and is invisible to anything that reads the exported netlist; the component will be treated as populated.

Recognized acronyms (separated by underscore, comma, or space):

`DNS`, `DNP`, `DNF`, `DNI`, `DNM`, `NF`, `NC`

Examples: `10K,DNI` · `RES_10K_0402_DNP` · `DNS`

Recognized phrases:

- `DO NOT STUFF` / `POPULATE` / `INSTALL` / `FIT` / `MOUNT`
- `NOT POPULATED` / `FITTED` / `CONNECTED` / `MOUNTED`
- `NO POP`

## Quick Checklist

- [ ] Ground nets use `GND` / `AGND` / `DGND` / `PGND` / `SGND` / `CGND` / `VSS`
- [ ] Power rails use `PP*` / `PN*` / `LD_*` (the preferred convention). Only fall back to `+3V3` / `VCC*` / `VDD*` / `PWR_*` if the design already uses one of those styles throughout
- [ ] Logic signals do NOT start with `+`, `-`, `PP`, `PN`, `VCC`, `VDD`, `VIN`, or `VOUT`
- [ ] Differential pairs use matching `_P` / `_N` (or `_DP` / `_DN`) suffixes, consistently across the whole design
- [ ] Buses use a single bit-suffix style and number every bit
- [ ] DNS components carry a DNS acronym or phrase in their MPN, value, description, or comment field (never as free-floating schematic text)
