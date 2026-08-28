#!/bin/bash
#
# Tag the current main commit and start the complete release pipeline.
#
#   scripts/tag-release.sh 1.8.0
#   scripts/tag-release.sh v1.8.0 --yes
#
# The tag is the release version. The workflow runs CI, stamps that version into
# the npm tarball and binaries, generates release notes from merged pull
# requests, signs the binaries, creates the GitHub Release, and publishes npm.

set -euo pipefail

cd "$(dirname "$0")/.."

ASSUME_YES=0
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *)
      [ -z "$VERSION" ] || { echo "pass one version only" >&2; exit 2; }
      VERSION="${arg#v}"
      ;;
  esac
done

fail() { echo "✗ $1" >&2; exit 1; }

[ -n "$VERSION" ] || fail "usage: scripts/tag-release.sh <major.minor.patch> [--yes]"

# Accept SemVer release and prerelease tags. GitHub generated notes use the tag
# as their comparison boundary, and npm uses the same value as the package
# version, so reject an ambiguous tag before it becomes public.
if ! [[ "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
  fail "v$VERSION is not a semantic version such as v1.8.0 or v1.8.0-rc.1."
fi
TAG="v${VERSION}"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || fail "on branch $BRANCH, not main."
[ -z "$(git status --porcelain)" ] || fail "working tree is dirty. Commit or stash first."

git fetch --quiet origin main --tags
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] || fail "local main is not origin/main. Pull before tagging."

git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null && \
  fail "tag ${TAG} already exists. This release has already been cut."

echo "Releasing ${TAG}"
echo "  commit  $(git log -1 --format='%h %s')"
echo "  npm     $(node -p 'require("./package.json").name')@${VERSION}"
echo ""
echo "The tag runs CI, publishes the CI-built npm package, signs the binaries,"
echo "generates release notes, and creates the GitHub Release."
echo ""

if [ "$ASSUME_YES" -eq 0 ]; then
  read -r -p "Push ${TAG}? [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Nothing pushed."; exit 0 ;;
  esac
fi

git tag -a "$TAG" -m "Release $TAG"
git push origin "$TAG"

echo ""
echo "✓ Pushed ${TAG}"
echo "  https://github.com/IntelligentElectron/universal-netlist/actions"
