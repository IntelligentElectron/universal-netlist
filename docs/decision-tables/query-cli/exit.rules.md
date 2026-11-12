| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | help = absent; args = usage_error / schema_refuses | usage on stderr, exit 2 |  | 16 |
| 2 | help = absent; args = valid; result = ok / error_beside_data; stdout = pipe | compact JSON on stdout, exit 0 |  | 2 |
| 3 | help = absent; args = valid; result = ok / error_beside_data; stdout = tty | indented JSON on stdout, exit 0 |  | 2 |
| 4 | help = absent; args = valid; result = error_field / throws; stdout = pipe | compact JSON on stdout, exit 1 |  | 2 |
| 5 | help = absent; args = valid; result = error_field / throws; stdout = tty | indented JSON on stdout, exit 1 |  | 2 |
| else | everything else | tool help on stdout, exit 0 |  | |

48 cells became 5 rules plus a default
equivalent values of args: usage_error = schema_refuses
equivalent values of result: ok = error_beside_data
equivalent values of result: error_field = throws
