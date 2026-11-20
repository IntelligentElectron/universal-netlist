# DSN bus topology

These seven exhaustive tables specify 79 cases. Source conservation and the
binary scalar/bus distinction determine their outcomes; no connector lane order
or unknown physical pad is inferred. The CSV rows cite the responsible code.
`src/parsers/cadence/dsn/bus-topology.table.test.ts` replays every row.

| Contract | Golden table | Minimized rules |
|---|---|---|
| Source-terminal identity and Pin Ignore | [20 cases](pin-identity.csv) | [Rules](pin-identity.rules.md) |
| Scalar/bus graph separation, including legacy in-memory scalar records | [9 cases](typed-connectivity.csv) | [Rules](typed-connectivity.rules.md) |
| Unique scalar-to-bus entry orientation | [16 cases](entry-orientation.csv) | [Rules](entry-orientation.rules.md) |
| Geometry touching one group or unrelated crossing groups | [8 cases](entry-contact.csv) | [Rules](entry-contact.rules.md) |
| Every non-ignored terminal receives a connectivity result | [12 cases](terminal-preservation.csv) | [Rules](terminal-preservation.rules.md) |
| Repeated-section conflict and inverse-map preservation | [6 cases](repeated-section.csv) | [Rules](repeated-section.rules.md) |
| Schema 4 topology and historical reader boundaries | [8 cases](schema-topology.csv) | [Rules](schema-topology.rules.md) |

The original synthetic reproduction has two bus terminals with physical label
`OUT4`, on `ETH_A` and `ETH_B`. The old scalar dictionary keeps only the second
terminal (`OUT4: {name: "ETH2", net: "ETH_B"}`). The `pin-identity` cell
`kind=bus,label=duplicate,ignored=no` requires separate source identities. The
framed binary regression now keeps both terminals and their original labels,
and round trips them through schema 4. Its USB lanes remain separate even where
scalar and bus geometry share coordinates.

Additional regressions cover native NetBus membership without drawn wires,
repeated hierarchy placements with local or parent-bound scalar lanes, malformed
topology and hash tampering, bus traversal rejection, and pagination beyond the
last terminal. The existing `duplicate-refdes/parts` table remains unchanged
(36 cells); this extension applies its conflict rule to the bus inverse graph.
