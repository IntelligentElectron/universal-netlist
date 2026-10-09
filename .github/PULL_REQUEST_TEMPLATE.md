## Summary

<!-- What changed and why, in user-facing terms. GitHub builds the release notes from this. -->

## Changes

- Change 1
- Change 2

## Related Issues

Closes #

## Decision tables

<!--
Required. Golden tables live in docs/decision-tables/<feature>/, and a *.table.test.ts
replays each one against the code. Pick the case that fits, and paste command output
unedited, in fenced code blocks:

- Logic covered by a table changed: the evidence step 8 of the decision-tables plugin
  lists for this kind of PR (new feature, behavior change, refactor, bug fix).
  The plugin is valentinozegna/decision-tables; .claude/settings.json and
  .codex/config.toml install it.
- New logic with interacting conditions and no table: build the table first, then
  attach it as a new feature.
- No table-covered logic changed: one line saying so and why, for example "Docs only".
-->

## Verification

<!--
Required. Run the changed code through its real surface (the MCP server over stdio,
the CLI, the built binary) and paste what you observed. Tests and the type check are
CI's job and do not count here.

- Claude Code: run /verify on the branch and paste its report.
- Any other agent or a person: drive the surface the change reaches, paste the
  captured output, include at least one case off the happy path, and give a verdict:
  PASS, FAIL, BLOCKED, or SKIP (SKIP only for docs, tests, or config, with one line why).

A FAIL or BLOCKED verdict means the PR is not ready yet.
-->

## Testing

- [ ] Added/updated tests
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes

## Checklist

- [ ] Code follows project style guidelines
- [ ] Self-reviewed the code
- [ ] Added documentation if needed
