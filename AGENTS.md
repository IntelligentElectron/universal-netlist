# Universal Netlist MCP Server

## Overview

MCP server for querying EDA netlists and tracing circuit connectivity. Supports Cadence OrCAD/CIS (.DSN), Altium Designer, KiCad, and Universal Netlist formats.

DAT parsing and `export_cadence_netlist` are dormant in MCP, controlled by
`src/features.ts`. Keep their implementations and regression tests. Developer
scripts (`scripts/dsn-vs-dat-coverage.ts`, `scripts/dsn-coverage-report.ts`, golden
generation) still use DAT as an independent reference; do not advertise that path
to MCP clients, the CLI, or user-facing docs.

## Accuracy and evidence

The goal of this project is to be the most accurate converter of vendor EDA formats there
is: every design read exactly as its vendor's own tool reads it. The target is 100%
accuracy with zero mistakes. Every other consideration serves that one.

A vendor file format is a fact. Cadence, Altium and KiCad defined theirs; nobody on this
project did, and nobody here holds an opinion about what a record means. A reading of a
format is either proven correct or not yet proven. No reading is settled by preference, and
none is the maintainer's to choose.

This sets how an agent works on any parser:

- **Never ask the maintainer to rule** on what a file means, on which of two readings is
  right, or on the outcome of a decision-table cell. The maintainer sets the goal; the
  vendor's files settle the facts. Find the evidence and decide from it.
- **Evidence is real vendor data.** Real design files, and the vendor tool's own output for
  them: Capture's `pstxnet.dat`, `pstchip.dat` and `pstxprt.dat`, its design-check reports,
  a board's netlist, a schematic PDF. A synthetic input shows what our code does, and says
  nothing about the vendor's.
- **A behavior is settled when the evidence proves it** on every real case that reaches it,
  with the count stated. Until then it is unproven. Say so plainly, record it as an open
  question in the format's spec with what the data shows, and keep looking for a real file
  that decides it.
- **Close the loop.** Work on a parser is finished when it is verified against real files
  and every case it touches is either proven or recorded as open. Presenting a choice to
  the maintainer and waiting for an answer finishes nothing.

Decision tables serve this, and they belong to the agent. They are its instrument for
enumerating every case of a piece of logic, finding the edge cases, testing the code cell
by cell, and showing that no case was left out. The maintainer does not read them and does
not adjudicate their cells. Where the `decision-tables` plugin has a person decide a cell,
in a table about a vendor format the vendor's files decide it:

- `decided`: every real case that falls in the cell was verified against the file or the
  vendor's output, and the note carries the evidence and the counts.
- `draft`: derived from the code, with no real case to verify it yet. The note says so.
- `flag` is never left standing. A cell in doubt is investigated until it is `decided`, or
  is honestly a `draft` with its open question in the spec.

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
npm run lint         # oxlint
npm run lint:fix     # oxlint with auto-fix
npm test             # Run tests with Vitest
npm run test:watch   # Run tests in watch mode
npm run compile:all  # Build the five per-arch binaries (any host)
npm run compile:darwin-universal  # Add the legacy lipo'd macOS universal binary (macOS only)
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
per-arch binaries on any machine. A Mac installs and updates to the binary for its own
CPU, `darwin-arm64` or `darwin-x64`. The macOS universal binary is a legacy asset: installs
from v0.0.15 through v1.13.x request it by name, and their next update moves them to the
per-arch binary. Building it is a separate step, `compile:darwin-universal`, because
`lipo` only exists on macOS. Keeping it out of `compile:all` lets a Linux host build the
per-arch binaries. `release.yml` runs on macOS and produces all three.

