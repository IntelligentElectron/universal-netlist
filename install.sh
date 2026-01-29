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
MCPB_NAME="universal-netlist.mcpb"

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
            echo "$HOME/.zshrc"
            ;;
        fish)
            echo "$HOME/.config/fish/config.fish"
            ;;
        *)
            echo "$HOME/.profile"
            ;;
    esac
}

# Add to PATH in shell rc file
add_to_path() {
    local install_dir="$1"
    local bin_dir="$install_dir/bin"
    local shell_rc
    shell_rc=$(get_shell_rc)
    local shell_name
    shell_name=$(basename "$SHELL")

    # Check if already in PATH
    if echo "$PATH" | grep -q "$bin_dir"; then
        info "Already in PATH"
        return 0
    fi

    # Check if already added to shell rc
    if grep -q "universal-netlist" "$shell_rc" 2>/dev/null; then
        info "PATH entry already exists in $shell_rc"
        return 0
    fi

    info "Adding to PATH in $shell_rc"

    if [ "$shell_name" = "fish" ]; then
        echo "" >> "$shell_rc"
        echo "# Universal Netlist MCP Server" >> "$shell_rc"
        echo "fish_add_path $bin_dir" >> "$shell_rc"
    else
        echo "" >> "$shell_rc"
        echo "# Universal Netlist MCP Server" >> "$shell_rc"
        echo "export PATH=\"$bin_dir:\$PATH\"" >> "$shell_rc"
    fi

    success "Added to PATH in $shell_rc"
}

# Main installation function
main() {
    local default_install_dir
    default_install_dir=$(get_default_install_dir)
    local install_dir="${UNIVERSAL_NETLIST_INSTALL_DIR:-$default_install_dir}"
    local version="${UNIVERSAL_NETLIST_VERSION:-}"
    local platform
    local download_url
    local mcpb_url
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
    mcpb_url="https://github.com/${REPO}/releases/download/${version}/${MCPB_NAME}"
    checksum_url="https://github.com/${REPO}/releases/download/${version}/checksums.txt"

    # Create installation directory
    mkdir -p "$install_dir/bin"
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

    # Download .mcpb package for Claude Desktop
    local mcpb_path="$install_dir/$MCPB_NAME"
    local mcpb_temp
    mcpb_temp=$(mktemp)
    trap "rm -f '$mcpb_temp' '$checksum_file'" EXIT

    if download "$mcpb_url" "$mcpb_temp" 2>/dev/null; then
        mv "$mcpb_temp" "$mcpb_path"
        success "Installed Claude Desktop extension to $mcpb_path"
    else
        warn "Could not download .mcpb package (Claude Desktop extension)"
    fi

    # Add to PATH
    add_to_path "$install_dir"

    # Print success message
    echo ""
    success "Installation complete!"
    echo ""
    echo "Installed files:"
    echo "  Binary: $binary_path"
    if [ -f "$mcpb_path" ]; then
        echo "  Claude Desktop extension: $mcpb_path"
    fi
    echo ""
    echo "To start using universal-netlist CLI, either:"
    echo "  1. Open a new terminal, or"
    echo "  2. Run: source $(get_shell_rc)"
    echo ""
    echo "Then verify with:"
    echo "  universal-netlist --version"
    echo ""
    echo "To update, run:"
    echo "  universal-netlist --update"
    echo ""
    echo "For Claude Desktop:"
    echo "  1. Open Claude Desktop -> Settings -> Extensions -> Advanced settings"
    echo "  2. Click 'Install Extension...' and select:"
    echo "     $mcpb_path"
    echo ""
}

main "$@"
