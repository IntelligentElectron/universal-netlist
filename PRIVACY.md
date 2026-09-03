# Privacy Policy

**Effective date:** 2 September 2026

Universal Netlist MCP Server ("the server") is a local program. It runs on your
own machine, reads design files from your own disk, and answers questions about
them through the MCP client you connect it to.

The author operates no service, no account system, and no backend. Nothing you
query is sent to the author.

## What the server collects

**Nothing.** The server has no telemetry of its own, no account, no API key, no
licence check, and no usage reporting. It stores no data about you.

## What the server reads

The server reads the EDA design files you point it at, and the directories you
ask it to search:

- Cadence `.DSN` schematics
- Altium `.PrjPcb` projects and `.SchDoc` documents
- KiCad `.kicad_pro` projects, `.kicad_sch` schematics, and `.net` exports

It reads these from your local filesystem, on demand, when a tool is called. It
holds their contents in memory for the life of the query. It writes nothing back
to them.

## Where your design data goes

**To your MCP client, and therefore to that client's model provider.** This is
the point of the server, and it is the most important thing to understand about
it.

When you ask your AI assistant about a design, the server returns the relevant
component, net, and connectivity data to the client you connected, such as
Claude Desktop, Claude Code, or another MCP client. That client sends it on to
its model provider as part of your conversation. What that provider does with it
is governed by their privacy policy and your agreement with them, not by this
one.

If your schematics are confidential, treat querying them the same way you would
treat pasting them into that assistant's chat window, because that is what
happens.

## Network connections the server makes

The server makes no network connection in order to read a design. It parses
every supported format locally. Two connections can occur, and neither carries
design data:

**1. Update check (standalone binary only).** On startup the compiled binary
requests
`https://api.github.com/repos/IntelligentElectron/universal-netlist/releases/latest`
to see whether a newer release exists, and downloads it if so. GitHub receives
what any HTTP request reveals: your IP address and a `User-Agent` naming the
program and its version. No design data, filename, or path is sent. Installs via
npm and runs from source do not check for updates.

**2. OpenTelemetry (off by default).** The server can emit traces, metrics, and
logs about tool calls. This is disabled unless you set an `OTEL_*` endpoint, and
when you enable it the data goes **to the endpoint you configure**, which is
your own observability backend. It is never sent to the author. What it contains:

- Tool names, durations, and success or failure
- Human-readable failure messages, which can contain file paths or fragments of tool input
- `enduser.id`, your host operating system account name
- Tool arguments, **only** if you additionally set `OTEL_CAPTURE_TOOL_ARGS`.
  These include the file paths and search patterns you passed.

Setting `OTEL_SDK_DISABLED=1` forces it off even when an endpoint is configured.

## Writing to your disk

All registered MCP tools are annotated as read-only and leave source designs unchanged.
A KiCad query may generate a temporary netlist, which is removed after reading.
The Cadence exporter is dormant in MCP. The separate CLI `coverage` command can
still invoke it on Windows to create or replace reference netlists beside a
schematic. CLI reports and exports write to disk when you run those commands.

## Third parties

The author shares nothing, because the author receives nothing. The third
parties that can receive data are the ones you choose and connect:

| Party | What they receive | When |
|---|---|---|
| Your MCP client and its model provider | The design data returned by your queries | Whenever you query a design |
| GitHub | IP address and User-Agent of an update check | Binary startup |
| Your own OTLP backend | Tool call telemetry | Only if you configure `OTEL_*` |

## Retention

The server retains nothing. It keeps parsed design data in memory only while
serving your request, and that memory is released when the process exits.
Anything retained is retained by your MCP client, your model provider, or your
telemetry backend, under their own policies.

## Children

The server is a professional engineering tool and is not directed at children.

## Changes

Material changes to this policy will be recorded in the GitHub Release notes and in
this file's effective date. The current version always lives at
<https://github.com/IntelligentElectron/universal-netlist/blob/main/PRIVACY.md>.

## Contact

Questions about this policy, or a privacy concern:

- Open an issue: <https://github.com/IntelligentElectron/universal-netlist/issues>
- Email: valentino.zegna@gmail.com