`--compile` embeds the Bun runtime in the output, so the Bun version is part of the
shipped binary. `.bun-version` records the Bun version used for release builds. The
release workflow reads it, and to reproduce a release locally, install the same version:

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v$(cat .bun-version)"
```

Bump `.bun-version` in its own PR, so the Bun upgrade is visible in history next to the
first release that shipped with it.

`BUILD_OTEL_DEFAULTS` bakes OpenTelemetry defaults into a packaged binary; see
[docs/observability.md](docs/observability.md#packaged-builds). Release builds leave it unset.

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

### Decision tables

Logic with interacting conditions is designed with the `decision-tables` skill, from
the plugin `decision-tables@decision-tables` in `valentinozegna/decision-tables`.
`.claude/settings.json` and `.codex/config.toml` register it, so Claude Code and Codex
offer to install it on every clone. Golden tables live in `docs/decision-tables/<feature>/`,
and a `*.table.test.ts` beside the code replays every cell (for example
`src/service/net-names.table.test.ts`).

The tables are the agent's instrument for verifying logic, and no cell is put to the
maintainer: [Accuracy and evidence](#accuracy-and-evidence) says how a cell is decided.

### Pull request descriptions

Every PR description, from any agent or person, has a `## Decision tables` section and
a `## Verification` section; a PR missing either is not ready to merge. Decision tables:
the plugin's step 8 evidence when table-covered logic changes, or one line saying why
none applies. Verification: in Claude Code, the `/verify` report; in any other agent, a
free-form report that drives the real surface, pastes the output, probes off the happy
path, and gives a PASS/FAIL/BLOCKED/SKIP verdict. `.github/PULL_REQUEST_TEMPLATE.md`
carries both sections; `gh pr create --body` skips it, so add them by hand.
[CONTRIBUTING.md](CONTRIBUTING.md#decision-tables-and-verification) has the details.

## CI/CD

- **CI** (`ci.yml`): One required PR run — type-check, lint, test, build. A PR that changes only Markdown outside `plugins/` and `docs/decision-tables/` skips the build; the required `build` check still passes
- **Release** (`release.yml`): One `v*` tag run — calls CI, then signs/releases binaries
  and publishes the CI-built npm tarball

npm publishing uses OIDC trusted publishing (configured on npmjs.com) - no tokens required.

### npm OIDC Gotchas

- Do NOT use `registry-url` with `actions/setup-node` - it creates a `.npmrc` with an auth token placeholder that breaks OIDC
- OIDC requires npm 11.5.1+ (Node 22 ships with older npm, so we explicitly upgrade)
- `npm ci` installs from `package-lock.json`, which records the optional platform packages (esbuild, rollup) for every os/cpu, not only for the host that generated it. A lockfile written on macOS therefore installs correctly on the Linux runner. Regenerate it with `npm install --package-lock-only` so nothing platform-specific is pruned from it

## DSN Parser Reference

**`docs/cadence-dsn-format.md` is the authority for the `.DSN` format.** Read the chapter
for the structure you are about to change before modifying any file under
`src/parsers/cadence/dsn/`. Every fact in it was checked against real files and carries
its evidence level (E export, S structural, T test, O observed).

- A verified fact that the parser implements is final: do not edit it.
- Change the parser only toward what the spec states. Where the spec lists a fact as
  unverified or open, verify it on real files first (`test/fixtures`, the corpus,
  Capture's exports), then record the result in the spec.
- Move a disproved claim to the chapter's Refuted table instead of deleting it.
- Each chapter's Parser divergences table lists where the parser still differs from the
  files.

`references/OpenOrCadParser/` is the C++ project our parser was first ported from. It is
historical: it gets several layouts wrong (for example the graphic-instance bounding box),
so it is not a source of truth and is not required reading. Treat it as read-only.

### Additional resources

- **Cadence schemas**: `docs/olb.xsd`
- **Coverage scripts**: `scripts/dsn-vs-dat-coverage.ts`, `scripts/dsn-coverage-report.ts`, `scripts/dsn-inspect.ts` (see `scripts/AGENTS.md`)

## Git Guidelines

See the [release skill](.claude/skills/release/SKILL.md) for commit, push, PR, and
release workflows, including account verification and the permitted PR-only
merge bypass for `valentinozegna`. The same skill is exposed through
`.agents/skills/release/SKILL.md`.
