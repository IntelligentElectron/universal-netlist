#!/usr/bin/env bash
#
# Universal Netlist MCP Server Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/install.sh | bash
#
# Environment variables:
#   UNIVERSAL_NETLIST_INSTALL_DIR  Installation directory
#   UNIVERSAL_NETLIST_VERSION      Specific version to install (default: latest)
#

set -euo pipefail

# Configuration
REPO="IntelligentElectron/universal-netlist"
BINARY_NAME="universal-netlist"

# Determine default install directory based on OS
get_default_install_dir() {
    case "$(uname -s)" in
        Darwin) echo "$HOME/Library/Application Support/universal-netlist" ;;
        *) echo "$HOME/.local/share/universal-netlist" ;;
    esac
}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
info() { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die() { error "$@"; exit 1; }

# Detect platform and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Darwin) os="darwin" ;;
        Linux) os="linux" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
        *) die "Unsupported operating system: $(uname -s)" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x64" ;;
        aarch64|arm64) arch="arm64" ;;
        *) die "Unsupported architecture: $(uname -m)" ;;
    esac

    # A shell running under Rosetta reports x86_64 on an Apple Silicon Mac.
    # hw.optional.arm64 reports the hardware, and an Intel Mac has no such key.
    if [ "$os" = "darwin" ] && [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = "1" ]; then
        arch="arm64"
    fi

    # Return platform string
    if [ "$os" = "windows" ]; then
        echo "${BINARY_NAME}-${os}-${arch}.exe"
    else
        echo "${BINARY_NAME}-${os}-${arch}"
    fi
}

# Get latest release version from GitHub
get_latest_version() {
    local url="https://api.github.com/repos/${REPO}/releases/latest"
    local version

    if command -v curl &>/dev/null; then
        version=$(curl -fsSL "$url" | grep '"tag_name":' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
    elif command -v wget &>/dev/null; then
        version=$(wget -qO- "$url" | grep '"tag_name":' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
    else
        die "Neither curl nor wget found. Please install one of them."
    fi

    if [ -z "$version" ]; then
        die "Failed to determine latest version. Please check https://github.com/${REPO}/releases"
    fi

    echo "$version"
}

# Download a file
download() {
    local url="$1"
    local dest="$2"

    info "Downloading from $url"

    if command -v curl &>/dev/null; then
        curl -fsSL -o "$dest" "$url" || die "Download failed"
    elif command -v wget &>/dev/null; then
        wget -qO "$dest" "$url" || die "Download failed"
    else
        die "Neither curl nor wget found"
    fi
}

# Verify checksum
verify_checksum() {
    local file="$1"
    local expected="$2"
    local actual

    if command -v sha256sum &>/dev/null; then
        actual=$(sha256sum "$file" | cut -d' ' -f1)
    elif command -v shasum &>/dev/null; then
        actual=$(shasum -a 256 "$file" | cut -d' ' -f1)
    else
        warn "sha256sum not found, skipping checksum verification"
        return 0
    fi

    if [ "$actual" != "$expected" ]; then
        die "Checksum verification failed. Expected: $expected, Got: $actual"
    fi

    success "Checksum verified"
}

# Get shell configuration file
get_shell_rc() {
    local shell_name
    shell_name=$(basename "$SHELL")

    case "$shell_name" in
        bash)
            if [ -f "$HOME/.bashrc" ]; then
                echo "$HOME/.bashrc"
            elif [ -f "$HOME/.bash_profile" ]; then
                echo "$HOME/.bash_profile"
            else
                echo "$HOME/.bashrc"
            fi
            ;;
        zsh)
            echo "${ZDOTDIR:-$HOME}/.zshrc"
            ;;
        fish)
            echo "$HOME/.config/fish/config.fish"
            ;;
        *)
            echo "$HOME/.profile"
            ;;
    esac
}

# Get the login profile, which apps started outside a terminal (the Claude desktop
# app, an editor launched from the Dock) read for their PATH. Empty when the rc
# file already covers login shells.
get_login_profile() {
    local shell_name
    shell_name=$(basename "$SHELL")

    case "$shell_name" in
        bash)
            # bash reads the first of these that exists, so a new .bash_profile
            # would hide an existing .profile
            if [ -f "$HOME/.bash_profile" ]; then
                echo "$HOME/.bash_profile"
            elif [ -f "$HOME/.bash_login" ]; then
                echo "$HOME/.bash_login"
            else
                echo "$HOME/.profile"
            fi
            ;;
        zsh)
            echo "${ZDOTDIR:-$HOME}/.zprofile"
            ;;
    esac
}

