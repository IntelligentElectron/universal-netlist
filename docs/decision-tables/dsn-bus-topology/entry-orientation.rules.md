# entry-orientation

| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | start = scalar / both; end = bus | forward |  | 2 |
| 2 | start = bus / both; end = scalar | reverse |  | 2 |
| 3 | start = bus; end = both | reverse |  | 1 |
| 4 | start = scalar; end = both | forward |  | 1 |
| else | everything else | unresolved |  | |

16 cells became 4 rules plus a default
