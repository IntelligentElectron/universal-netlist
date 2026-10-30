| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | failure = is_error / thrown; cause = classifiable | tool_error, classified |  | 2 |
| 2 | failure = is_error / thrown; cause = unclassifiable | tool_error, internal |  | 2 |
| 3 | failure = payload; cause = classifiable | classified, classified |  | 1 |
| 4 | failure = payload; cause = unclassifiable | internal, internal |  | 1 |
| else | everything else | none |  | |
