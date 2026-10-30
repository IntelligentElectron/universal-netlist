| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | signal_env = empty; general_env = set | general env |  | 2 |
| 2 | signal_env = empty; general_env = empty; build_default = empty | sdk default |  | 1 |
| 3 | signal_env = empty; general_env = empty; build_default = set | build default |  | 1 |
| else | everything else | signal env |  | |
