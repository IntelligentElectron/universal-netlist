# Universal Netlist MCP Server

The **Universal Netlist MCP Server** gives AI agents the power to understand and analyze your electrical schematics, for powerful and comprehensive design reviews through natural conversations.

It is compatible with Altium and Cadence, with plans to integrate more EDAs in the future. Note that you must already own a license of these EDAs to unleash the full capabilities of this MCP server.

## Supported Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| Cadence CIS | `.dsn` | Cadence Capture CIS schematic designs |
| Cadence HDL | `.cpm` | Cadence HDL schematic designs |
| Altium Designer | `.PrjPcb` | Altium Designer PCB projects |

## Quick Install

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/install.ps1 | iex
```

## Install via npm

```bash
npm install -g universal-netlist
```

Or use with npx (no installation required):

```bash
npx universal-netlist --help
```

**Note**: Requires Node.js 20+. For standalone binary, use install scripts above.

---

The installer downloads two files:

1. **Binary** - For CLI usage and manual MCP client configuration
2. **Claude Desktop extension** (.mcpb) - For easy Claude Desktop integration

| Platform | Install Directory |
|----------|-------------------|
| macOS | `~/Library/Application Support/universal-netlist/` |
| Linux | `~/.local/share/universal-netlist/` |
| Windows | `%LOCALAPPDATA%\universal-netlist\` |

## Update

The server checks for updates on startup. To update manually:

```bash
universal-netlist --update
```

## Connect the MCP with your favorite AI tool

### Claude Desktop (Recommended)

We recommend the [Claude Desktop app](https://claude.ai/download) for its simplicity, great features, and access to Anthropic's powerful Claude models.

1. Run the installer above (it downloads both the binary and `.mcpb` extension)
2. Open Claude Desktop and go to **Settings** (gear icon)
3. Under **Desktop app**, click **Extensions**
4. Click **Advanced settings**
5. In the **Extension Developer** section, click **Install Extension...**
6. Navigate to your install directory and select `universal-netlist.mcpb`:
   - **macOS**: `~/Library/Application Support/universal-netlist/universal-netlist.mcpb`
   - **Windows**: `%LOCALAPPDATA%\universal-netlist\universal-netlist.mcpb`

The extension will be available immediately in your conversations.

### Other AI Tools

As an alternative, the Universal Netlist MCP Server can be connected to any MCP-compatible AI tool. Below are configuration examples for popular options.

#### Claude Code

**Using npm global install (simplest):**

```bash
claude mcp add universal-netlist -- universal-netlist
```

**Using standalone binary:**

macOS:

```bash
claude mcp add universal-netlist -- ~/Library/Application\ Support/universal-netlist/bin/universal-netlist
```

Linux:

```bash
claude mcp add universal-netlist -- ~/.local/share/universal-netlist/bin/universal-netlist
```

Windows:

```cmd
claude mcp add universal-netlist -- %LOCALAPPDATA%\universal-netlist\bin\universal-netlist.exe
```

#### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` in your project.

**macOS:**

```json
{
  "servers": {
    "universal-netlist": {
      "type": "stdio",
      "command": "/Users/YOUR_USERNAME/Library/Application Support/universal-netlist/bin/universal-netlist"
    }
  }
}
```

**Linux:**

```json
{
  "servers": {
    "universal-netlist": {
      "type": "stdio",
      "command": "/home/YOUR_USERNAME/.local/share/universal-netlist/bin/universal-netlist"
    }
  }
}
```

**Windows:**

```json
{
  "servers": {
    "universal-netlist": {
      "type": "stdio",
      "command": "C:\\Users\\YOUR_USERNAME\\AppData\\Local\\universal-netlist\\bin\\universal-netlist.exe"
    }
  }
}
```

Then enable in **Configure Tools** (click the tools icon in Copilot chat).

#### Gemini CLI

Add to `~/.gemini/settings.json` (global) or `.gemini/settings.json` (project).

**macOS:**

```json
{
  "mcpServers": {
    "universal-netlist": {
      "command": "/Users/YOUR_USERNAME/Library/Application Support/universal-netlist/bin/universal-netlist"
    }
  }
}
```

**Linux:**

```json
{
  "mcpServers": {
    "universal-netlist": {
      "command": "/home/YOUR_USERNAME/.local/share/universal-netlist/bin/universal-netlist"
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "universal-netlist": {
      "command": "C:\\Users\\YOUR_USERNAME\\AppData\\Local\\universal-netlist\\bin\\universal-netlist.exe"
    }
  }
}
```

## Supported Platforms

| Platform | Binary |
|----------|--------|
| macOS (Intel) | `universal-netlist-darwin-x64` |
| macOS (Apple Silicon) | `universal-netlist-darwin-arm64` |
| Linux (x64) | `universal-netlist-linux-x64` |
| Linux (ARM64) | `universal-netlist-linux-arm64` |
| Windows (x64) | `universal-netlist-windows-x64.exe` |

## Documentation

See [docs/](docs/README.md) for API documentation and response schemas.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

---

## About

Created by **Valentino Zegna**

This project is hosted on GitHub under the [IntelligentElectron](https://github.com/IntelligentElectron) organization.

Universal Netlist MCP Server and the universal netlist open standard are original works by Valentino Zegna.

## License

Apache License 2.0 - see [LICENSE](LICENSE)
