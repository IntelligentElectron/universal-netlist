#!/usr/bin/env bash
set -uo pipefail

# PreToolUse hook: block Bash commands that should use dedicated tools.
#
# Only blocks when a blocked tool is the PRIMARY command (first in a pipeline).
# Blocked tools after a pipe are allowed (e.g., `npm test | tail -20` is fine).

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')

if [[ -z "$cmd" ]]; then
  exit 0
fi

# Blocked tools: name -> message
declare -A BLOCKED
BLOCKED[find]="Use the Glob tool to find files, or Grep to search contents."
BLOCKED[fd]="Use the Glob tool to find files, or Grep to search contents."
BLOCKED[grep]="Use the Grep tool instead."
BLOCKED[egrep]="Use the Grep tool instead."
BLOCKED[fgrep]="Use the Grep tool instead."
BLOCKED[rg]="Use the Grep tool instead."
BLOCKED[ag]="Use the Grep tool instead."
BLOCKED[ack]="Use the Grep tool instead."
BLOCKED[cat]="Use the Read tool instead."
BLOCKED[head]="Use the Read tool instead."
BLOCKED[tail]="Use the Read tool instead."
BLOCKED[less]="Use the Read tool instead."
BLOCKED[more]="Use the Read tool instead."
BLOCKED[sed]="Use the Edit tool for modifications, or Read for viewing."
BLOCKED[awk]="Use the Edit tool for modifications, or Read for viewing."

# Sanitize a word: strip quotes, backslashes, shell syntax, then basename
sanitize() {
  local w="$1"
  w="${w//\\/}"        # backslashes
  w="${w//\"/}"        # double quotes
  w="${w//\'/}"        # single quotes
  w="${w//\(/}"        # parens
  w="${w//\)/}"
  w="${w//\{/}"        # braces
  w="${w//\}/}"
  w="${w//\$/}"        # dollar signs
  w="${w//\`/}"        # backticks
  if [[ -z "$w" ]] || [[ "$w" == -* ]]; then
    return
  fi
  basename -- "$w" 2>/dev/null || echo "$w"
}

# Extract the first segment of a pipeline (everything before the first |)
# Also split on ; and && and || to get each independent command
# We only check the primary command of each independent statement
first_segments=""
remainder="$cmd"

# Split on ; && || first to get independent statements
# Then for each statement, only check the first pipeline segment
while IFS= read -r statement; do
  # Get text before the first pipe (the primary command of this pipeline)
  first_seg="${statement%%|*}"
  first_segments+="$first_seg"$'\n'
done < <(echo "$cmd" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g')

# Scan only the first pipeline segment of each statement
while IFS= read -r segment; do
  for word in $segment; do
    clean=$(sanitize "$word")
    if [[ -z "$clean" ]]; then
      continue
    fi
    if [[ -n "${BLOCKED[$clean]+x}" ]]; then
      echo "BLOCKED: '$clean' is not allowed in Bash. ${BLOCKED[$clean]}" >&2
      exit 2
    fi
  done
done <<< "$first_segments"

exit 0
