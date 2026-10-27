| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | number = present; refdes = present; shares = none / same net | keyed by number |  | 8 |
| 2 | number = present; refdes = present; shares = earlier net | kept on its first net only |  | 4 |
| 3 | number = empty; name = present; refdes = present; shares = none / same net | keyed by name |  | 4 |
| 4 | name = present; refdes = present; shares = earlier net | kept on its first net only |  | 2 |
| else | everything else | dropped |  | |

48 cells became 4 rules plus a default
equivalent values of format: kicad = altium
equivalent values of shares: none = same net
