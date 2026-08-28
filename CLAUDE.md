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

Both lockfiles are committed. Binary packaging installs from `bun.lock`; CI installs
from `package-lock.json` and produces the npm tarball that is later published unchanged.
When you change a dependency,
regenerate both lockfiles in the same commit:

```bash
bun install                      # updates bun.lock
npm install --package-lock-only  # updates package-lock.json
```

CI installs with `npm ci` and binary packaging with `bun install --frozen-lockfile`.
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
`GITHUB_REF`. Locally, the version it bakes in comes from `package.json`. A release passes
the version tag through `VERSION`, making the tag the single source for every shipped
artifact without committing release-only version changes to `main`.

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

There is no release PR. Feature PRs contain the code, tests, and documentation users
need. Give each PR a user-facing title and description; GitHub uses the merged PRs to
generate release notes. Do not edit `CHANGELOG.md` or bump the development version.

After the intended changes have merged, choose the semantic version bump explicitly,
then tag the current `main` commit:

```bash
git checkout main && git pull
scripts/tag-release.sh 1.8.0
```

The script refuses to run off `main`, with a dirty or stale tree, for a malformed
semantic version, or for an existing tag. Pass `--yes` to skip the prompt. The tag is the
release version; CI stamps it into the npm package and binaries only in the disposable
runner checkout.

The tag triggers one release workflow, which automatically:

- Runs the same type check, lint, tests, and TypeScript build required on PRs
- Packs the npm tarball once and publishes that exact CI artifact via OIDC
- Builds, signs, and notarizes the standalone binaries
- Generates release notes from merged PRs and creates the GitHub Release

`CHANGELOG.md` is the historical changelog through v1.7.4. New changelogs live with the
GitHub Releases generated by the tag workflow.

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

- **CI** (`ci.yml`): One required PR run — type-check, lint, test, build
- **Release** (`release.yml`): One `v*` tag run — calls CI, then signs/releases binaries
  and publishes the CI-built npm tarball

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
