#!/bin/bash
#
# Compile one standalone universal-netlist binary with Bun.
#
# Usage:
#   ./scripts/build-binary.sh <target> <outfile> [channel]
#
#   target   A Bun compile target (bun-darwin-arm64, bun-darwin-x64,
#            bun-linux-arm64, bun-linux-x64, bun-windows-x64), or `host`
#            to compile for the machine running the script.
#   outfile  Path of the binary to write. Parent directories are created.
#   channel  Build channel baked into the binary, default `github`.
#            `github` self-updates from GitHub Releases; use `packaged`
#            for a build a package manager owns.
#
# Examples:
#   ./scripts/build-binary.sh bun-linux-x64 bin/universal-netlist-linux-x64
#   ./scripts/build-binary.sh host bin/universal-netlist packaged
#
# This compiles and nothing else: no git, no network, no signing, no
# publishing, no reading GITHUB_REF. The version comes from package.json,
# which is the single source of it — the release workflow validates the tag
# against package.json rather than deriving a version from the tag, so a
# build outside a tag push produces the same binary CI would.

set -euo pipefail

TARGET="${1:-}"
OUTFILE="${2:-}"
CHANNEL="${3:-github}"

if [ -z "$TARGET" ] || [ -z "$OUTFILE" ]; then
    echo "Usage: $0 <target> <outfile> [channel]" >&2
    echo "  e.g. $0 bun-linux-x64 bin/universal-netlist-linux-x64" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

VERSION="$(node -p "require('$PROJECT_DIR/package.json').version")"

mkdir -p "$(dirname "$OUTFILE")"

echo "Building $OUTFILE (target=$TARGET, version=$VERSION, channel=$CHANNEL)"

compile() {
    bun build \
        --compile \
        --minify \
        "$@" \
        --define BUILD_VERSION="\"$VERSION\"" \
        --define BUILD_CHANNEL="\"$CHANNEL\"" \
        "$PROJECT_DIR/src/index.ts" \
        --outfile "$OUTFILE"
}

# `host` means "whatever this machine is", which is what Bun does with no
# --target at all. Every other value is passed through untouched, so Bun
# reports an unknown target rather than this script guessing at one.
if [ "$TARGET" = "host" ]; then
    compile
else
    compile --target="$TARGET"
fi
