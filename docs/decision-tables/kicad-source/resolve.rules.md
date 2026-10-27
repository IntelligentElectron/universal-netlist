| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | saved_net = absent; root_sch = absent | error: no netlist |  | 6 |
| 2 | saved_net = absent; root_sch = present; raw = works | raw reader |  | 3 |
| 3 | saved_net = absent; root_sch = present; raw = fails; kicad_cli = fails | error: raw and kicad-cli |  | 1 |
| 4 | saved_net = absent; root_sch = present; raw = fails; kicad_cli = off | error: raw, kicad-cli off |  | 1 |
| 5 | saved_net = absent; root_sch = present; raw = fails; kicad_cli = works | kicad-cli export |  | 1 |
| else | everything else | saved .net |  | |

24 cells became 5 rules plus a default
