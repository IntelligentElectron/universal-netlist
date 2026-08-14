# Universal Netlist MCP Server

## Overview

MCP server for querying EDA netlists and tracing circuit connectivity. Supports Cadence (CIS, HDL), Altium Designer, and KiCad formats.

## Development

### Setup

```bash
bun install         # Prefer bun over npm
npm run setup       # Initialize test fixture submodules
npm run dev
```

**Note:** Test fixtures are git submodules. Run `npm run setup` after clone.

### Dependencies

Both lockfiles are committed: `bun.lock` is the tree the release build installs,
`package-lock.json` the tree CI and the npm publish job install. A dependency change
regenerates both in the same commit:

```bash
bun install                      # updates bun.lock
npm install --package-lock-only  # updates package-lock.json
```

CI installs with `npm ci` and the release workflow with `bun install --frozen-lockfile`,
so a lockfile that disagrees with `package.json` fails the run instead of quietly
re-resolving the `^` ranges into a tree the tests never saw.

### Commands

```bash
npm run dev          # Run with tsx (auto-reload)
npm run build        # Compile TypeScript to dist/
npm run start        # Run compiled version
npm run type-check   # TypeScript type checking
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm test             # Run tests with Vitest
npm run test:watch   # Run tests in watch mode
npm run compile:all  # Build the five per-arch binaries (any host)
npm run compile:darwin-universal  # Add the lipo'd macOS universal binary (macOS only)
```

### Binary Compilation

Uses Bun to compile TypeScript into standalone executables:

```bash
bun build src/index.ts --compile --minify --target=bun-<platform> --outfile=bin/<name>-<platform>
```

Platforms: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `windows-x64`

Bun cross-compiles every one of those targets from any host, so `compile:all` builds the
five per-arch binaries anywhere. The macOS universal binary is a separate step,
`compile:darwin-universal`, because `lipo` exists only on macOS; keeping it out of
`compile:all` is what lets a Linux host build the per-arch artifacts. `release.yml` runs
on macOS and produces both.

macOS binaries require code signing with `entitlements.plist` (for Bun JIT) and Apple notarization.

### Before Committing

```bash
npm run type-check && npm run lint && npm test
```

### Running under a sandbox

Two things fail for want of a socket rather than because anything is wrong:

- The `npx tsx` CLI opens an IPC socket under `$TMPDIR` and dies with
  `EPERM ... .pipe` before the script runs. Use the loader form instead,
  `node --import tsx <file>`, or the `npm run script --` / `npm run golden`
  aliases. See [scripts/AGENTS.md](scripts/AGENTS.md).
- The OpenTelemetry end-to-end tests stand a collector up on loopback. Where
  that is refused they skip themselves rather than failing the run, so
  `npm test` stays usable and the pre-commit hook passes. CI runs them for real.

`git` and `gh` need the network and the keychain, so run them unsandboxed;
`gh` otherwise fails TLS verification with `x509: OSStatus -26276`.

### Releasing

`CHANGELOG.md` and the version bump belong to the release PR, never to a feature PR.
Feature PRs carry code and tests only; they must NOT edit `CHANGELOG.md` or
`package.json`.

Both files append at the top, so a bump in every feature PR makes each concurrent PR
conflict with the last, and a contributor cannot know whether their change is a patch or
a minor. Instead a PR describes its user-visible effect in a `## Changelog` section of the
PR body, and those get collected into one release PR.

Cutting that release PR is ordinary work: an agent asked to release, or asked to carry
something through to a release, writes the changelog section and bumps the version
without checking back first. The version number is the one judgment call worth stating
out loud — say which bump you chose and why, so a disagreement surfaces before the tag
rather than after it.

1. Cut a release PR from `main` after the fixes for the release have merged:
   - Update `CHANGELOG.md` with a new version section, written from the merged PRs' own
     Changelog sections
   - `npm version minor|patch --no-git-tag-version` (bumps `package.json` only, no tag)
   - One commit, e.g. `chore: vX.Y.Z changelog`
