| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | net_at_point = no; net_on_a_wire = yes | the net a wire with its net id carries |  | 2 |
| 2 | wire_id = sentinel; net_at_point = no; net_on_a_wire = no | a pin-to-pin net named from the Hierarchy |  | 1 |
| 3 | wire_id = zero; net_id = nonzero; net_at_point = no; net_on_a_wire = no | its own net shared with pins of the same net id |  | 1 |
| 4 | net_id = zero; net_at_point = no | no connect |  | 1 |
| else | everything else | the net at its point |  | |

24 cells became 4 rules plus a default
equivalent values of wire_id: wire = zero
