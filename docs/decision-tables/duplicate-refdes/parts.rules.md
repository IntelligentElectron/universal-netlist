| # | When | Outcome | Next | Cells |
|---|---|---|---|---|
| 1 | package = same; part_number = same / one_missing; section = repeat; wiring = agree / nc_vs_net | one part, refdes.section_repeated |  | 4 |
| 2 | package = same; part_number = same / one_missing; section = new | one part |  | 2 |
| else | everything else | separate parts, refdes.duplicate |  | |

36 cells became 2 rules plus a default
equivalent values of part_number: same = one_missing
equivalent values of wiring: agree = nc_vs_net
