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

1. Fork the repository, then clone your fork (including test fixtures) and add
   this repository as `upstream`:

   ```bash
   git clone --recurse-submodules https://github.com/YOUR_USERNAME/universal-netlist.git
   cd universal-netlist
   git remote add upstream https://github.com/IntelligentElectron/universal-netlist.git
   ```

   A fork is the standard path for everyone outside the organization. Only
   maintainers can push branches to this repository; that is GitHub's default
   for a public repository, not a restriction specific to this project. Your
   fork is `origin`, where your branches go, and `upstream` is where `main`
   comes from.

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

4. **Push to your fork and open a PR against `main` here:**

   ```bash
   git push -u origin feature/your-feature-name
   gh pr create --repo IntelligentElectron/universal-netlist \
     --base main --head YOUR_USERNAME:feature/your-feature-name
   ```

   Pushing to `IntelligentElectron/universal-netlist` directly is rejected
   without write access, which is expected. The PR from your fork is the
   contribution.

   - Fill out the PR template
   - Link any related issues
   - Describe what you changed and why
   - Include the `## Decision tables` and `## Verification` sections (see
     [Decision tables and verification](#decision-tables-and-verification))

5. **Do not edit `CHANGELOG.md` or bump `package.json`:**
   A version tag stamps every release artifact and GitHub generates its notes from merged
   PRs. Use a clear, user-facing PR title and description so the generated changelog says
   what changed and why.

6. **Code Review:**
   - Respond to feedback
   - Make requested changes
   - If `main` changes before merge, bring your branch up to date and let the
     required check rerun:

     ```bash
     git fetch upstream
     git rebase upstream/main
     git push --force-with-lease
     ```

### Decision tables and verification

Every PR description has these two sections, whether a person or an agent writes it.
A PR missing either one is not ready to merge. `gh pr create --body` skips the template,
so an agent that writes the body itself adds both sections by hand.

**Decision tables.** Logic with interacting conditions is specified by golden tables in
`docs/decision-tables/<feature>/`, and a `*.table.test.ts` beside the code replays every
cell. The tables come from the
[decision-tables](https://github.com/valentinozegna/decision-tables) plugin, which
`.claude/settings.json` and `.codex/config.toml` offer to install when you open the repo
in Claude Code or Codex.

- Logic covered by a table changed: paste the evidence that the plugin's step 8, "Attach
  the table to the PR", lists for this kind of PR (new feature, behavior change,
  refactor, bug fix), unedited, in fenced code blocks.
- New logic with interacting conditions and no table: build the table first, then attach
  it as a new feature.
- No table-covered logic changed: write one line saying so and why.

**Verification.** Run the changed code through its real surface (the MCP server over
stdio, the CLI, the built binary) and paste what you observed. Passing tests and the type
check are CI's job and do not count here.

- Claude Code: run `/verify` on the branch and paste its report.
- Any other agent, or a person: drive the surface the change reaches, paste the captured
  output, include at least one case off the happy path, and give a verdict of PASS, FAIL,
  BLOCKED, or SKIP. SKIP is for docs, tests, or config only, with one line why.

A FAIL or BLOCKED verdict means the PR is not ready yet.

### After you open a PR

Everything below is enforced by the ruleset on `main`, which anyone can read:

```bash
gh api repos/IntelligentElectron/universal-netlist/rules/branches/main
```

- CI runs on every PR, including one opened from a fork, and starts as soon as
  the PR is opened. The workflow runs on the `pull_request` event with a
  read-only token and uses no secrets, so a fork needs nothing configured.
- The required check is `build`. It must pass, and it must have run on a branch
  that is up to date with `main`, before the PR can merge. If `main` moves after
  your check passed, rebase as in step 6 and the check reruns.
- `main` accepts changes only through a pull request, and blocks force-pushes
  and deletion. Rewriting your own branch is fine; nothing rewrites `main`.
- A maintainer reviews and merges. Contributors do not merge their own PRs and
  do not need to.

## Reporting Issues

- Use the issue templates
- Include steps to reproduce
- Provide sample files if possible (anonymized)
- The template applies a starting label on its own. Every other label,
  milestone and assignee is set by maintainers during triage, and GitHub rejects
  them from anyone without write access, so describe the problem and leave the
  categorizing to us.

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

## Questions?

Open an [issue](https://github.com/IntelligentElectron/universal-netlist/issues/new/choose)
for questions or ideas. The feature request template works for both.
