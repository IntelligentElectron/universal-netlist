# export_cadence_netlist

Export Cadence schematic netlist to Allegro PCB format.

## Description

Generates Allegro-compatible netlist files from Cadence schematics using the `pstswp` utility. This tool automates the netlist export process that would normally be done manually in Cadence Design Entry.

**Platform Requirement**: Windows only. Requires Cadence SPB installation.

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `design` | string | Yes | Path to `.DSN` schematic file |

## Response Schema

### Success Response

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "success": {
      "const": true
    },
    "outputDir": {
      "type": "string",
      "description": "Directory where output files were written (relative to CWD; absolute if on a different Windows drive)"
    },
    "log": {
      "type": "string",
      "description": "Combined stdout/stderr from pstswp"
    },
    "cadenceVersion": {
      "type": "string",
      "description": "Cadence version used (e.g., '17.4')"
    },
    "generatedFiles": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of files created in outputDir"
    }
  },
  "required": ["success", "outputDir"]
}
```

### Error Response

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "error": {
      "type": "string",
      "description": "Error message describing what went wrong"
    }
  },
  "required": ["error"]
}
```

## Example

**Exporting netlist from a Cadence schematic:**

Call:
```json
{
  "tool": "export_cadence_netlist",
  "arguments": {
    "design": "Schematics/MyBoard.DSN"
  }
}
```

Response (success):
```json
{
  "success": true,
  "outputDir": "Schematics/Board_netlist",
  "cadenceVersion": "17.4",
  "generatedFiles": [
    "pstchip.dat",
    "pstxnet.dat",
    "pstxprt.dat"
  ]
}
```

**Error (non-Windows platform):**
```json
{
  "error": "Cadence export tools are only available on Windows. The pstswp utility requires a Windows environment with Cadence SPB installed. Manual export: Open Cadence, then: Tools → Create Netlist → PCB Editor format."
}
```

**Error (export produced no netlist):**
```json
{
  "error": "Cadence pstswp reported success but wrote no netlist to C:/repo/Schematics/Board_netlist. Check the log for the directory it actually used."
}
```

**Error (missing Cadence installation):**
```json
{
  "error": "No Cadence SPB installation found in C:/Cadence. Ensure Cadence Design Entry CIS or HDL is installed. Manual export: Open Cadence, then: Tools → Create Netlist → PCB Editor format."
}
```

## Notes

- Cadence SPB is auto-detected from `C:/Cadence` (e.g., `C:/Cadence/SPB_17.4`)
- When multiple versions are installed, the latest version is used
- Output files are written to a `<design>_netlist/` subdirectory next to the schematic, one per design, so several designs in the same folder each keep their own netlist
- A folder holding a single design that already has an `allegro` directory (any case) keeps using it, since that layout is often what a PCB editor or build script reads
- Both `.DSN` and `.cpm` designs count towards "a single design", because Design Entry HDL writes the same three filenames
- The export reports an error rather than success when pstswp leaves no `pstxnet.dat` behind
- The export uses pstswp flags: `-pst -v 3 -l 255 -j "PCB Footprint"`
- Timeout is set to 2 minutes for large designs
- Concurrent calls are queued and run one at a time to avoid Cadence license conflicts
- `.DSNlck` lock files are automatically relocated during export and restored afterward
- After a successful export, re-run `list_designs` to get the updated `pstxnet.dat` path
