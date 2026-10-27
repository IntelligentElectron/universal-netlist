| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | kind = unknown | usage: unknown flag |  | 18 |
| 2 | kind = array; form = eq_word / eq_number / eq_text / eq_empty / next_word / next_number / next_text | append text |  | 14 |
| 3 | kind = string; form = eq_word / eq_number / eq_text / eq_empty / next_word / next_number / next_text; occurrence = first | text |  | 7 |
| 4 | kind = number; form = eq_word / eq_text / eq_empty / next_word / next_text; occurrence = first | usage: takes a number |  | 5 |
| 5 | kind = boolean; form = next_number / next_text / next_dash / last; occurrence = first | true, next not consumed |  | 4 |
| 6 | kind = boolean; form = eq_number / eq_text / eq_empty; occurrence = first | usage: takes true or false |  | 3 |
| 7 | kind = string / number / array; form = last; occurrence = first | usage: needs a value |  | 3 |
| 8 | kind = string / number / array; form = next_dash; occurrence = first | usage: needs =value for a dash |  | 3 |
| 9 | kind = number; form = eq_number / next_number; occurrence = first | number |  | 2 |
| 10 | kind = array; form = last | usage: needs a value |  | 1 |
| 11 | kind = array; form = next_dash | usage: needs =value for a dash |  | 1 |
| 12 | kind = boolean; form = eq_word; occurrence = first | that boolean |  | 1 |
| 13 | kind = boolean; form = next_word; occurrence = first | that boolean, next consumed |  | 1 |
| else | everything else | usage: given twice |  | |

90 cells became 13 rules plus a default
equivalent values of form: eq_text = eq_empty
