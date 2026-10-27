| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | named = writable | named dir |  | 24 |
| 2 | named = unset; xdg = writable | xdg dir |  | 6 |
| 3 | named = unset; xdg = unset / relative / unwritable; home = writable | home dir |  | 6 |
| 4 | named = unset; xdg = unset / relative / unwritable; home = none / unwritable; tmp = writable | tmp dir |  | 6 |
| else | everything else | no disk cache |  | |

72 cells became 4 rules plus a default
equivalent values of xdg: unset = relative = unwritable
equivalent values of home: none = unwritable