# Add to PATH in the shell rc file and the login profile
add_to_path() {
    local install_dir="$1"
    local bin_dir="$install_dir/bin"
    local shell_name
    shell_name=$(basename "$SHELL")
    local shell_rc
    shell_rc=$(get_shell_rc)
    local login_profile
    login_profile=$(get_login_profile)
    if [ "$login_profile" = "$shell_rc" ]; then
        login_profile=""
    fi

    local file
    for file in "$shell_rc" "$login_profile"; do
        [ -n "$file" ] || continue

        if grep -qF "$bin_dir" "$file" 2>/dev/null; then
            info "PATH entry already exists in $file"
            continue
        fi

        info "Adding to PATH in $file"
        mkdir -p "$(dirname "$file")"

        if [ "$shell_name" = "fish" ]; then
            echo "" >> "$file"
            echo "# Universal Netlist MCP Server" >> "$file"
            echo "fish_add_path $bin_dir" >> "$file"
        else
            echo "" >> "$file"
            echo "# Universal Netlist MCP Server" >> "$file"
            echo "export PATH=\"$bin_dir:\$PATH\"" >> "$file"
        fi

        success "Added to PATH in $file"
    done
}

# Main installation function
main() {
    local default_install_dir
    default_install_dir=$(get_default_install_dir)
    local install_dir="${UNIVERSAL_NETLIST_INSTALL_DIR:-$default_install_dir}"
    local version="${UNIVERSAL_NETLIST_VERSION:-}"

    # Create installation directory early, before any network calls
    mkdir -p "$install_dir/bin"

    local platform
    local download_url
    local checksum_url
    local expected_checksum

    echo ""
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║     Universal Netlist MCP Server Installer        ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo ""

    # Detect platform
    platform=$(detect_platform)
    info "Detected platform: $platform"

    # Get version
    if [ -z "$version" ]; then
        info "Fetching latest version..."
        version=$(get_latest_version)
    fi
    info "Version: $version"

    # Construct download URLs
    download_url="https://github.com/${REPO}/releases/download/${version}/${platform}"
    checksum_url="https://github.com/${REPO}/releases/download/${version}/checksums.txt"

    info "Install directory: $install_dir"

    # Download binary
    local temp_file
    temp_file=$(mktemp)
    trap "rm -f '$temp_file'" EXIT

    download "$download_url" "$temp_file"

    # Download and verify checksum
    local checksum_file
    checksum_file=$(mktemp)
    trap "rm -f '$temp_file' '$checksum_file'" EXIT

    if download "$checksum_url" "$checksum_file" 2>/dev/null; then
        expected_checksum=$(grep "$platform" "$checksum_file" | cut -d' ' -f1)
        if [ -n "$expected_checksum" ]; then
            verify_checksum "$temp_file" "$expected_checksum"
        else
            warn "No checksum found for $platform, skipping verification"
        fi
    else
        warn "Checksums not available, skipping verification"
    fi

    # Install binary
    local binary_path="$install_dir/bin/$BINARY_NAME"
    mv "$temp_file" "$binary_path"
    chmod +x "$binary_path"
    success "Installed binary to $binary_path"

    # Add to PATH
    add_to_path "$install_dir"

    # Print success message
    echo ""
    success "Installation complete!"
    echo ""
    echo "To start using universal-netlist CLI, either:"
    echo "  1. Open a new terminal, or"
    echo "  2. Run: source $(get_shell_rc)"
    echo ""
    echo "Then verify with:"
    echo "  universal-netlist version"
    echo ""
    echo "To update, run:"
    echo "  universal-netlist update"
    echo ""
    echo "To connect your agent, install the universal-netlist plugin. In Claude Code:"
    echo "  /plugin marketplace add IntelligentElectron/universal-netlist"
    echo "  /plugin install universal-netlist@universal-netlist"
    echo "Codex, Cursor and other agents: https://github.com/IntelligentElectron/universal-netlist#install"
    echo ""
}

main "$@"
