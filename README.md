# Universal Netlist MCP Server

The **Universal Netlist MCP Server** gives AI agents the tools to understand and analyze your electrical schematics, for powerful and comprehensive design reviews through natural conversations.

It is compatible with Cadence, Altium, and KiCad, with plans to integrate more EDAs in the future. Note that the commercial EDAs (Cadence and Altium) require your own license to unleash the full capabilities of this MCP server; KiCad is free and open-source.

## Supported Formats

| Format | Input Files | Description |
|--------|------------|-------------|
| Cadence (CIS / HDL) | `.dat` netlist files | Exported Allegro netlist files (`pstxnet.dat`, `pstxprt.dat`, `pstchip.dat`) from Cadence Capture CIS or HDL designs |
| Altium Designer | `.SchDoc` | Altium schematic documents (discovered via `.PrjPcb` project files) |
| KiCad | `.kicad_pro` (or root `.kicad_sch`) | Reads a resolved `kicadsexpr` netlist export: a committed `.net` beside the project if present, otherwise generated on demand via `kicad-cli` (requires KiCad installed; set `KICAD_CLI_PATH` for a non-standard location) |

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

## Supported Platforms

| Platform | Binary |
|----------|--------|
| macOS (Universal) | `universal-netlist-darwin-universal` |
| Linux (x64) | `universal-netlist-linux-x64` |
| Linux (ARM64) | `universal-netlist-linux-arm64` |
| Windows (x64) | `universal-netlist-windows-x64.exe` |

## Observability (OpenTelemetry)

The server can emit [OpenTelemetry](https://opentelemetry.io/) **traces, metrics, and logs** for every tool call, so you can see which tools are used, how long they take, and what fails. It is vendor-neutral: it works with any OTLP-compatible backend (an OpenTelemetry Collector, Jaeger, Tempo, Prometheus, Honeycomb, Datadog, a managed cloud tracing service, etc.).

**Disabled by default.** Telemetry is a no-op with zero overhead unless you set an OTLP endpoint. Turn it on purely with the standard `OTEL_*` environment variables; no code changes and no bespoke config.

Each tool call emits:

- a span `tool/<tool_name>` with `tool.name`, `tool.outcome` (`success`/`error`), `tool.duration_ms`, and `error.type` on failure;
- metrics `tool.calls` (counter), `tool.duration` (ms histogram), and `tool.errors` (counter), labeled by `tool` and `outcome`;
- a structured log record carrying the active trace/span IDs for trace-to-log correlation.

All telemetry is tagged with `enduser.id`, the host OS account name of whoever is running the server, as a resource attribute (so it appears on traces, metrics, and logs). This attributes usage to the per-session user without any configuration.

### Quick start with a local Collector / Jaeger

Run an all-in-one Jaeger (which accepts OTLP and renders traces) and point the server at it:

```bash
docker run --rm -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one:latest

export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=universal-netlist
# then start the MCP server as usual; open http://localhost:16686 to view traces
```

### Configuration

Only standard OpenTelemetry environment variables are used:

| Variable | Purpose |
|----------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint to export to. **Setting this enables telemetry.** |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers for the exporter, e.g. `Authorization=Bearer <token>` for a managed backend. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (default) or `http/json`. `grpc` is not bundled in the standalone binaries and falls back to `http/protobuf`. |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | Resource identity. |
| `OTEL_SDK_DISABLED`, `OTEL_TRACES_SAMPLER`, ... | Standard OTel SDK knobs. |

Additional, clearly-scoped options:

- `OTEL_CAPTURE_TOOL_ARGS=1`: also record raw tool arguments on the span (off by default; arguments may be sensitive).

Telemetry never affects tool results: exporter failures, misconfiguration, or an unreachable backend degrade to "no telemetry", and pending data is flushed on shutdown.

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
