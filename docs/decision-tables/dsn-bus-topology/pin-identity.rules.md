# pin-identity

| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | label = missing / blank / duplicate / reserved; ignored = no | source |  | 8 |
| 2 | kind = bus; ignored = no | source |  | 1 |
| 3 | kind = scalar; label = unique; ignored = no | physical |  | 1 |
| else | everything else | omit |  | |

20 cells became 3 rules plus a default
equivalent values of label: missing = blank = duplicate = reserved
