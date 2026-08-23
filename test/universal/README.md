# Universal Netlist fixtures

Hand-written Universal Netlist JSON files for the `universal` format handler (`src/parsers/universal/`). They are in this repository, not in the `test/fixtures` submodule, so the handler's tests run on any checkout.

| File | What it is |
| --- | --- |
| `demo-board.netlist.json` | A valid netlist: named and unnamed pin entries, a member with several pins, a do-not-stuff part (`dns: true`), a test point, an unconnected pin (`""`), a single-pin net, and an auto-named multi-pin net. `run_erc` fires every rule it has on it. |
| `broken/pin-on-other-net.json` | Has the Universal Netlist shape but its two indices disagree: net `VCC` lists `C1.1` and `C1` says pin 1 is on `GND`. Discovery lists it with an error; loading it fails naming that pin. |
| `not-a-netlist.json` | Valid JSON that is not a netlist. Discovery skips it; loading it fails saying so. |
| `malformed.json` | Not valid JSON. Discovery skips it; loading it fails with the parser's message. |

The golden files under `test/golden/` are Universal Netlists too (one per EDA fixture design), and the handler's tests load every one of them.
