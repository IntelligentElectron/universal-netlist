#!/bin/bash
#
# Tag a release on the merge commit that carries it, and push the tag.
#
#   scripts/tag-release.sh            # tag the version in package.json
#   scripts/tag-release.sh 1.5.1      # tag that version, and check it matches
#   scripts/tag-release.sh --yes      # skip the confirmation prompt
#
# The tag push is what publishes: it builds the signed binaries, cuts the GitHub
# Release and publishes to npm. Everything before it, the changelog and the
# version bump, goes through a normal release PR and the merge queue. This
# script only does the last step, and only once the checks below all hold.
#
# It refuses rather than repairs. Each check guards a way a release has actually
# gone wrong or could: a tag on a feature-branch commit instead of the merge
# commit, a version nobody wrote a changelog for, a tag that already exists.

set -euo pipefail

cd "$(dirname "$0")/.."

ASSUME_YES=0
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) VERSION="$arg" ;;
  esac
done

PACKAGE_VERSION=$(node -p 'require("./package.json").version')
VERSION="${VERSION:-$PACKAGE_VERSION}"
TAG="v${VERSION}"

fail() { echo "✗ $1" >&2; exit 1; }

# The version has to be the one that was merged, or the published package and
# the tag disagree about what this release is.
[ "$VERSION" = "$PACKAGE_VERSION" ] || \
  fail "package.json is at $PACKAGE_VERSION, not $VERSION. Merge the version bump first."

# A release is cut from main. Tagging anywhere else points the release at a
# commit that is not what the merge queue built and npm will publish.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || fail "on branch $BRANCH, not main."

[ -z "$(git status --porcelain)" ] || fail "working tree is dirty. Commit or stash first."

git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] || \
  fail "local main is not origin/main. Pull, so the tag lands on the merge commit."

grep -q "## \[${VERSION}\]" CHANGELOG.md || \
  fail "CHANGELOG.md has no ## [${VERSION}] section. Write the release notes first."

# `npm version` writes the version to package-lock.json as well, so the two agree
# whenever the bump was made with it. Editing package.json by hand leaves the
# lockfile a version behind, and nothing downstream says so: `npm ci` compares
# dependencies and ignores the root version, so CI passes and the release ships
# with a lockfile describing the version before it. This is the only check on it.
# (bun.lock records the root's name and no version, so there is nothing to check.)
LOCK_VERSION=$(node -p 'require("./package-lock.json").version')
[ "$LOCK_VERSION" = "$VERSION" ] || \
  fail "package-lock.json is at $LOCK_VERSION, not $VERSION. Run 'npm install --package-lock-only' and commit it."

git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null && \
  fail "tag ${TAG} already exists locally. Delete it, or pick another version."
git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1 && \
  fail "tag ${TAG} already exists on origin. This release has already been cut."

echo "Releasing ${TAG}"
echo "  commit  $(git log -1 --format='%h %s')"
echo "  npm     $(node -p 'require("./package.json").name')@${VERSION}"
echo ""
echo "Pushing the tag builds signed binaries for every platform, creates the"
echo "GitHub Release and publishes to npm. It cannot be taken back cleanly."
echo ""

if [ "$ASSUME_YES" -eq 0 ]; then
  read -r -p "Push ${TAG}? [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Nothing pushed."; exit 0 ;;
  esac
fi

git tag "$TAG"
git push origin "$TAG"

echo ""
echo "✓ Pushed ${TAG}"
echo "  https://github.com/IntelligentElectron/universal-netlist/actions"
