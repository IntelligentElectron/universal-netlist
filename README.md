![Universal Netlist: connecting electronic schematics to AI-assisted circuit analysis](https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/banner.svg)

# Universal Netlist MCP Server

The **Universal Netlist MCP Server** gives AI agents the tools to understand and analyze your electrical schematics, for powerful and comprehensive design reviews through natural conversations.

It reads Cadence, Altium, and KiCad design files directly on macOS, Linux, and Windows, with no Cadence or Altium installation and no EDA license required.

## Supported Formats

| Format | Input Files | Description |
|--------|------------|-------------|
| Cadence (OrCAD / CIS) | `.DSN` schematic | Reads the binary schematic directly, including each part's own Do Not Stuff state and the selectable CIS BOM design variants. A design saved in an older Capture format (Library stream version below 3) is listed as unsupported and refused with a message naming its version; re-save it in a newer Capture to read it |
| Altium Designer | `.SchDoc` | Altium schematic documents, discovered via `.PrjPcb` project files; sheets are joined through ports, sheet entries and buses under the project's net identifier scope, with selectable design variants (Not Fitted rows, alternate parts, and parameter overrides) |
| KiCad | `.kicad_pro` (or root `.kicad_sch`) | Reads a committed `.net` export, or generates one with `kicad-cli`, then applies a selected design variant from the schematic's own instance blocks |
| Universal Netlist Format | `.netlist.json` | The open [JSON format](https://github.com/IntelligentElectron/universal-netlist/blob/main/docs/schemas/universal-netlist.md) for netlists |

## Native Install (Recommended)

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/install.ps1 | iex
```

The native installer provides:
- **No dependencies**: a standalone binary, with no Node.js required
- **Auto-updates**: the binary checks for updates on startup
- **Signed binaries**: macOS binaries are notarized by Apple

The installer places the binary in the `bin/` folder of:

| Platform | Install Directory |
|----------|-------------------|
| macOS | `~/Library/Application Support/universal-netlist/` |
| Linux | `~/.local/share/universal-netlist/` |
| Windows | `%LOCALAPPDATA%\universal-netlist\` |

### Update

The server checks for updates on startup. To update manually:

```bash
universal-netlist update
```


## Alternative: Install via npm

For developers who prefer npm:

```bash
npm install -g @intelligentelectron/universal-netlist
```

Or use with npx (no installation required):

```bash
npx @intelligentelectron/universal-netlist help
```

Requires Node.js 20+.

To update:

```bash
npm update -g @intelligentelectron/universal-netlist
```

## Connect the server to an AI agent

After installing the server with one of the methods above, register it with the agent you use.

### Claude Code and the Claude desktop app

Install the [Claude Code](https://code.claude.com/docs) CLI, then run:

```bash
claude mcp add --scope user universal-netlist -- universal-netlist
```

Local sessions in the Code tab of the [Claude desktop app](https://claude.ai/download) use the MCP servers Claude Code registers, so the server is available there too.

### OpenAI Codex

Install [OpenAI Codex](https://developers.openai.com/codex/cli/), then run:

```bash
codex mcp add universal-netlist -- universal-netlist
```

## Agent plugin: the command line without MCP

Every MCP tool is also a shell command, for an agent in a sandbox or container that cannot connect an MCP server:

```bash
universal-netlist search_nets board.DSN --pattern '^VCC'
```

The `universal-netlist` plugin carries one skill that teaches an agent those commands, their flags and exit codes, and the parse cache. Install the binary first ([Native Install](#native-install-recommended) or [npm](#alternative-install-via-npm)), then the plugin for the agent you use. Agents connected to the MCP server use its tools and don't need the plugin.

Claude Code:

```
/plugin marketplace add IntelligentElectron/universal-netlist
/plugin install universal-netlist@universal-netlist
```

Codex:

```
codex plugin marketplace add IntelligentElectron/universal-netlist
codex plugin add universal-netlist@universal-netlist
```

Both commands clone this repository. To fetch only the plugin, add a sparse checkout to the marketplace command: `--sparse .claude-plugin plugins` for Claude Code, `--sparse .agents/plugins --sparse plugins` for Codex.

Cursor: open **Customize**, import `https://github.com/IntelligentElectron/universal-netlist` with **From GitHub Repository**, and install `universal-netlist`.

Gemini CLI:

```
gemini skills install https://github.com/IntelligentElectron/universal-netlist.git --path plugins/universal-netlist/skills/universal-netlist
```

GitHub Copilot, and the other agents that read [Agent Skills](https://agentskills.io) (OpenCode, Amp, Goose, Cline and more), through the GitHub CLI:

```
gh skill install IntelligentElectron/universal-netlist universal-netlist --agent github-copilot --scope user
```

`--agent` takes `opencode`, `amp`, `goose` and the other names `gh skill install --help` lists.

To install it for everyone who clones a project, add this to the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "universal-netlist": {
      "source": { "source": "github", "repo": "IntelligentElectron/universal-netlist" }
    }
  },
  "enabledPlugins": { "universal-netlist@universal-netlist": true }
}
```

and this to the project's `.codex/config.toml`:

```toml
[marketplaces.universal-netlist]
source_type = "git"
source = "https://github.com/IntelligentElectron/universal-netlist.git"

[plugins."universal-netlist@universal-netlist"]
enabled = true
```

Then ask the agent to review a schematic, trace a net, or check a design. See [docs/cli.md](docs/cli.md#query-tools) for the command line itself.

## Supported Platforms

| Platform | Binary |
|----------|--------|
| macOS (Universal) | `universal-netlist-darwin-universal` |
| Linux (x64) | `universal-netlist-linux-x64` |
| Linux (ARM64) | `universal-netlist-linux-arm64` |
| Windows (x64) | `universal-netlist-windows-x64.exe` |

## Observability (OpenTelemetry)

The server can emit [OpenTelemetry](https://opentelemetry.io/) **traces, metrics, and logs** for every tool call, which report which tools are used, how long they take, and what fails. Any OTLP-compatible backend receives them (an OpenTelemetry Collector, Jaeger, Tempo, Prometheus, Honeycomb, Datadog, or a managed cloud tracing service).

OpenTelemetry is **disabled by default** and is enabled and configured through the standard `OTEL_*` environment variables, with no code changes. Separately, the server keeps a [local usage log](docs/observability.md#local-usage-log) on your disk.

See **[Observability (OpenTelemetry)](docs/observability.md)** for setup, configuration, and the full list of emitted spans, metrics, and logs.

## Documentation

See [docs/](docs/README.md) for API documentation and response schemas, [docs/cli.md](docs/cli.md) for the binary's command line, [docs/library.md](docs/library.md) for calling the tools in-process from your own code, [docs/parse-cache.md](docs/parse-cache.md) for how parses are reused between queries, and [docs/password-protected-designs.md](docs/password-protected-designs.md) for OrCAD designs saved with a password.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Privacy Policy

The server runs on your machine and sends the author nothing; it keeps a local usage log on your disk. The full policy is [PRIVACY.md](PRIVACY.md).

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
