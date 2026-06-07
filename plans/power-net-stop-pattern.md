# Fix: Power net pattern to use substring matching

## Context

The xnet traversal correctly stops at power/ground nets during traversal (line 346 of circuit-traversal.ts). However, the `POWER_NET_PATTERN` regex uses anchored patterns (`^VDD\w*$`) that only match nets starting with VDD, VCC, VBUS, etc. Prefixed power nets like `CC1310_VDD`, `USB_VBUS`, `XDS_VCC` are not recognized as power nets, so the traversal walks right through them into signal nets, eventually visiting half the board.

## Root cause

`POWER_NET_PATTERN` and `STOP_NET_PATTERN` in `circuit-traversal.ts` use `^VDD\w*$` style patterns. A net like `CC1310_VDD` doesn't start with `VDD`, so it's not matched.

## Fix

Change the power keyword patterns (VCC, VDD, VIN, VOUT, VBAT, VBUS, VSYS) from anchored start-of-string (`^VDD\w*`) to substring/contains matching. If the net name contains `VDD` anywhere, it's a power net.

Keep the other patterns (PP\w*, RAIL_\w+, PWR_\w+, voltage patterns like `+5V`) as-is since they work correctly with anchored matching.

### File: `src/circuit-traversal.ts` (lines 11-15)

`POWER_NET_PATTERN` is defined at lines 12-13 and `STOP_NET_PATTERN` at
lines 14-15. Change `POWER_NET_PATTERN` from:
```
/^(VCC\w*|VDD\w*|VIN\w*|VOUT\w*|VBAT\w*|VBUS\w*|VSYS\w*|PWR_\w+|RAIL_\w+|PP\w*|PN\w*|LD_PP\w*|LD_PN\w*|[+-]?\d+V\d*\w*|[+-].+)$/i
```

To something like:
```
/VCC|VDD|VBAT|VBUS|VSYS|^(VIN\w*|VOUT\w*|PWR_\w+|RAIL_\w+|PP\w*|PN\w*|LD_PP\w*|LD_PN\w*|[+-]?\d+V\d*\w*|[+-].+)$/i
```

The keywords VCC, VDD, VBAT, VBUS, VSYS become unanchored substring matches. VIN/VOUT stay anchored to avoid false positives (e.g. a signal containing "VIN" as part of another word is less likely but worth being cautious). Same split for STOP_NET_PATTERN.

Note: `GROUND_NET_PATTERN` stays as-is (exact match for GND, VSS, etc.).

### File: `src/circuit-traversal.test.ts`

Add tests for:
- `isPowerNet('CC1310_VDD')` returns true
- `isPowerNet('USB_VBUS')` returns true
- `isPowerNet('XDS_VCC')` returns true
- `isPowerNet('AVDD')` returns true
- `isStopNet('CC1310_VDD')` returns true
- Signal nets like `CC1310_TXD`, `USB_DP`, `DIO4_SCL` are NOT matched

### File: `src/descriptions.ts` (lines 103, 107)

Update the `QUERY_XNET_BY_NET_NAME_DESCRIPTION` (line 103) and
`QUERY_XNET_BY_PIN_NAME_DESCRIPTION` (line 107) constants to mention that
traversal stops at power nets too, not just ground. (Tool descriptions were
moved out of `src/server.ts` into `src/descriptions.ts` in v0.1.0.)

## Verification

1. `npm run type-check && npm run lint && npm test`
2. MCP testing on LAUNCHXL-CC1310:
   - `query_xnet_by_net_name VDDS`: should now return a contained result (U1 power pins, decoupling caps, FL1 ferrite bead, and stop at CC1310_VDD)
   - `query_xnet_by_net_name CC1310_VDD`: should show components on that rail (pull-ups, decoupling cap, ICs) but NOT traverse into JTAG/debug subsystem
   - `query_xnet_by_net_name CC1310_TXD`: should still work normally (signal net)
   - `query_xnet_by_net_name GND`: should still be rejected
