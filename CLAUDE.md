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

Both lockfiles are committed. The release build installs from `bun.lock`; CI and the
npm publish job install from `package-lock.json`. When you change a dependency,
regenerate both lockfiles in the same commit:

```bash
bun install                      # updates bun.lock
npm install --package-lock-only  # updates package-lock.json
```

CI installs with `npm ci` and the release workflow with `bun install --frozen-lockfile`.
Both fail if the lockfile does not match `package.json`, so an out-of-date lockfile is
caught instead of being silently re-resolved.

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

Bun compiles the TypeScript into standalone executables. One script does this, and
`release.yml` and the `compile:*` npm scripts all call it, so you can reproduce a
release binary locally:

```bash
scripts/build-binary.sh <target> <outfile> [channel]

scripts/build-binary.sh bun-linux-x64 bin/universal-netlist-linux-x64
scripts/build-binary.sh host bin/universal-netlist
```

Targets: `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-arm64`, `bun-linux-x64`,
`bun-windows-x64`, plus `host` for the machine running the script.

The script only compiles. It does not use git, the network, signing, publishing, or
`GITHUB_REF`. The version it bakes in comes from `package.json`, which is the single
source of the version. The release workflow validates the git tag against `package.json`;
it does not derive the version from the tag.

The `VERSION` environment variable overrides that. This is for downstream packagers who
want to stamp their own version string without editing a tracked file:

```bash
VERSION=1.5.2-3 scripts/build-binary.sh bun-linux-x64 bin/universal-netlist-linux-x64 packaged
```

`VERSION` may contain only `A-Za-z0-9` and `. + _ ~ : -`. This covers semver, build
metadata, and Debian-style versions such as `1.5.2~rc1`. The version is compiled in as
raw source text, so any other character is rejected.

Bun is the only toolchain the script needs, including for reading the default version.
A container with only the Bun version listed in `.bun-version` can build this.

The third argument is the build channel, baked in as `BUILD_CHANNEL` (see
[src/build-flags.ts](src/build-flags.ts)):

- `github` (default): the binary that `install.sh` installs. It manages its own file:
  it self-updates on startup, `--update` replaces it, and `--uninstall` removes it.
- `packaged`: a binary managed by a package manager (Homebrew, nix, a distro package, a
  vendored copy). Startup self-update is off, and `--update` / `--uninstall` print a
  message saying the install is managed elsewhere instead of modifying it. Build one with:

  ```bash
  scripts/build-binary.sh bun-linux-x64 bin/universal-netlist-linux-x64 packaged
  ```

Bun cross-compiles all of these targets from any host, so `compile:all` builds the five
per-arch binaries on any machine. The macOS universal binary is a separate step,
`compile:darwin-universal`, because `lipo` only exists on macOS. Keeping it out of
`compile:all` lets a Linux host build the per-arch binaries. `release.yml` runs on macOS
and produces both.

`--compile` embeds the Bun runtime in the output, so the Bun version is part of the
shipped binary. `.bun-version` records the Bun version used for release builds. The
release workflow reads it, and to reproduce a release locally, install the same version:

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v$(cat .bun-version)"
```

Bump `.bun-version` in its own PR, so the Bun upgrade is visible in history next to the
first release that shipped with it.

macOS binaries require code signing with `entitlements.plist` (for Bun JIT) and Apple notarization.

### Before Committing

```bash
npm run type-check && npm run lint && npm test
```

### Running under a sandbox

Two things fail in the sandbox because they cannot open a socket, not because of a bug:

- The `npx tsx` CLI opens an IPC socket under `$TMPDIR` and exits with
  `EPERM ... .pipe` before the script runs. Use the loader form instead,
  `node --import tsx <file>`, or the `npm run script --` / `npm run golden`
  aliases. See [scripts/AGENTS.md](scripts/AGENTS.md).
- The OpenTelemetry end-to-end tests start a collector on loopback. If the
  sandbox refuses that, the tests skip themselves instead of failing, so
  `npm test` still works and the pre-commit hook passes. CI runs them for real.

`git` and `gh` need the network and the keychain, so run them unsandboxed.
Otherwise `gh` fails TLS verification with `x509: OSStatus -26276`.

### Releasing

`CHANGELOG.md` and the version bump belong in the release PR, never in a feature PR.
Feature PRs contain code and tests only. They must NOT edit `CHANGELOG.md` or
`package.json`.

Reason: both files append at the top, so if every feature PR bumped them, each
concurrent PR would conflict with the previous one, and a contributor cannot know
whether their change is a patch or a minor. Instead, each PR describes its user-visible
effect in a `## Changelog` section of the PR body. Those sections are collected into one
release PR.

Cutting the release PR is ordinary work. An agent asked to release, or to carry a change
through to a release, writes the changelog section and bumps the version without asking
first. The version number is the one judgment call to state explicitly: say which bump
you chose and why, so any disagreement surfaces before the tag is pushed.

1. Cut a release PR from `main` after the fixes for the release have merged:
   - Update `CHANGELOG.md` with a new version section, written from the merged PRs'
     Changelog sections
   - `npm version minor|patch --no-git-tag-version` (writes the version, creates no tag)
   - One commit, e.g. `chore: vX.Y.Z changelog`

   That command writes the version to **both `package.json` and `package-lock.json`**,
   so the release commit carries three files rather than two. `bun.lock` records the
   workspace root's name and no version, so it does not change.

   Run the command instead of editing `package.json` by hand. A hand-edit leaves
   `package-lock.json` one version behind, and nothing downstream notices: `npm ci`
   compares dependencies and ignores the root version, so CI passes; `npm publish` reads
   the version from `package.json`, so the publish is correct; the lockfile is simply
   wrong. `tag-release.sh` refuses on the mismatch, and it is the only check that catches
   it.
2. Open it as a normal PR and let the merge queue land it
3. After merge, tag the merge commit and push:

   ```bash
   git checkout main && git pull
   scripts/tag-release.sh
   ```

   The script tags the version in `package.json`. It refuses to run if: you are not on
   `main`, the tree is dirty, local `main` is behind `origin/main` (which would tag the
   wrong commit), `CHANGELOG.md` has no section for the version, the lockfile records a
   different version, or the tag already exists. Pass `--yes` to skip the prompt.

   **Note:** Do NOT use `npm version` without `--no-git-tag-version`. It creates a local git tag that points to the feature branch commit, not the merge commit on main. The tag must be created on the merge commit, which is what the script checks for.

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
- `npm ci` installs from `package-lock.json`, which records the optional platform packages (esbuild, rollup) for every os/cpu, not only for the host that generated it. A lockfile written on macOS therefore installs correctly on the Linux runner. Regenerate it with `npm install --package-lock-only` so nothing platform-specific is pruned from it

## DSN Parser Reference

**MANDATORY**: Before modifying ANY file under `src/parsers/cadence/dsn/`, you MUST read the corresponding C++ reference implementation in `references/OpenOrCadParser/`. Do not skip this step. The C++ source is the ground truth for how the binary format works, and our TypeScript is a port of it.

The reference is vendored into this repository, so it is present after a plain `git clone` with no submodule init and no network fetch, in CI and sandboxes as much as locally. It is an unmodified copy of upstream's final commit before the project was archived; see [references/README.md](references/README.md) for provenance and licence. Treat it as read-only: never edit it to match our behaviour. Where our port intentionally diverges, that belongs in `docs/dsn-format.md`.

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
