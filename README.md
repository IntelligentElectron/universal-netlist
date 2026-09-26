![Universal Netlist: connecting electronic schematics to AI-assisted circuit analysis](https://raw.githubusercontent.com/IntelligentElectron/universal-netlist/main/banner.svg)

# Universal Netlist MCP Server

The **Universal Netlist MCP Server** gives AI agents the tools to understand and analyze your electrical schematics, for powerful and comprehensive design reviews through natural conversations.

It is compatible with Cadence, Altium, and KiCad, with plans to integrate more EDAs in the future. It reads your design files directly on macOS, Linux, and Windows, with no Cadence or Altium installation and no EDA license required.

## Supported Formats

| Format | Input Files | Description |
|--------|------------|-------------|
| Cadence (OrCAD / CIS) | `.DSN` schematic | Reads the binary schematic directly, including each part's own Do Not Stuff state and the selectable CIS BOM design variants |
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

Why use the native installer:
- **No dependencies** — standalone binary, no Node.js required
- **Auto-updates** — checks for updates on startup
- **Signed binaries** — macOS binaries are notarized by Apple

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

## Connect the MCP with your favorite AI tool

After installing the MCP with one of the methods above, you can connect it to your AI agent of choice.

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

## Supported Platforms

| Platform | Binary |
|----------|--------|
| macOS (Universal) | `universal-netlist-darwin-universal` |
| Linux (x64) | `universal-netlist-linux-x64` |
| Linux (ARM64) | `universal-netlist-linux-arm64` |
| Windows (x64) | `universal-netlist-windows-x64.exe` |

## Observability (OpenTelemetry)

The server can emit [OpenTelemetry](https://opentelemetry.io/) **traces, metrics, and logs** for every tool call, so you can integrate your own OTel service and see which tools are used, how long they take, and what fails. It is vendor-neutral and works with any OTLP-compatible backend (an OpenTelemetry Collector, Jaeger, Tempo, Prometheus, Honeycomb, Datadog, a managed cloud tracing service, etc.).

OpenTelemetry is **disabled by default** with zero overhead, and is enabled and configured entirely through the standard `OTEL_*` environment variables — no code changes. Separately, the server keeps a [local usage log](docs/observability.md#local-usage-log) on your disk.

See **[Observability (OpenTelemetry)](docs/observability.md)** for setup, configuration, and the full list of emitted spans, metrics, and logs.

## Documentation

See [docs/](docs/README.md) for API documentation and response schemas, [docs/cli.md](docs/cli.md) for the binary's command line, and [docs/password-protected-designs.md](docs/password-protected-designs.md) for OrCAD designs saved with a password.

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
