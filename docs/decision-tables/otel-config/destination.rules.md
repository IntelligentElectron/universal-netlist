| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | sdk_disabled = unset / other; selector = otlp | otlp |  | 12 |
| 2 | sdk_disabled = unset / other; selector = unset / unsupported; directory = set | file |  | 12 |
| 3 | sdk_disabled = unset / other; endpoint = env / build_default; selector = unset / unsupported; directory = unset | otlp |  | 8 |
| else | everything else | off |  | |