2. Open it as a normal PR and let the merge queue land it
3. After merge, tag the merge commit and push:

   ```bash
   git checkout main && git pull
   scripts/tag-release.sh
   ```

   The script tags the version in `package.json` and refuses if anything about
   the state is wrong: not on `main`, a dirty tree, local `main` behind
   `origin/main` (which would tag the wrong commit), no changelog section for
   the version, or a tag that already exists. Pass `--yes` to skip the prompt.

   **Note:** Do NOT use `npm version` without `--no-git-tag-version` -- it creates a local git tag that points to the feature branch commit, not the merge commit on main. The tag must be created on the merge commit, which is what the script checks for.

The tag push triggers the release workflow, which automatically:
- Builds signed binaries for all platforms
- Creates GitHub Release with binaries
- Publishes to npm via OIDC (no tokens)

## Scripts

Developer and agent utility scripts for golden file generation, DSN parser coverage analysis, and binary inspection. See [scripts/AGENTS.md](scripts/AGENTS.md) for usage.

## Testing

Tests are colocated with source files (e.g., `service.test.ts`). Run with:

```bash
npm test                           # Run all tests
npm test -- src/service.test.ts    # Run specific file
npm run test:watch                 # Watch mode
```

## CI/CD

- **CI** (`ci.yml`): Runs on every push - type-check, lint, test
- **Release** (`release.yml`): Triggered by `v*` tags - builds binaries, signs macOS, publishes npm

npm publishing uses OIDC trusted publishing (configured on npmjs.com) - no tokens required.

### npm OIDC Gotchas

- Do NOT use `registry-url` with `actions/setup-node` - it creates a `.npmrc` with an auth token placeholder that breaks OIDC
- OIDC requires npm 11.5.1+ (Node 22 ships with older npm, so we explicitly upgrade)
- `npm ci` installs from `package-lock.json`, which records the optional platform packages (esbuild, rollup) for every os/cpu, not only the host that generated it. A lockfile written on macOS therefore installs on the Linux runner; regenerate it with `npm install --package-lock-only` so nothing platform-specific is pruned out of it

## DSN Parser Reference

**MANDATORY**: Before modifying ANY file under `src/parsers/cadence/dsn/`, you MUST read the corresponding C++ reference implementation in `references/OpenOrCadParser/`. Do not skip this step. The C++ source is the ground truth for how the binary format works, and our TypeScript is a port of it.

The reference is vendored into this repository, so it is present after a plain `git clone` with no submodule init and no network fetch, in CI and sandboxes as much as locally. It is an unmodified copy of upstream's final commit before the project was archived; see [references/README.md](references/README.md) for provenance and licence. Treat it as read-only — never edit it to match our behaviour. Where our port intentionally diverges, that belongs in `docs/dsn-format.md`.

### Reference workflow

1. **Read `docs/dsn-format.md`** for the binary format spec
2. **Read the corresponding C++ file** in `references/OpenOrCadParser/` before writing any code
3. Cross-reference `docs/olb.xsd` for structure/field names if needed

### C++ reference mapping

The TypeScript files in `src/parsers/cadence/dsn/` map to C++ files in `references/OpenOrCadParser/`:

| TypeScript | C++ reference (read this FIRST) |
|---|---|
| `cache-parser.ts` | `src/Streams/StreamCache.cpp` |
| `page-parser.ts` | `src/Streams/StreamPage.cpp` |
| `package-parser.ts` | `src/Streams/StreamPackage.cpp` |
| `library-parser.ts` | `src/Streams/StreamLibrary.cpp` |
| Any structure parsing | `src/Structures/` (e.g., `StructPlacedInstance.cpp`, `StructT0x10.cpp`, `StructWire.cpp`) |
| Prefix/preamble logic | `src/GenericParser.cpp` |

### Additional resources

- **Cadence schemas**: `docs/olb.xsd`
- **Coverage scripts**: `scripts/dsn-coverage-report.ts`, `scripts/dsn-inspect.ts` (see `scripts/AGENTS.md`)

## Git Guidelines

See the `release` skill (`.claude/skills/release.md`) for commit, push, PR, and release workflows.
