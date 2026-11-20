# terminal-preservation

| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | id = normal; geometry = none | native |  | 2 |
| 2 | id = zero / sentinel; geometry = none; count = one | NC |  | 2 |
| 3 | id = sentinel; geometry = none; count = two | overlap |  | 1 |
| 4 | id = zero; geometry = none | NC |  | 1 |
| else | everything else | wire |  | |

12 cells became 4 rules plus a default
