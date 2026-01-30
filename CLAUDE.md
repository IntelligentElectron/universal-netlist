# CLAUDE.md - Universal Netlist MCP Server

## Overview

MCP server for querying EDA netlists and tracing circuit connectivity. Supports Cadence (CIS, HDL) and Altium Designer formats.

## Development

### Setup

```bash
npm install
npm run dev
```

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
```

### Before Committing

```bash
npm run type-check && npm run lint && npm test
```

### Releasing

1. Update `CHANGELOG.md` with new version section
2. Commit changelog: `git commit -am "Add vX.Y.Z changelog"`
3. Bump version: `npm version patch -m "v%s"`
4. Push: `git push && git push origin vX.Y.Z`

The release workflow automatically:
- Builds signed binaries for all platforms
- Creates GitHub Release with binaries
- Publishes to npm via OIDC (no tokens)

## Project Structure

```bash
src/
  index.ts              # Entry point, CLI handling
  server.ts             # MCP server setup, tool registration
  service.ts            # Tool implementations (query logic)
  types.ts              # TypeScript types and interfaces
  version.ts            # Version constant
  circuit-traversal.ts  # XNET traversal algorithm
  cli/
    commands.ts         # CLI command handlers
  parsers/
    index.ts            # Parser registry
    cadence/            # Cadence CIS/HDL parser
    altium/             # Altium Designer parser
docs/
  README.md             # API documentation
  tools/                # Per-tool documentation
  schemas/              # Type documentation
```

## Adding New Features

### Adding a New Tool

1. Add the service function in `src/service.ts`
2. Register the tool in `src/server.ts` using `server.registerTool()`
3. Add documentation in `docs/tools/`
4. Add tests in `src/service.test.ts`

## Key Concepts

### ParsedNetlist

The core data structure returned by parsers:

```typescript
interface ParsedNetlist {
  components: { [refdes: string]: ComponentData };
  nets: { [netName: string]: Array<{ refdes: string; pin: string }> };
}
```

### XNET Traversal

The `query_xnet_*` tools trace connectivity through series components (resistors, capacitors, inductors). The algorithm:

1. Start from a net or pin
2. Find all components connected to the net
3. For 2-pin passive components, traverse to the net on the other pin
4. Continue until reaching power/ground nets or components with >2 pins
5. Return all visited components and nets

### DNS (Do Not Stuff)

Components marked as DNS are excluded by default. The `include_dns` parameter includes them.

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
