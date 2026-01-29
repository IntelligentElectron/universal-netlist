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

2. Install dependencies:

   ```bash
   npm install
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
- `src/parsers/` - Format-specific parsers (Cadence, Altium)
- `test/fixtures/` - Test fixture designs (git submodules)
- `test/golden/` - Golden reference outputs for regression testing
- `docs/` - API documentation

### Test Fixtures

Test fixtures are stored as git submodules pointing to open-source hardware projects:

| Fixture | Source |
|---------|--------|
| `test/fixtures/altium/LimeSDR-USB` | [myriadrf/LimeSDR-USB](https://github.com/myriadrf/LimeSDR-USB) |
| `test/fixtures/altium/Altium-STM32-PCB` | [akhilaprabodha/Altium-STM32-PCB](https://github.com/akhilaprabodha/Altium-STM32-PCB) |
| `test/fixtures/cadence/BeagleBone-Black` | [beagleboard/beaglebone-black](https://github.com/beagleboard/beaglebone-black) |

The `nRF52840-Development-Kit` fixture is included inline as it's a minimal test case.

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

5. **Code Review:**
   - Respond to feedback
   - Make requested changes
   - Keep the PR updated with main

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
