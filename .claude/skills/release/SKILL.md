---
name: release
description: "ALWAYS use this skill when the user mentions: commit, push, PR, pull request, release, ship, tag, or any git workflow. This skill defines how to stage, commit, push, create PRs, and tag releases. It MUST be loaded before performing any git commit or push operation."
---

## Committing

### Include ALL changes

The user works in parallel with you. When asked to commit, include ALL changes in the working tree, not just the ones you made. The user's manual edits are equally important. Always run `git status` first and review everything.

### Workflow

1. Run `git status` (never use `-uall`) and `git diff --stat` to see the full picture
2. Run `git log --oneline -5` to match the repository's commit message style
3. Review ALL changes, both yours and the user's, to understand the full scope
4. Stage ALL relevant files. Do not cherry-pick only your changes
   - Do NOT stage files that contain secrets (`.env`, credentials, keys)
   - Warn the user if they ask to commit such files
5. Draft a commit message:
   - Format: `type: description` (e.g., `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`)
   - Focus on the "why", not the "what"
   - Keep it concise (1-2 sentences)
6. Commit using a HEREDOC for clean formatting:
   ```bash
   git commit -m "$(cat <<'EOF'
   type: description
   EOF
   )"
   ```
7. NEVER add Claude Code or any other AI assistant as co-author or author
8. NEVER use `--no-verify` to skip hooks unless the user explicitly asks
9. If pre-commit hooks fail, fix the issue and create a NEW commit (do not amend)

### Grouping commits

For large changesets, plan multiple logical commits. After the first commit passes hooks cleanly, subsequent commits can use `--no-verify` to speed things up.

## Pushing

- Push without asking. The PR and its checks are the review gate, not a confirmation prompt
- Use `git push` for tracked branches
- Use `git push -u origin <branch>` for new branches
- NEVER force push to `main`/`master`

## Merging

**If a PR's work is fully done and verified, merge it.** Do not leave finished work
sitting open waiting for permission, and do not ask whether to merge something that is
complete and green.

Done and verified means: the change does what the PR says, `build` is green, and any
claim the PR makes about behavior has been checked against real data rather than asserted.
A PR that is still exploratory, or whose effect has not been measured, is not done — say
what is missing instead of merging it.

### Merge with Valentino's credentials

`main` does not use a merge queue. Two independent rulesets apply:

- **Only Valentino may merge** blocks updates to the default branch. Its sole
  bypass actor is GitHub user `valentinozegna` (ID `6832610`), for pull requests only.
- **main-protection** requires a PR and a passing, up-to-date `build` check, and
  blocks deletion and force pushes. It has no bypass actors.

Use Valentino's existing authenticated GitHub CLI session. GitHub permissions are
attached to the account, not the commit's `user.email`; changing the author email
cannot grant merge access. Run `git` and `gh` outside the sandbox for network and
keychain access, as described in `CLAUDE.md`.

1. Verify the identity actually used by the API, including any token override:
   ```bash
   gh api user --jq .login
   ```
   It must print `valentinozegna`. If another saved account is active, switch with
   `gh auth switch --hostname github.com --user valentinozegna`, then verify again.
   If the API still reports a different account, or Valentino is not authenticated,
   stop the merge and report that authentication needs correcting. Never print,
   copy, or commit credentials.
2. Record the PR's full head SHA, check its base, and wait for CI:
   ```bash
   gh pr view <n> --repo IntelligentElectron/universal-netlist --json headRefOid,baseRefName,mergeStateStatus
   gh pr checks <n> --repo IntelligentElectron/universal-netlist --watch --fail-fast
   ```
   Require `build` to pass for the recorded head and address actionable review
   findings. If the head changes, check the new commit before merging it.
3. Merge the exact verified commit using Valentino's permitted bypass:
   ```bash
   gh pr merge <n> --repo IntelligentElectron/universal-netlist --squash --admin --match-head-commit <verified-head-sha>
   ```
   Here `--admin` invokes the account's exception to **Only Valentino may merge**.
   It does not grant a bypass of **main-protection**. A normal merge command can
   report `Cannot update this protected ref` even after CI passes; this is why the
   permitted bypass is needed. Do not weaken either ruleset to make a merge work.
   If this command is rejected, inspect the current account, rules, head, and checks
   before retrying; do not remove protection or push directly to `main`.
4. Verify the recorded result:
   ```bash
   gh pr view <n> --repo IntelligentElectron/universal-netlist --json state,mergedBy,mergeCommit,url
   ```
   Confirm `MERGED` and `mergedBy.login == "valentinozegna"`. Then update a clean
   local `main` with `git switch main` and `git pull --ff-only`.

For a manual GitHub merge, sign in as `valentinozegna`, wait for CI, select the
**Merge without waiting for requirements to be met (bypass rules)** checkbox, and
squash-merge. The wording is GitHub's: it selects Valentino's PR-only exception;
the separate required-build protection still applies. Other accounts have no
exception to the merge restriction.

## Pull Requests

1. Check the full branch diff: `git log --oneline main..HEAD` and `git diff main...HEAD --stat`
2. Push the branch if needed
3. Create PR with:
   ```bash
   gh pr create --title "short title" --body "$(cat <<'EOF'
   ## Summary
   <1-3 bullet points>

   ## Test plan
   - [ ] verification steps
   EOF
   )"
   ```
4. Return the PR URL to the user
5. Merge it once the work is done and the checks are green (see Merging above)

## Releases

The tag push publishes to npm and cuts a public GitHub Release, and it cannot be taken
back cleanly, so it needs the user to have actually asked for a release.

Once they have, it is asked and answered: tag it. "Release 1.5.2", "ship it", or "take
this all the way" is the green light, and a second confirmation afterwards only parks
finished work. `scripts/tag-release.sh --yes` skips the interactive prompt, which a
non-interactive session cannot answer anyway; the script still refuses a wrong state,
which is the check that actually protects the release.

Absent that ask, do not infer one. Cut the release PR, merge it, say that the tag is the
remaining step, and stop there.

1. Ensure `main` is clean and all checks pass
2. Ensure `CHANGELOG.md` covers every change in the release. Feature PRs do not edit it
   (see CLAUDE.md), so collect their `## Changelog` sections into the version section first
3. Create and push the tag with `scripts/tag-release.sh` (add `--yes` when the session
   cannot answer its prompt). Never tag by hand: `git tag` skips every state check, and
   tagging the wrong commit is the mistake the script exists to prevent
4. Monitor CI: `gh run list` and `gh run view`

## Pre-commit Hooks

This repo uses husky + lint-staged. Pre-commit runs:
- ESLint (with auto-fix) and type-check on staged TS/TSX files
- All TypeScript tests (`npm test`) across all workspaces
- Python validation for `services/server`: Black, Pyright, pytest

If hooks fail:
- Git pull issues: work with the user to resolve
- Type/lint errors: fix the code
- Test failures: identify root cause and fix (code or tests)
