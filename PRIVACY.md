# Privacy Policy

**Effective date:** 30 October 2026

Universal Netlist MCP Server ("the server") is a local program. It runs on your
own machine, reads design files from your own disk, and answers questions about
them through the MCP client you connect it to.

The author operates no service, no account system, and no backend. Nothing you
query is sent to the author.

## What the server collects

**Nothing for the author.** The server has no account, no API key, no licence
check, and no usage reporting.

It keeps no record of its use by default. See
[OpenTelemetry](#network-connections-the-server-makes) for the telemetry you can
turn on yourself.

Versions before this policy's effective date kept a local log, `telemetry.jsonl`,
holding your operating system account name, host name, and tool arguments.
Current versions neither write nor read that file. A copy left on your disk stays
there until you delete it, or until `uninstall` removes it from the installer's
directory.

## What the server reads

The server reads the EDA design files you point it at, and the directories you
ask it to search:

- Cadence `.DSN` schematics
- Altium `.PrjPcb` projects and `.SchDoc` documents
- KiCad `.kicad_pro` projects, `.kicad_sch` schematics, and `.net` exports

It reads these from your local filesystem, on demand, when a tool is called. It
holds their contents in memory for the life of the query. It writes nothing back
to them.

For a password-protected OrCAD design it also reads the passwords you give it
through its environment (`UNIVERSAL_NETLIST_DSN_PASSWORD` or the file
`UNIVERSAL_NETLIST_DSN_PASSWORD_FILE` names). It uses them in memory to decrypt
the design and passes them to nothing else: not in tool results, not to
telemetry, and not to the programs it starts. They remain where you stored
them, readable by software running under your account.

## Where your design data goes

**To your MCP client, and therefore to that client's model provider.** This is
the point of the server, and it is the most important thing to understand about
it.

When you ask your AI assistant about a design, the server returns the relevant
component, net, and connectivity data to the client you connected, such as
Claude Code, the Claude desktop app, or another MCP client. That client sends it on to
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

**2. OpenTelemetry (off by default).** The server and its command line can emit
traces, metrics, and logs about tool calls and commands. This is off until you
ask for an export, and the data goes **only where you direct it**: the OTLP
endpoint you set, which is your own observability backend, or the local directory
you name in `UNIVERSAL_NETLIST_OTEL_DIR`, in which case it makes no connection.
It is never sent to the author. A package built by someone else can carry its own
default endpoint; that is the packager's choice, `OTEL_SDK_DISABLED=true` turns
it off, and the official releases carry none. Exports honour your `HTTPS_PROXY`,
`HTTP_PROXY`, and `NO_PROXY`. What telemetry contains:

- Tool and command names, durations, exit codes, and success or failure
- Human-readable failure messages, which can contain file paths or fragments of tool input
- `user.name` and `enduser.id`, both your host operating system account name
- The process id of a command
- The id of an MCP request, the protocol version it used, and any trace context your
  agent sent with it
- Arguments, **only** if you additionally set `UNIVERSAL_NETLIST_CAPTURE_ARGS=true`,
  or, for tool calls, `OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT`.
  These include the file paths and search patterns you passed.
- A design's path relative to a root you choose, **only** if you set
  `UNIVERSAL_NETLIST_DESIGN_ROOT`. An absolute path is never recorded this way.
- Host and process details, including the whole command line, **only** if you ask
  the OpenTelemetry SDK for them with `OTEL_NODE_RESOURCE_DETECTORS`

Setting `OTEL_SDK_DISABLED=true` forces it off, whatever else is configured. Only
`true`, in any case, does this, as the OpenTelemetry specification requires: `1`
does not, and the server warns on stderr when it sees another value.

## Writing to your disk

All registered MCP tools are annotated as read-only and leave source designs unchanged.
A KiCad query may generate a temporary netlist, which is removed after reading.
When you set `UNIVERSAL_NETLIST_OTEL_DIR`, telemetry is appended to files in that
directory, readable only by your account. Commands you run by hand write to disk:
`export_design` writes a `.netlist.json` file, and `update` replaces the standalone
binary. `uninstall` removes the standalone binary and the PATH entries in your shell
profile; in the installer's `universal-netlist/bin/` directory it also removes a
`telemetry.jsonl` an earlier version left beside `bin/`, and elsewhere it names the
one it leaves there.

## Third parties

The author shares nothing, because the author receives nothing. The third
parties that can receive data are the ones you choose and connect:

| Party | What they receive | When |
|---|---|---|
| Your MCP client and its model provider | The design data returned by your queries | Whenever you query a design |
| GitHub | IP address and User-Agent of an update check | Binary startup |
| Your own OTLP backend | Tool call and command telemetry | Only if you configure an export |

## Retention

The server keeps parsed design data in memory only while serving your request,
and that memory is released when the process exits. Telemetry files you asked for
in `UNIVERSAL_NETLIST_OTEL_DIR` stay on your disk, growing with every call, until
you delete them.
Anything else retained is retained by your MCP client, your model provider, or
your telemetry backend, under their own policies.

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
