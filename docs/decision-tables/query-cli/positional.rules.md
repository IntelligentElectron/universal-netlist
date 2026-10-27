| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | position = later; tool_design = takes_design | usage: unexpected argument |  | 2 |
| 2 | position = first; design_flag = present | usage: design given twice |  | 1 |
| 3 | position = first; tool_design = takes_design; design_flag = absent | design |  | 1 |
| else | everything else | usage: takes only flags |  | |

8 cells became 3 rules plus a default
