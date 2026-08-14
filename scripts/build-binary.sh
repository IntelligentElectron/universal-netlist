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
# Environment:
#   VERSION  Version baked into the binary, default the one in package.json.
#
# Examples:
#   ./scripts/build-binary.sh bun-linux-x64 bin/universal-netlist-linux-x64
#   ./scripts/build-binary.sh host bin/universal-netlist packaged
#   VERSION=1.5.2-3 ./scripts/build-binary.sh host bin/universal-netlist packaged
#
# This compiles and nothing else: no git, no network, no signing, no
# publishing, no reading GITHUB_REF. The version comes from package.json,
# which is the single source of it — the release workflow validates the tag
# against package.json rather than deriving a version from the tag, so a
# build outside a tag push produces the same binary CI would. $VERSION is the
# one way to say otherwise, for a downstream packager stamping its own.
#
# Bun is the whole toolchain this needs. An image holding just the version in
# `.bun-version` builds this.

set -euo pipefail

TARGET="${1:-}"
OUTFILE="${2:-}"
# `-` rather than `:-`: an omitted third argument means "the default channel",
# but one passed as an empty string means the caller meant to name a channel and
# their variable was unset. Defaulting that to `github` is how a packaged build
# ends up self-updating in a prefix it does not own, so let it fail below.
CHANNEL="${3-github}"

if [ -z "$TARGET" ] || [ -z "$OUTFILE" ]; then
    echo "Usage: $0 <target> <outfile> [channel]" >&2
    echo "  e.g. $0 bun-linux-x64 bin/universal-netlist-linux-x64" >&2
    exit 1
fi

# Only `github` turns self-update on, so any other spelling — `packagd`, an
# empty string, tomorrow's channel name — produces a binary with self-update
# silently off. Reject it here, where the typo was made, rather than shipping a
# quietly degraded build that nothing downstream can tell apart from a good one.
case "$CHANNEL" in
    github | packaged) ;;
    *)
        echo "Unknown channel: $CHANNEL (expected 'github' or 'packaged')" >&2
        exit 1
        ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# A downstream packager stamping its own string (`1.5.2-3`, a snapshot date, a
# commit-derived name) sets $VERSION rather than patching a tracked file. Here
# `:-` rather than `-`, unlike the channel above: an unset caller variable falls
# back to a true upstream version, which is the behaviour every existing caller
# already has, where the same slip on the channel would arm self-update.
#
# Bun reads package.json because the compile below needs Bun anyway. Reading it
# with Node made a build fail on `node: command not found` in an environment
# that had installed every toolchain this repo declares.
VERSION="${VERSION:-$(bun -e "console.log(require('$PROJECT_DIR/package.json').version)")}"

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
