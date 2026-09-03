# Universal Netlist Schema Changelog

Every change to the on-disk `*.netlist.json` schema, newest first. This page
tracks the **schema** only: the shape of the document, its fields, and what they
mean. Parser and server behaviour that does not change the document is out of
scope.

The current version is **2**. Readers for every earlier version stay registered,
so a file written by any released build remains loadable.

| Version | Date | Status |
|---|---|---|
| [2](#version-2) | 2026-09-02 | Current |
| [1](#version-1) | 2026-09-01 | Supported |
| [Pre-schema](#pre-schema) | 2026-03-10 | Not loadable |

---

## Version 2

**2026-09-02**

Splits the component part number into two named namespaces and adds the
manufacturer name.

| Field | Change |
|---|---|
| `mpn` | Narrowed. Now the manufacturer's part number and nothing else. Never a library symbol, footprint or package name. |
| `internal_pn` | Added. The part number the design owner identifies the part by. |
| `manufacturer` | Added. The manufacturer's name. |

Version 1's `mpn` held whichever part number a parser found first, so a consumer
could not tell which namespace it had been handed. The three fields are
independent: none falls back to another, and each is omitted when the design
records it nowhere.

`manufacturer` is part of the same change because an MPN identifies a part only
within a manufacturer. Without the name, `mpn` is a string rather than a key.

**Compatibility.** A version 1 document cannot carry the new fields. That
reader drops component fields its schema does not define and then verifies
`netlistHash` against what remains, so a version 1 file carrying `internal_pn`
is refused by every build. Version 1 files stay readable, and a version 1
fixture is kept to prove it.

## Version 1

**2026-09-01**

First versioned and validated schema. Introduces the four top-level keys and
makes a `.netlist.json` self-describing, so a reader can tell a Universal
Netlist from an arbitrary JSON file that happens to contain `nets`.

| Field | Change |
|---|---|
| `universalNetlistSchemaVersion` | Added. Identifies the document and selects its reader. |
| `metadata.generatedAt` | Added. UTC timestamp of generation. |
| `metadata.netlistHash` | Added. `sha256:` over canonicalized `nets` and `components` together, verified on load. |
| `metadata.origin` | Added. `native`, or `vendor` with the source design it was converted from. |
| `nets` | Defined. `{netName: {refdes: pin(s)}}`. |
| `components` | Defined. `{refdes: {mpn, description, comment, value, dns, pins}}`. |

Load-time validation begins here: the hash must match, `nets` and `components`
must be exact inverses of one another, and every refdes and pin must resolve.

## Pre-schema

**2026-03-10**

`.netlist.json` files existed before this schema did. They were written as
golden test output, and from 2026-08-23 they could also be read back as a design
input. They carried `nets` and `components` only, with no version field, no
metadata and no hash.

These files are **not** loadable by any current build. A document with no
`universalNetlistSchemaVersion`, or with a version no registered codec claims,
is refused, and the error lists the versions the build supports. Regenerate them
with `export-json`.

---

## Adding a version

See [Schema evolution](universal-netlist.md#schema-evolution) in the schema
definition for the rules a new version has to follow. In short: add the codec,
keep every older reader registered, advance
`UNIVERSAL_NETLIST_SCHEMA_VERSION` only once the codec exists, keep a fixture
for every supported version, and add an entry here.
