# Cadence exporter (internal reference)

> **Dormant in MCP.** This tool is not registered or callable by MCP clients. Its implementation is retained for CLI coverage and regression tests. The reference below describes that retained implementation; query Cadence designs through their `.DSN` schematics.

Export Cadence schematic netlist to Allegro PCB format.

## Description

The retained `exportCadenceNetlist` function generates Allegro-compatible netlist files from Cadence schematics using the `pstswp` utility. CLI coverage uses it on Windows when reference exports are missing. It is not an MCP tool.

**Platform Requirement**: Windows only. Requires Cadence SPB installation.

## Internal function argument

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dsnPath` | string | Yes | Path to `.DSN` schematic file |

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
      "description": "Absolute path of the directory the netlist was written to"
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

## Internal API example

The CLI and regression tests call the retained service function directly:

```typescript
import { exportCadenceNetlist } from "./src/service/index.js";

const result = await exportCadenceNetlist("Schematics/MyBoard.DSN");
```

Response (success):
```json
{
  "success": true,
  "outputDir": "C:/repo/Schematics/MyBoard_netlist",
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

**Error (export produced an incomplete netlist):**
```json
{
  "error": "Cadence pstswp reported success but did not write pstxprt.dat to C:/repo/Schematics/MyBoard_netlist. Check the log for the directory it actually used."
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
- After a successful export, the netlist sits beside the design. `list_designs` keeps reporting the `.DSN`, which is what to query
