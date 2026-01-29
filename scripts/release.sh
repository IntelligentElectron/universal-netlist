#!/bin/bash
# Release script for universal-netlist
# Usage: ./scripts/release.sh [patch|minor|major]
# Example: ./scripts/release.sh patch

set -e

BUMP_TYPE=${1:-patch}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Get current version from version.ts
CURRENT_VERSION=$(grep 'export const VERSION' "src/version.ts" | sed 's/.*"\(.*\)".*/\1/')

# Remove any suffix like -alpha
CURRENT_VERSION=$(echo "$CURRENT_VERSION" | sed 's/-.*//')

# Parse version parts
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Bump version based on type
case "$BUMP_TYPE" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "Usage: ./scripts/release.sh [patch|minor|major]"
    echo "  patch  - bump patch version (0.0.X)"
    echo "  minor  - bump minor version (0.X.0)"
    echo "  major  - bump major version (X.0.0)"
    exit 1
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# Check CHANGELOG.md has an entry for the new version
if ! grep -q "## \[$NEW_VERSION\]" CHANGELOG.md; then
  echo "Error: CHANGELOG.md does not have an entry for version $NEW_VERSION"
  echo "Please add release notes before running the release script."
  exit 1
fi

echo "📦 Releasing universal-netlist"
echo "   ${CURRENT_VERSION} → ${NEW_VERSION}"
echo ""

# Update version.ts
echo "Updating version.ts..."
sed -i '' "s/export const VERSION = \".*\"/export const VERSION = \"${NEW_VERSION}\"/" "src/version.ts"

# Update package.json
echo "Updating package.json..."
sed -i '' "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" "package.json"

# Update manifest.json (for .mcpb desktop extension)
echo "Updating manifest.json..."
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${NEW_VERSION}\"/" "manifest.json"

# Run tests
echo ""
echo "Running tests..."
npm run type-check
npm run lint
npm test

# Stage and commit
echo ""
echo "Committing..."
git add "src/version.ts" "package.json" "manifest.json"
git commit -m "chore: release v${NEW_VERSION}"

# Push
echo "Pushing to origin..."
git push origin main

# Tag and push tag
echo "Creating tag v${NEW_VERSION}..."
git tag "v${NEW_VERSION}"
git push origin "v${NEW_VERSION}"

echo ""
echo "✅ Released universal-netlist v${NEW_VERSION}"
echo "🔗 https://github.com/IntelligentElectron/universal-netlist/actions"
