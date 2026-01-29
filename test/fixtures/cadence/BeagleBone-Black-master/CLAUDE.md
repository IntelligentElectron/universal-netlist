# CLAUDE.md

Design instructions for AI-assisted circuit review of the BeagleBone Black.

## Design Overview

**Design Name**: BeagleBone Black
**Revision**: C (Production)
**Designer**: BeagleBoard.org
**EDA Tool**: Cadence OrCAD (Schematic) + Allegro (PCB)

The BeagleBone Black is a low-cost, community-supported single-board computer based on the Texas Instruments AM335x Sitara ARM Cortex-A8 processor.

## File Structure

```
├── BEAGLEBONEBLK_C.DSN      # OrCAD schematic design file
├── allegro/                  # Allegro PCB netlist exports
│   ├── pstxnet.dat          # Net connectivity data
│   ├── pstxprt.dat          # Part/component data
│   └── pstchip.dat          # Pin/package data
├── BBB_PCB/                  # PCB layout files
│   └── BeagleBone_Black_RevB6_nologo.brd
├── BBB_SCH.pdf              # Schematic PDF
├── BBB_SRM.pdf              # System Reference Manual
└── BBB_BOM.xls              # Bill of Materials
```

## Netlist Queries

Use the netlist MCP server to query this design. The design path is:

```
/Users/valentino/Developer/westworld/reference-designs/BeagleBone-Black-master/BEAGLEBONEBLK_C.DSN
```

### Example Queries

```python
# List all ICs
list_components(design="<path>/BEAGLEBONEBLK_C.DSN", type="U")

# Search for power nets
search_nets(design="<path>/BEAGLEBONEBLK_C.DSN", pattern="VDD|SYS_5V")

# Trace a signal from a pin
query_xnet_by_pin_name(design="<path>/BEAGLEBONEBLK_C.DSN", pin_name="U5.A1")

# Query component details
query_component(design="<path>/BEAGLEBONEBLK_C.DSN", refdes="U5")
```

## Key Components

| Refdes | Function |
|--------|----------|
| U5 | AM335x Sitara Processor (ARM Cortex-A8) |
| U12 | DDR3L SDRAM (512MB) |
| U13 | eMMC Flash (4GB) |
| U4 | TPS65217C PMIC (Power Management IC) |
| U16 | TL5209 LDO (3.3V) |
| U8 | TPD12S016 HDMI Companion Chip |

## Power Rails

| Net Name | Voltage | Description |
|----------|---------|-------------|
| SYS_5V | 5.0V | System input power |
| VDD_5V | 5.0V | Regulated 5V rail |
| VDD_3V3A | 3.3V | Main 3.3V analog rail |
| VDD_3V3B | 3.3V | Main 3.3V digital rail |
| VDD_1V8 | 1.8V | I/O voltage rail |
| VDD_CORE | 1.1V | Processor core voltage |
| VDD_MPU | 1.1V | MPU domain voltage |
| VDDS_DDR | 1.5V | DDR3L memory voltage |

## Interfaces

- **HDMI**: Mini HDMI Type-C connector via TPD12S016
- **USB**: USB 2.0 Host (Type-A), USB 2.0 Client (Mini-B)
- **Ethernet**: 10/100 via LAN8710A PHY
- **microSD**: Card slot for external storage
- **Expansion Headers**: P8, P9 (2x46 pin headers with GPIO, ADC, PWM, I2C, SPI, UART)

## Review Notes

When reviewing this design, pay attention to:

1. **Power sequencing**: The TPS65217C PMIC handles complex sequencing for the AM335x
2. **DDR3L routing**: High-speed memory interface requires careful impedance matching
3. **HDMI ESD protection**: TPD12S016 provides ESD clamping on HDMI signals
4. **Thermal considerations**: AM335x can generate significant heat under load
