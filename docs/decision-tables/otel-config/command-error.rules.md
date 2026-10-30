| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | exit_code = 2 | invalid_argument |  | 3 |
| 2 | exit_code = 1; failure = none / unclassifiable | internal |  | 2 |
| 3 | exit_code = 1; failure = classifiable | classified |  | 1 |
| else | everything else | none |  | |
