| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | input = plain / padded; ws_matches = 1 / many; trunc_matches = 1 / many | ambiguous: whitespace or truncated |  | 8 |
| 2 | input = blank | missing |  | 6 |
| 3 | input = plain / padded; ws_matches = 1; trunc_matches = 0 | match by whitespace |  | 4 |
| 4 | input = plain / padded; ws_matches = many; trunc_matches = 0 | ambiguous: whitespace |  | 4 |
| 5 | input = plain / padded; ws_matches = 0; trunc_matches = 0 | missing |  | 4 |
| 6 | input = plain / padded; ws_matches = 0; trunc_matches = 1 | match by 31-char cut |  | 2 |
| 7 | input = plain / padded; ws_matches = 0; trunc_matches = many | ambiguous: truncated |  | 2 |
| else | everything else | exact |  | |

72 cells became 7 rules plus a default
equivalent values of input: plain = padded
equivalent values of format: cadence = other
