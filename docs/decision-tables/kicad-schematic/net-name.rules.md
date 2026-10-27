| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | a = sheet_bus / label; b = power_or_global / hier_bus | b names the net |  | 48 |
| 2 | b = power_or_global / hier_bus; priority = b_higher | b names the net |  | 18 |
| 3 | a = label; b = sheet_bus | b names the net |  | 18 |
| 4 | a = label; priority = b_higher | b names the net |  | 6 |
| 5 | a = sheet_bus; b = sheet_bus; priority = b_higher | b names the net |  | 6 |
| 6 | b = power_or_global / hier_bus; priority = equal; depth = b_shallower | b names the net |  | 4 |
| 7 | a = power_or_global / label; priority = equal; depth = equal / b_shallower; name = b_lower | b names the net |  | 3 |
| 8 | a = sheet_bus; b = sheet_bus; priority = equal; depth = b_shallower | b names the net |  | 2 |
| 9 | a = label; priority = equal; depth = b_shallower | b names the net |  | 1 |
| 10 | b = hier_bus; priority = equal; depth = equal; name = b_lower | b names the net |  | 1 |
| 11 | a = sheet_bus; b = sheet_bus; priority = equal; depth = equal; name = b_lower | b names the net |  | 1 |
| else | everything else | a names the net |  | |

288 cells became 11 rules plus a default
equivalent values of a: power_or_global = hier_bus
equivalent values of b: power_or_global = hier_bus
