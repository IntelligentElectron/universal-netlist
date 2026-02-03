#!/usr/bin/env bash
set -uo pipefail

# Read tool input from stdin (Claude passes JSON with tool_input)
input=$(cat)

# Extract file_path from the tool input
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# Skip if no file path or not a .ts file
if [[ -z "$file_path" ]] || [[ "$file_path" != *.ts ]]; then
  exit 0
fi

project_dir="$CLAUDE_PROJECT_DIR"
errors=""

# 1. Format the file in place
format_output=$(npx --prefix "$project_dir" prettier --write "$file_path" 2>&1) || {
  errors+="=== Prettier errors ===\n$format_output\n\n"
}

# 2. Lint the file
lint_output=$(npx --prefix "$project_dir" eslint "$file_path" 2>&1) || {
  errors+="=== ESLint errors ===\n$lint_output\n\n"
}

# 3. Type-check the whole project (cross-file types require it)
tsc_output=$(npx --prefix "$project_dir" tsc --noEmit 2>&1) || {
  errors+="=== TypeScript errors ===\n$tsc_output\n\n"
}

if [[ -n "$errors" ]]; then
  echo -e "$errors" >&2
  exit 2
fi
