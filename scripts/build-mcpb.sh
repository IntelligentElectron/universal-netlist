#!/bin/bash
#
# Build .mcpb desktop extension bundle for Claude Desktop
#
# Usage:
#   ./scripts/build-mcpb.sh [version]
#
# Expects binaries in the release/ directory:
#   - universal-netlist-darwin-arm64
#   - universal-netlist-darwin-x64
#   - universal-netlist-windows-x64.exe
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Get version from argument or manifest.json
VERSION="${1:-$(grep '"version"' "$PROJECT_DIR/manifest.json" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')}"

echo "📦 Building universal-netlist.mcpb v${VERSION}"

# Create temp directory for bundle
BUNDLE_DIR=$(mktemp -d)
trap "rm -rf '$BUNDLE_DIR'" EXIT

# Create server directory
mkdir -p "$BUNDLE_DIR/server"

# Copy manifest.json and update version
sed "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$PROJECT_DIR/manifest.json" > "$BUNDLE_DIR/manifest.json"

# Copy binaries
# MCPB convention: server/name for Unix, server/name.exe for Windows
# Claude Desktop auto-selects based on platform

RELEASE_DIR="${RELEASE_DIR:-$PROJECT_DIR/release}"

# Copy macOS binary - prefer universal for broad compatibility
if [ -f "$RELEASE_DIR/universal-netlist-darwin-universal" ]; then
    cp "$RELEASE_DIR/universal-netlist-darwin-universal" "$BUNDLE_DIR/server/universal-netlist"
    chmod +x "$BUNDLE_DIR/server/universal-netlist"
    echo "  ✓ Added macOS universal binary (arm64 + x64)"
elif [ -f "$RELEASE_DIR/universal-netlist-darwin-arm64" ]; then
    cp "$RELEASE_DIR/universal-netlist-darwin-arm64" "$BUNDLE_DIR/server/universal-netlist"
    chmod +x "$BUNDLE_DIR/server/universal-netlist"
    echo "  ⚠ Fallback: added macOS arm64-only binary (universal not available)"
fi

# Copy Windows binary
if [ -f "$RELEASE_DIR/universal-netlist-windows-x64.exe" ]; then
    cp "$RELEASE_DIR/universal-netlist-windows-x64.exe" "$BUNDLE_DIR/server/universal-netlist.exe"
    echo "  ✓ Added Windows binary"
fi

# Copy icon if exists
if [ -f "$PROJECT_DIR/icon.png" ]; then
    cp "$PROJECT_DIR/icon.png" "$BUNDLE_DIR/icon.png"
    echo "  ✓ Added icon"
fi

# Create the .mcpb bundle (ZIP archive)
OUTPUT_FILE="${OUTPUT_DIR:-$RELEASE_DIR}/universal-netlist.mcpb"
mkdir -p "$(dirname "$OUTPUT_FILE")"

cd "$BUNDLE_DIR"
zip -r "$OUTPUT_FILE" .

echo ""
echo "✅ Created $OUTPUT_FILE"
echo ""
echo "Bundle contents:"
unzip -l "$OUTPUT_FILE"
