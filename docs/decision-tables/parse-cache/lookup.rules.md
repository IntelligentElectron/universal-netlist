WARNING: 12 cells are undecided; these rules are provisional

| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | entry = none / foreign / corrupt; parse = fails | error, nothing stored |  | 12 |
| 2 | entry = none / foreign / corrupt; design = plain; parse = reads_files | parse, store |  | 6 |
| 3 | entry = current; files = unchanged | answer from cache |  | 2 |
| 4 | files = changed; parse = fails | error, nothing stored |  | 1 |
| 5 | files = changed; design = plain; parse = reads_files | parse, store |  | 1 |
| else | everything else | parse, nothing stored |  | |

48 cells became 5 rules plus a default
equivalent values of entry: none = foreign = corrupt
