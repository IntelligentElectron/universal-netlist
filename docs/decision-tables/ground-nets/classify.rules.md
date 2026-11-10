| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | role = start; name = power / signal | traced |  | 12 |
| 2 | role = start; name = ground | refused as a ground |  | 6 |
| 3 | role = start; name = separated_ground | traced, with a ground-name note |  | 6 |
| 4 | role = reached; name = separated_ground / signal; pin = none; size = small | trace continues |  | 2 |
| else | everything else | trace stops here |  | |

48 cells became 4 rules plus a default
equivalent values of pin: ground_pin = supply_pin
