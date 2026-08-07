# References

Third-party source vendored into this repository for reference only. Nothing here is
compiled, linked, executed, or shipped: `tsconfig.json`, `eslint.config.js` and
`vitest.config.ts` all scope to `src/`, and the published npm package excludes this
directory.

## OpenOrCadParser

`OpenOrCadParser/` is an unmodified copy of Dominik Wernberger's C++ OrCAD parser.

| | |
|---|---|
| Upstream | https://github.com/Werni2A/OpenOrCadParser |
| Commit | `be0a83ac119390044952cf9bed1e0fb86c448f44` |
| Commit date | 2024-07-21 |
| Licence | MIT — see [`OpenOrCadParser/LICENSE`](OpenOrCadParser/LICENSE) |
| Copyright | © 2021 Dominik Wernberger |
| Upstream status | **Archived by its owner.** Read-only; will receive no further commits |

### Why it is vendored rather than fetched

Our `.DSN` reader in `src/parsers/cadence/dsn/` is a TypeScript port of this C++, and
`CLAUDE.md` makes reading the corresponding C++ file mandatory before changing any parser
file. A reference that carries that much weight should not be able to disappear or drift.

It was previously a gitignored local clone, which meant it existed only on machines that
had happened to clone it: CI never had it, and neither did any sandboxed reviewer, so
nobody could check a claim about the C++ against the C++ itself. Vendoring removes the
fetch entirely.

The pin is the safest possible one. `be0a83a` is not merely the commit we chose, it is
upstream's final commit — the repository was archived at it, so the vendored tree and
upstream `main` are the same tree and cannot diverge.

### Licence compatibility

MIT is a permissive licence, and this repository is Apache-2.0. Redistributing an MIT
work inside an Apache-2.0 project is permitted; the requirement is that the copyright
notice and licence text travel with the copy, which is why `OpenOrCadParser/LICENSE` is
kept intact and unmodified in place.

The vendored subtree stays MIT. It is not relicensed by its inclusion here, and the root
`NOTICE` records the attribution alongside the project's own.

### Local modifications

None. All 258 files match upstream's blob hashes exactly. Keeping it that way is
deliberate: a reference is only useful as ground truth if it is what upstream actually
says. Anything we learn that upstream does not state belongs in `docs/dsn-format.md`,
which is where our own findings — including the places our port intentionally diverges,
such as the `pin_map` null-placeholder in §9.2 — are written down.

Two `.gitkeep` placeholders had to be force-added, because upstream's own `.gitignore`
excludes the directories holding them while upstream tracks the files anyway. They are
committed now and the tree is archived, so this does not recur.

To verify the copy against upstream:

```bash
git clone --depth 1 https://github.com/Werni2A/OpenOrCadParser /tmp/oocp-verify
diff -r --exclude=.git references/OpenOrCadParser /tmp/oocp-verify
```
