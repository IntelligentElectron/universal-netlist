| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | push_pull = none; rail = power / power_out; other = none / other | clean |  | 8 |
| 2 | push_pull = none; rail = none; other = open / bus / other | clean |  | 6 |
| 3 | push_pull = none; rail = power / power_out; other = bus | contention warning |  | 4 |
| 4 | push_pull = one; rail = none; other = none / other | clean |  | 4 |
| 5 | push_pull = none; rail = power; other = open | contention warning |  | 2 |
| 6 | push_pull = one; rail = none; other = bus | contention warning |  | 2 |
| 7 | push_pull = none; rail = none; sinks = none | clean |  | 1 |
| 8 | push_pull = none; rail = none; other = none; sinks = some | undriven error |  | 1 |
| else | everything else | conflict error |  | |

96 cells became 8 rules plus a default
