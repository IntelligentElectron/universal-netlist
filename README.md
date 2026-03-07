# Universal Netlist MCP Server

The **Universal Netlist MCP Server** gives AI agents the tools to understand and analyze your electrical schematics, for powerful and comprehensive design reviews through natural conversations.

It is compatible with Cadence and Altium, with plans to integrate more EDAs in the future. Note that you must already own a license of these EDAs to unleash the full capabilities of this MCP server.

## Supported Formats

| Format | Input Files | Description |
|--------|------------|-------------|
| Cadence (CIS / HDL) | `.dat` netlist files | Exported Allegro netlist files (`pstxnet.dat`, `pstxprt.dat`, `pstchip.dat`) from Cadence Capture CIS or HDL designs |
| Altium Designer | `.SchDoc` | Altium schematic documents (discovered via `.PrjPcb` project files) |

## Native Install (Recommended)

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/install.ps1 | iex
```

Why use the native installer:
- **No dependencies** — standalone binary, no Node.js required
- **Auto-updates** — checks for updates on startup
- **Signed binaries** — macOS binaries are notarized by Apple

The installer downloads two files:

1. **Binary** - For CLI usage and manual MCP client configuration
2. **Claude Desktop extension** (.mcpb) - For easy Claude Desktop integration

| Platform | Install Directory |
|----------|-------------------|
| macOS | `~/Library/Application Support/universal-netlist/` |
| Linux | `~/.local/share/universal-netlist/` |
| Windows | `%LOCALAPPDATA%\universal-netlist\` |

### Update

The server checks for updates on startup. To update manually:

```bash
universal-netlist --update
```

## Alternative: Install via npm

For developers who prefer npm:

```bash
npm install -g @intelligentelectron/universal-netlist
```

Or use with npx (no installation required):

```bash
npx @intelligentelectron/universal-netlist --help
```

Requires Node.js 20+.

To update:

```bash
npm update -g @intelligentelectron/universal-netlist
```

## Connect the MCP with your favorite AI tool

After installing the MCP with one of the methods above, you can connect it to your AI agent of choice.

### Claude Desktop

1. Download the [Claude Desktop app](https://claude.ai/download)
2. Open Claude Desktop and go to **Settings** (gear icon)
3. Under **Desktop app**, click **Extensions**
4. Click **Advanced settings**
5. In the **Extension Developer** section, click **Install Extension...**
6. Navigate to your install directory and select `universal-netlist.mcpb`:
   - **macOS**: `~/Library/Application Support/universal-netlist/universal-netlist.mcpb`
   - **Windows**: `%LOCALAPPDATA%\universal-netlist\universal-netlist.mcpb`

The extension will be available immediately in your conversations.

### Claude Code

Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code), then run:

```bash
claude mcp add --scope user universal-netlist -- universal-netlist
```

### OpenAI Codex

Install [OpenAI Codex](https://developers.openai.com/codex/cli/), then run:

```bash
codex mcp add universal-netlist -- universal-netlist
```

### Gemini CLI

Install [Gemini CLI](https://geminicli.com/docs/get-started/installation/), then run:

```bash
gemini mcp add --scope user universal-netlist universal-netlist
```

### VS Code (GitHub Copilot)

Download [VS Code](https://code.visualstudio.com/)

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "universal-netlist": {
      "type": "stdio",
      "command": "universal-netlist"
    }
  }
}
```

Then enable it in **Configure Tools** (click the tools icon in Copilot chat).

## Supported Platforms

| Platform | Binary |
|----------|--------|
| macOS (Universal) | `universal-netlist-darwin-universal` |
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

## Acknowledgments

The Cadence DSN binary parser is a TypeScript port of
[OpenOrCadParser](https://github.com/Werni2A/OpenOrCadParser) by Dominik
Wernberger. Their work reverse-engineering the OrCAD binary format made
direct schematic parsing possible.

## License

Apache License 2.0 - see [LICENSE](LICENSE)
