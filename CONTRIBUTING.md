# Contributing to Universal Netlist MCP Server

Thank you for your interest in contributing! We welcome contributions from the community.

## Maintainers

This project is maintained by:
- **Valentino Zegna** - Creator & Lead Maintainer

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- npm

### Development Setup

1. Fork and clone the repository (including test fixtures):

   ```bash
   git clone --recurse-submodules https://github.com/YOUR_USERNAME/universal-netlist.git
   cd universal-netlist
   ```

   If you already cloned without `--recurse-submodules`, fetch the test fixtures:

   ```bash
   git submodule update --init --recursive
   ```

   Or after installing dependencies: `npm run setup`

2. Install dependencies from the committed lockfile:

   ```bash
   npm ci
   ```

   Both `package-lock.json` and `bun.lock` are committed, and a PR that changes
   `package.json` dependencies regenerates both:

   ```bash
   bun install                      # updates bun.lock
   npm install --package-lock-only  # updates package-lock.json
   ```

3. Run the development server:

   ```bash
   npm run dev
   ```

4. Run tests:

   ```bash
   npm test
   ```

### Project Structure

- `src/` - Main source code
- `src/parsers/` - Format-specific parsers (Cadence, Altium, KiCad)
- `test/fixtures/` - Test fixture designs (git submodule)
- `test/golden/` - Golden reference outputs for regression testing
- `docs/` - API documentation

### Test Fixtures

`test/fixtures` is a git submodule of
[IntelligentElectron/test-fixtures](https://github.com/IntelligentElectron/test-fixtures),
a curated corpus of open-source hardware designs covering Altium, Cadence, and KiCad.
Its `NOTICE.md` records the upstream source, license, and copyright of every fixture.

## Development Workflow

### Running Checks

Before submitting a PR, run all checks:

```bash
npm run type-check    # TypeScript type checking
npm run lint          # ESLint
npm test              # Unit tests
```

### Code Style

- TypeScript with strict mode
- ESLint for linting
- Prefer functional programming patterns
- Add JSDoc comments for exported functions

### Writing Tests

- Tests are colocated with source files (e.g., `service.test.ts`)
- Use Vitest for testing
- Test edge cases and error conditions

## Pull Request Process

1. **Create a feature branch:**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**
   - Keep commits focused and atomic
   - Write clear commit messages

3. **Run all checks:**

   ```bash
   npm run type-check && npm run lint && npm test
   ```

4. **Push and create a PR:**
   - Fill out the PR template
   - Link any related issues
   - Describe what you changed and why

5. **Do not edit `CHANGELOG.md` or `package.json`:**
   Release notes and version bumps are the maintainer's, collected into a separate release
   PR. Both files append at the top, so editing them in a feature PR conflicts with every
   other open PR. Instead, add a short `## Changelog` section to your PR description saying
   what changes for a user — that text is what ends up in the release notes.

6. **Code Review:**
   - Respond to feedback
   - Make requested changes
   - A merge queue lands merged PRs, so you do not need to keep your branch up to date
     with `main` yourself

## Reporting Issues

- Use the issue templates
- Include steps to reproduce
- Provide sample files if possible (anonymized)

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

## Questions?

Open a [Discussion](https://github.com/IntelligentElectron/universal-netlist/discussions) for questions or ideas.
