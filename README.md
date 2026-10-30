![Universal Netlist: connecting electronic schematics to AI-assisted circuit analysis](https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/banner.svg)

# Universal Netlist MCP Server

The **Universal Netlist MCP Server** gives AI agents the tools to understand and analyze your electrical schematics, for powerful and comprehensive design reviews through natural conversations.

It reads Cadence, Altium, and KiCad design files directly on macOS, Linux, and Windows, with no Cadence or Altium installation and no EDA license required.

## Supported Formats

| Format | Input Files | Description |
|--------|------------|-------------|
| Cadence (OrCAD / CIS) | `.DSN` schematic | Reads the binary schematic directly, including each part's own Do Not Stuff state and the selectable CIS BOM design variants. A design saved in an older Capture format (Library stream version below 3) is listed as unsupported and refused with a message naming its version; re-save it in a newer Capture to read it |
| Altium Designer | `.SchDoc` | Altium schematic documents, discovered via `.PrjPcb` project files; sheets are joined through ports, sheet entries and buses under the project's net identifier scope, with selectable design variants (Not Fitted rows, alternate parts, and parameter overrides) |
| KiCad | `.kicad_pro` (or root `.kicad_sch`) | Reads a committed `.net` export, or else the schematics themselves (KiCad 6 to 10, no KiCad install needed), with `kicad-cli` as the last resort; then applies a selected design variant from the schematic's own instance blocks. See [the KiCad schematic reader](docs/kicad-schematic-reader.md) |
| Universal Netlist Format | `.netlist.json` | The open [JSON format](https://github.com/IntelligentElectron/universal-netlist/blob/main/docs/schemas/universal-netlist.md) for netlists |

## Install

Installing takes two steps: the `universal-netlist` binary, then the plugin for your agent. The plugin connects the MCP server to the agent, so there is no configuration to write.

### 1. Install the binary

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/install.ps1 | iex
```

The installer provides:
- **No dependencies**: a standalone binary, with no Node.js required
- **Auto-updates**: the binary checks for updates on startup; `universal-netlist update` updates it on demand
- **Signed binaries**: macOS binaries are notarized by Apple

It places the binary in the `bin/` folder of `~/Library/Application Support/universal-netlist/` (macOS), `~/.local/share/universal-netlist/` (Linux) or `%LOCALAPPDATA%\universal-netlist\` (Windows), and adds that folder to your PATH in both your shell's startup file and its login profile, so apps started outside a terminal, such as the Claude desktop app, find it too. Restart your agent afterwards. If you installed before the login-profile entry existed, run the installer again: it adds only what is missing.

<details>
<summary>Install with npm instead</summary>

```bash
npm install -g @intelligentelectron/universal-netlist
```

Requires Node.js 22.15+. Update with `npm update -g @intelligentelectron/universal-netlist`.

Install the binary one way only: the plugin runs the first `universal-netlist` on your PATH.

</details>

### 2. Install the plugin

#### Claude Code

```
/plugin marketplace add IntelligentElectron/universal-netlist
/plugin install universal-netlist@universal-netlist
```

Local sessions in the Code tab of the [Claude desktop app](https://claude.ai/download) use Claude Code's plugins, so the server is available there too.

#### OpenAI Codex

```bash
codex plugin marketplace add IntelligentElectron/universal-netlist --sparse .agents/plugins --sparse plugins
codex plugin add universal-netlist@universal-netlist
```

The `--sparse` paths fetch only the plugin; Codex otherwise clones the whole repository, test fixtures included, which takes minutes. The plugin works in the Codex CLI and the Codex app.

Then ask the agent to review a schematic, trace a net, or check a design.

#### Other agents

<details>
<summary>Cursor</summary>

Open **Customize**, choose **Browse Marketplace**, then **Add Marketplace → Import from GitHub**. Enter `IntelligentElectron/universal-netlist` and add the `universal-netlist` plugin.

</details>

<details>
<summary>GitHub Copilot CLI</summary>

```bash
copilot plugin marketplace add IntelligentElectron/universal-netlist
copilot plugin install universal-netlist@universal-netlist
```

</details>

<details>
<summary>Turn the plugin on for everyone who clones a project</summary>

Add this to the project's `.claude/settings.json`:

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
sparse_paths = [".agents/plugins", "plugins"]

[plugins."universal-netlist@universal-netlist"]
enabled = true
```

Each person still installs the binary once.

</details>

<details>
<summary>Moving from a server you registered by hand</summary>

If you registered the server yourself before, remove that registration so the agent does not run two copies:

```bash
claude mcp remove --scope user universal-netlist
```

```bash
codex mcp remove universal-netlist
```

</details>

<details>
<summary>The command line, for agents without MCP</summary>

Every MCP tool is also a shell command, for an agent in a sandbox or container that cannot connect an MCP server:

```bash
universal-netlist search_nets board.DSN --pattern '^VCC'
```

The plugin carries a skill that teaches an agent those commands, their flags and exit codes, and the parse cache; the agent uses it only when the MCP server is not connected. Agents that read [Agent Skills](https://agentskills.io) can install the skill alone through the GitHub CLI:

```bash
gh skill install IntelligentElectron/universal-netlist universal-netlist --agent github-copilot --scope user
```

`--agent` takes `opencode`, `amp`, `goose` and the other names `gh skill install --help` lists. See [docs/cli.md](docs/cli.md#query-tools) for the command line itself.

</details>

## Observability (OpenTelemetry)

The server can emit [OpenTelemetry](https://opentelemetry.io/) **traces, metrics, and logs** for every tool call, which report which tools are used, how long they take, and what fails. Any OTLP-compatible backend receives them (an OpenTelemetry Collector, Jaeger, Tempo, Prometheus, Honeycomb, Datadog, or a managed cloud tracing service).

OpenTelemetry is **disabled by default** and is enabled and configured through the standard `OTEL_*` environment variables, with no code changes. Separately, the server keeps a [local usage log](docs/observability.md#local-usage-log) on your disk.

See **[Observability (OpenTelemetry)](docs/observability.md)** for setup, configuration, and the full list of emitted spans, metrics, and logs.

## Documentation

See [docs/](docs/README.md) for API documentation, response schemas and [supported platforms](docs/README.md#supported-platforms), [docs/cli.md](docs/cli.md) for the binary's command line, [docs/library.md](docs/library.md) for calling the tools in-process from your own code, [docs/parse-cache.md](docs/parse-cache.md) for how parses are reused between queries, and [docs/password-protected-designs.md](docs/password-protected-designs.md) for OrCAD designs saved with a password.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Privacy Policy

The server runs on your machine and sends the author nothing; it keeps a local usage log on your disk. The full policy is [PRIVACY.md](PRIVACY.md).

## About

This project is hosted on GitHub under the [IntelligentElectron](https://github.com/IntelligentElectron) organization.

Universal Netlist MCP Server and the universal netlist open standard are original works by [Valentino Zegna](https://www.linkedin.com/in/valentinozegna).

## Acknowledgments

The Cadence DSN binary parser is a TypeScript port of
[OpenOrCadParser](https://github.com/Werni2A/OpenOrCadParser) by Dominik
Wernberger. Their work reverse-engineering the OrCAD binary format made
direct schematic parsing possible.

## License

Apache License 2.0 - see [LICENSE](LICENSE)
