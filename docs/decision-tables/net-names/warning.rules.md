| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | whitespace = edge_space / edge_other; collides = yes; format = kicad / other | collision warning, no netlist name |  | 4 |
| 2 | whitespace = edge_space / edge_other / before_block_suffix; collides = yes; format = cadence | collision warning, no netlist name, ORCAP-36005 note |  | 3 |
| 3 | whitespace = none; collides = no | no warning |  | 3 |
| 4 | whitespace = only; collides = no | whitespace-only warning |  | 3 |
| 5 | whitespace = only; collides = yes | whitespace-only warning listing the others |  | 3 |
| 6 | whitespace = none; collides = yes; format = kicad / other | partner warning, no netlist name |  | 2 |
| 7 | whitespace = before_block_suffix; collides = no | block warning, no netlist name |  | 1 |
| 8 | whitespace = none; collides = yes; format = cadence | partner warning, no netlist name, ORCAP-36005 note |  | 1 |
| 9 | whitespace = edge_other; collides = no; format = cadence | unverified-trim warning, no netlist name |  | 1 |
| 10 | whitespace = edge_space; collides = no; format = cadence | netlist name = trimmed |  | 1 |
| else | everything else | fix-the-label warning, no netlist name |  | |

30 cells became 10 rules plus a default
equivalent values of format: kicad = other
