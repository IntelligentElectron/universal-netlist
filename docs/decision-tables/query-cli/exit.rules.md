| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | help = absent; args = usage_error / schema_refuses | usage on stderr, exit 2 |  | 12 |
| 2 | help = absent; args = valid; result = error_field / throws; stdout = pipe | compact JSON on stdout, exit 1 |  | 2 |
| 3 | help = absent; args = valid; result = error_field / throws; stdout = tty | indented JSON on stdout, exit 1 |  | 2 |
| 4 | help = absent; args = valid; result = ok; stdout = pipe | compact JSON on stdout, exit 0 |  | 1 |
| 5 | help = absent; args = valid; result = ok; stdout = tty | indented JSON on stdout, exit 0 |  | 1 |
| else | everything else | tool help on stdout, exit 0 |  | |

36 cells became 5 rules plus a default
equivalent values of args: usage_error = schema_refuses
equivalent values of result: error_field = throws
