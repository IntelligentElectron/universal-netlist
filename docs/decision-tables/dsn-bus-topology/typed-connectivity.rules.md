# typed-connectivity

| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | pin = bus; wire = legacy / scalar | unconnected |  | 2 |
| 2 | pin = legacy / scalar; wire = bus | unconnected |  | 2 |
| else | everything else | connected |  | |

9 cells became 2 rules plus a default
equivalent values of pin: legacy = scalar
equivalent values of wire: legacy = scalar
