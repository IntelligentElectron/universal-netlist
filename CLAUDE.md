# Universal Netlist MCP Server

## Overview

MCP server for querying EDA netlists and tracing circuit connectivity. Supports Cadence (CIS, HDL) and Altium Designer formats.

## Development

### Setup

```bash
bun install         # Prefer bun over npm
npm run setup       # Initialize test fixture submodules
npm run dev
```

**Note:** Test fixtures are git submodules. Run `npm run setup` after clone.

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
npm run compile:all  # Build all platform binaries
```

### Binary Compilation

Uses Bun to compile TypeScript into standalone executables:

```bash
bun build src/index.ts --compile --minify --target=bun-<platform> --outfile=bin/<name>-<platform>
```

Platforms: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `windows-x64`

macOS binaries require code signing with `entitlements.plist` (for Bun JIT) and Apple notarization.

### Before Committing

```bash
npm run type-check && npm run lint && npm test
```

### Releasing

Include version bump and changelog in the feature PR itself (no separate release PR):

1. Before pushing your feature branch, add the release commits:
   - Update `CHANGELOG.md` with new version section
   - `git commit -am "Add vX.Y.Z changelog"`
   - `npm version patch --no-git-tag-version` (bumps `package.json` only, no tag)
   - `git commit -am "vX.Y.Z"`
2. Push branch and open PR as usual
3. After merge, tag the merge commit and push:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   **Note:** Do NOT use `npm version` without `--no-git-tag-version` -- it creates a local git tag that points to the feature branch commit, not the merge commit on main. The tag must be created manually on the merge commit.

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
- Use `npm install` instead of `npm ci` - npm 11.x has stricter lock file validation that fails with cross-platform optional deps (esbuild, rollup)
- Never commit any lockfile (`bun.lock`, `package-lock.json`) - vitest/rollup have cross-platform optional deps
