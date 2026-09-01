# Universal Netlist fixtures

Hand-written Universal Netlist JSON files for the `universal` format handler (`src/parsers/universal/`). They are in this repository, not in the `test/fixtures` submodule, so the handler's tests run on any checkout.

| File | What it is |
| --- | --- |
| `demo-board.netlist.json` | A valid native-origin, hashed, UTC-dated netlist: named and unnamed pin entries, a member with several pins, a do-not-stuff part (`dns: true`), a test point, an unconnected pin (`""`), a single-pin net, and an auto-named multi-pin net. `run_erc` fires every rule it has on it. |
| `broken/pin-on-other-net.netlist.json` | Has the schema marker but its two indices disagree: net `VCC` lists `C1.1` and `C1` says pin 1 is on `GND`. Discovery lists it with an error; loading it fails naming that pin. |
| `unsigned.netlist.json` | Uses the canonical suffix but lacks `universalNetlistSchemaVersion`. Discovery lists it with an error and loading refuses it. |
| `not-a-netlist.json` | Ordinary JSON. Discovery ignores it and direct design tools reject its unsupported suffix without opening it as a Universal Netlist. |
| `malformed.netlist.json` | Uses the canonical suffix but is not valid JSON. Discovery lists it with an error and loading reports the syntax failure. |

The `.netlist.json` golden files under `test/golden/` are versioned Universal Netlists too (one per EDA fixture design), and the handler's tests load every one of them.
