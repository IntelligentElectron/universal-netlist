| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | named = no; connection = connected | Net-(U1-Pad3) |  | 2 |
| 2 | named = no; connection = unconnected | unconnected-(U1-Pad3) |  | 2 |
| 3 | named = yes; units = multi; connection = unconnected | unconnected-(U1A-SDA-Pad3) |  | 2 |
| 4 | named = yes; units = multi; connection = connected; shares_name = no | Net-(U1A-SDA) |  | 1 |
| 5 | units = multi; connection = connected; shares_name = yes | Net-(U1A-SDA-Pad3) |  | 1 |
| 6 | named = yes; units = single; connection = connected; shares_name = no | Net-(U1-SDA) |  | 1 |
| 7 | units = single; connection = connected; shares_name = yes | Net-(U1-SDA-Pad3) |  | 1 |
| else | everything else | unconnected-(U1-SDA-Pad3) |  | |

16 cells became 7 rules plus a default
