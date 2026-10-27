| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | number = present; refdes = present; shares = none / same net | keyed by number |  | 8 |
| 2 | number = empty; name = present; refdes = present; shares = none / same net | keyed by name |  | 4 |
| 3 | format = kicad; number = present; refdes = present; shares = earlier net / earlier lone net | listed on every net |  | 4 |
| 4 | name = present; refdes = present; shares = earlier lone net | kept on this net only |  | 3 |
| 5 | name = present; refdes = present; shares = earlier net | kept on its first net only |  | 3 |
| 6 | format = altium; number = present; refdes = present; shares = earlier lone net | kept on this net only |  | 1 |
| 7 | format = altium; number = present; refdes = present; shares = earlier net | kept on its first net only |  | 1 |
| else | everything else | dropped |  | |

64 cells became 7 rules plus a default
equivalent values of shares: none = same net
