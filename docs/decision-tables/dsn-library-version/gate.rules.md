| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | version = older | refused naming the version and asking to re-save |  | 2 |
| 2 | version = unknown / tested; rest_of_parse = throws | the parse error unchanged |  | 2 |
| 3 | version = untested; rest_of_parse = throws | the parse error naming the untested version |  | 1 |
| else | everything else | netlist |  | |

8 cells became 3 rules plus a default
equivalent values of version: unknown = tested
