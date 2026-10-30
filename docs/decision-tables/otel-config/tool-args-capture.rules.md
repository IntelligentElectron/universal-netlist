| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | content = EVENT_ONLY | log |  | 2 |
| 2 | content = SPAN_AND_EVENT | span and log |  | 2 |
| 3 | content = SPAN_ONLY | span |  | 2 |
| 4 | content = unset; own_switch = on | span and log |  | 1 |
| else | everything else | none |  | |
