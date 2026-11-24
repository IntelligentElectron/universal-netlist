| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | prior_net = none | assign the pin to the incoming net |  | 3 |
| 2 | prior_net = NET_A; new_net = NET_A | keep the existing assignment |  | 1 |
| 3 | prior_net = NC; new_net = NC | keep the existing assignment |  | 1 |
| else | everything else | reject the conflicting assignment |  | |

9 cells became 3 rules plus a default
NET_A is the net of the pin's first assignment; NET_B is a different net; NC is the unconnected net.
