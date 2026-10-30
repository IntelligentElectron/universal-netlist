# Observability (OpenTelemetry)

The MCP server and the command line can emit [OpenTelemetry](https://opentelemetry.io/) **traces, metrics, and logs** for every tool call and command, so you can see what is used, how long it takes, and what fails. It is vendor-neutral and speaks OTLP, so it works with any OTLP-compatible backend (an OpenTelemetry Collector, Jaeger, Tempo, Prometheus, Honeycomb, Datadog, or a managed cloud tracing service), letting you integrate your own OTel service without any code changes.

## Overview

- **Disabled by default.** OpenTelemetry is a no-op with zero overhead until something asks for an export. The heavy SDK packages are not imported until then; only the lightweight OpenTelemetry API stubs are always present, and they are no-ops when telemetry is off.
- **Configured through the environment variables the specification defines**, read under its rules: only `true` is true, an empty variable is unset, and a value this program cannot honour gets a warning on stderr and is ignored. See [Where telemetry goes](#where-telemetry-goes) for the two variables this program adds.
- **Never affects results.** Every span, metric, and log operation is wrapped so that an exporter fault, misconfiguration, or unreachable backend degrades to "no telemetry" rather than an error, and a command keeps its output and exit code. Export failures stay off a command's stderr unless `OTEL_LOG_LEVEL` asks for them; the MCP server reports them on stderr.
- **Starts at the MCP request boundary.** Calls rejected by a tool's input schema are instrumented even though the SDK never invokes the tool handler. They are recorded as failures with the category `invalid_argument`, and their validation message identifies the offending argument.
- **stdout-safe.** stdout carries MCP and command results, so all diagnostics are written to stderr only and the `console` exporter is refused.

## Where telemetry goes

`OTEL_SDK_DISABLED=true` turns telemetry off, whatever else is set. Otherwise it stays dormant until one of these asks for an export:

- An OTLP endpoint: `OTEL_EXPORTER_OTLP_ENDPOINT`, or a per-signal `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `..._METRICS_ENDPOINT` or `..._LOGS_ENDPOINT`.
- An exporter selection of `otlp`: `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER` or `OTEL_LOGS_EXPORTER`. With no endpoint, this sends to the specification's default, `http://localhost:4318`.
- `UNIVERSAL_NETLIST_OTEL_DIR`, a local directory.
- A default endpoint a packager built into the binary. The official releases have none.

Then each signal goes to one place, chosen on its own:

| The signal's `OTEL_*_EXPORTER` | `UNIVERSAL_NETLIST_OTEL_DIR` | Destination |
|---|---|---|
| `none` | either | Nothing. If every signal is `none`, the SDK never loads. |
| `otlp` | either | OTLP |
| unset, or a value it cannot use | set | A file in that directory |
| unset, or a value it cannot use | unset | OTLP |

The golden tables behind this are in [decision-tables/otel-config](decision-tables/otel-config/destination.rules.md).

### OTLP

Exporters read the endpoint, headers, certificates, compression and timeout from the standard variables themselves. Each signal's own variable wins over the general one. The wire protocol is `http/protobuf` unless `OTEL_EXPORTER_OTLP_PROTOCOL` or `OTEL_EXPORTER_OTLP_<SIGNAL>_PROTOCOL` says `http/json`. `grpc` is not supported, and falls back to `http/protobuf` with a warning.

Exports go through your forward proxy when `HTTPS_PROXY` or `HTTP_PROXY` is set (or the lowercase forms), except for hosts in `NO_PROXY`. This works in the standalone binary and under Node.js 22.21 or later; older Node.js versions ignore the proxy.

### Files

`UNIVERSAL_NETLIST_OTEL_DIR`, best given as an absolute path since a relative one follows the working directory, writes the [OTLP File format](https://opentelemetry.io/docs/specs/otel/protocol/file-exporter/): OTLP JSON, one object per line. The format holds one signal per file, so the directory gets `traces.jsonl`, `metrics.jsonl` and `logs.jsonl`, created readable only by your account. Nothing leaves the machine, and a Collector's `otlpjsonfile` receiver can read them later. The specification defines this format but no variable naming a file, and it reserves the `OTEL_` prefix, so the variable carries this program's name. Files grow with every call; nothing rotates or trims them.

### From an agent plugin

An agent plugin does not hand `OTEL_*` variables to the server: Claude Code removes them from the
environment it passes on, and Codex passes none of yours. To export telemetry from an agent, register
the server yourself with the variables in its `env`, and leave the plugin's server off.

### Packaged builds

A packager can build defaults into a binary with `BUILD_OTEL_DEFAULTS`, a JSON object with any of `endpoint`, `protocol`, `resourceAttributes`, `proxy` and `designRoot`:

```bash
BUILD_OTEL_DEFAULTS='{"endpoint":"https://collector.example","proxy":"http://localhost:3128","designRoot":"~/designs","resourceAttributes":{"team":"eda"}}' \
  scripts/build-binary.sh bun-linux-x64 bin/universal-netlist-linux-x64 packaged
```

Each applies only when the environment provides no value, and `OTEL_SDK_DISABLED=true` still turns telemetry off. Headers are refused, so no credential is baked into a binary; set `OTEL_EXPORTER_OTLP_HEADERS` where it runs.

- `proxy` is a forward proxy for the OTLP exporters only, an `http` or `https` URL with no username or password. Other HTTP traffic, such as the updater, does not use it. Any of `HTTPS_PROXY`, `HTTP_PROXY` or their lowercase forms replaces it, and `NO_PROXY` still applies.
- `designRoot` is the value for `UNIVERSAL_NETLIST_DESIGN_ROOT` when that variable is empty, an absolute path or one starting with `~/`. A leading `~` expands to the home directory of the user running the binary, on every platform, so one value works for every user. The variable itself is read as written.

## Quick start with a local Collector / Jaeger

Run an all-in-one Jaeger (which accepts OTLP and renders traces) and point the server at it:

```bash
docker run --rm -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one:latest

export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=universal-netlist
# then start the MCP server or run a command; open http://localhost:16686 to view traces
```

## Plug in your own OTel service

To export to your own backend or a managed provider:

1. **Point at your endpoint:**

   ```bash
   export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.your-backend.example
   ```

2. **Add authentication** if your backend requires it, via headers:

   ```bash
   export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <token>"
   ```

3. **Optionally set the service name** (otherwise it defaults to `universal-netlist`):

   ```bash
   export OTEL_SERVICE_NAME=my-netlist-server
   ```

4. **Start the MCP server or run a command as usual.** Instrumentation is automatic: every tool call and command emits a span, metrics, and a log record.

## Configuration reference

These are the standard OpenTelemetry variables this program acts on.

| Variable | Purpose |
|----------|---------|
| `OTEL_SDK_DISABLED` | `true` (any case) forces telemetry off. Any other value has no effect, including `1`, and one other than `false` gets a warning. |
| `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` | `otlp` or `none`, per signal. See [Where telemetry goes](#where-telemetry-goes). Others, including `console`, get a warning and are ignored. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint to export to. `/v1/<signal>` is appended. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `..._METRICS_ENDPOINT`, `..._LOGS_ENDPOINT` | Per-signal endpoint, used as written. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers for the exporter, e.g. `Authorization=Bearer <token>` for a managed backend. Per-signal forms apply too. |
| `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_<SIGNAL>_PROTOCOL` | `http/protobuf` (default) or `http/json`. |
| `OTEL_EXPORTER_OTLP_TIMEOUT`, `..._CERTIFICATE`, `..._CLIENT_CERTIFICATE`, `..._CLIENT_KEY`, `..._COMPRESSION` | Exporter timeout, TLS files, and compression. Per-signal forms apply too. |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT` | Which signals carry a tool call's arguments: `NO_CONTENT`, `SPAN_ONLY`, `EVENT_ONLY` (the log record) or `SPAN_AND_EVENT`, in any case. Set, it decides over `UNIVERSAL_NETLIST_CAPTURE_ARGS` for tool calls; any other value captures nothing, with a warning. See [the golden table](decision-tables/otel-config/tool-args-capture.rules.md). |
| `OTEL_SERVICE_NAME` | Service name on the resource. Defaults to `universal-netlist`. |
| `OTEL_RESOURCE_ATTRIBUTES` | Additional resource identity attributes. |
| `OTEL_NODE_RESOURCE_DETECTORS` | The SDK's resource detectors, such as `host` or `process`. Unset, only the environment is read. |
| `OTEL_TRACES_SAMPLER` | Standard trace sampler configuration. |
| `OTEL_LOG_LEVEL` | The SDK's own diagnostics, always on stderr. Unset, the server reports warnings and errors, and a command reports only settings it could not honour. |
| `OTEL_BSP_SCHEDULE_DELAY`, `OTEL_BLRP_SCHEDULE_DELAY` | Batch span and log processor export intervals (ms). Their other standard settings apply too. |
| `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_METRIC_EXPORT_TIMEOUT` | Metric export interval and timeout (ms). The interval defaults to `60000`. |

These are this program's own, named outside the `OTEL_` prefix the specification reserves:

| Variable | Purpose |
|----------|---------|
| `UNIVERSAL_NETLIST_OTEL_DIR` | Write telemetry to [OTLP JSON Lines files](#files) in this directory. |
| `UNIVERSAL_NETLIST_CAPTURE_ARGS` | `true` also records raw arguments: `gen_ai.tool.call.arguments` for a tool call, `process.command_args` for a command. Off by default, since arguments may be sensitive. |
| `UNIVERSAL_NETLIST_DESIGN_ROOT` | Records `universal_netlist.design.path`, a design file's path relative to this directory. Unset, it is not recorded, unless a [packaged build](#packaged-builds) names a `designRoot`. A path outside the root, or a file without a design's extension, is not recorded either, so an absolute path never is. |
| `OTEL_CAPTURE_TOOL_ARGS` | Deprecated name for `UNIVERSAL_NETLIST_CAPTURE_ARGS`. It still takes `1` or `true`, with a warning, and the new name wins when both are set. |

## What gets emitted

An MCP tool call or a command produces one span, metrics, and one log record. A tool run from the command line is reported as a [command](#commands). An input-schema
rejection has the same telemetry shape as any other failed call, including duration.

### Tool call spans

Tool calls follow the [semantic conventions for MCP](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md), which are at Development status and may still change.

One span of kind `SERVER` per call, named `tools/call <tool_name>`. When the request's `params._meta` carries a `traceparent`, the span is a child of that trace; otherwise it starts one. The status is `ERROR` on failure, with the failure message as its description, and otherwise unset. Exceptions are recorded on the span.

| Attribute | Description |
|-----------|-------------|
| `mcp.method.name` | `tools/call`. |
| `gen_ai.operation.name` | `execute_tool`. |
| `gen_ai.tool.name` | The tool that was invoked. |
| `jsonrpc.request.id` | The id of the JSON-RPC request. |
| `mcp.protocol.version` | The MCP version negotiated with the client. |
| `network.transport` | `pipe`, for the stdio server. |
| `mcp.session.id` | The MCP session, when the transport has one. Stdio has none. |
| `error.type` | Present on failure: see [Tool call failures](#tool-call-failures). |
| `universal_netlist.error.category` | Present on failure: see [Tool call failures](#tool-call-failures). |
| `error.class` | Runtime exception class, present only when the handler throws an `Error`. Intended for debugging, not grouping. |
| `gen_ai.tool.call.arguments` | Full tool arguments as JSON text, since a span attribute cannot hold an object. Only present when [capture](#configuration-reference) asks for it. |
| `universal_netlist.design.path` | The design's path relative to `UNIVERSAL_NETLIST_DESIGN_ROOT`, or to a packaged build's `designRoot`. Only present when one of them is set and the path qualifies. |

### Tool call metrics

One histogram, `mcp.server.operation.duration`, in seconds, with the bucket boundaries the conventions give it. Its count is the number of calls, and `error.type` separates the failures, so no separate counters are needed.

Its labels are `mcp.method.name`, `gen_ai.operation.name`, `gen_ai.tool.name`, `mcp.protocol.version`, `network.transport` and, on failure, `error.type` and `universal_netlist.error.category`.

### Tool call failures

`universal_netlist.error.category` names the cause of every failure, from the closed vocabulary below. `error.type` is what the conventions ask for, which depends on how the failure reaches the client:

| The failure | `error.type` |
|-------------|--------------|
| An error in the content of a successful response, which is how this server's tools report one | The category |
| A result with `isError: true`, which the SDK creates for an input-schema rejection or an unknown tool | `tool_error` |
| A handler that throws, which the SDK turns into such a result | `tool_error` |

To group failures by cause, use `universal_netlist.error.category`. The rules are in [the golden table](decision-tables/otel-config/tool-error.rules.md).

| Value | Meaning |
|-------|---------|
| `invalid_argument` | The request, selection, or supplied design data is invalid, truncated, or unsupported. |
| `not_found` | A requested file, design, design variant, component, net, pin, MCP tool, or other resource does not exist. |
| `permission_denied` | Access was refused by the operating system, an upstream service, or a design's password protection. |
| `resource_exhausted` | A size, memory, storage, file-descriptor, or output-buffer limit was reached. |
| `cancelled` | The operation was cancelled or aborted. |
| `timeout` | The operation exceeded its time limit or deadline. |
| `unavailable` | A required service, platform, installation, network, or external tool is unavailable. |
| `internal` | The failure does not match another category and should be investigated as an implementation or classification gap. |

The same classifier is applied to thrown errors, returned MCP error results, and failed commands. These
values are telemetry API: changing or renaming one requires an explicit changelog entry.

### Tool call logs

One log record per call, with the event name `universal_netlist.tool_call.completed`, the body `tools/call <tool_name> succeeded` or `tools/call <tool_name> failed`, and severity `INFO` or `ERROR`. Its own trace context ties it to the span. Each record carries the span's attributes, plus:

| Attribute | Description |
|-----------|-------------|
| `error.message` | Human-readable failure message, present on failure when available and truncated to 2,048 characters. For MCP error results, this is the result's `error` field. |
| `user.name`, `enduser.id` | The host OS account name, mirroring the resource attributes below. Best-effort; omitted if it can't be read. |
| `gen_ai.tool.call.arguments` | Full tool arguments as a structured value, as the conventions require on a log record. Only present when [capture](#configuration-reference) asks for it. |

Log/label-based backends typically index only log-record attributes (resource attributes are dropped and span attributes are never carried), so the user attributes, failure messages, and captured arguments are set directly on each record to keep per-user, error, and per-input analytics possible from logs alone. Failure messages can contain file paths or fragments of tool input; they are exported whenever telemetry is enabled, on the span's status as well as the record. A call's duration is on the span and the histogram, and not on the record.

### Migrating from the earlier tool call names

Releases before this one used names of their own. They changed in one release, with no period of emitting both, so a dashboard or alert built on them needs this mapping:

| Earlier name | Current name |
|--------------|--------------|
| Span `tool/<tool_name>`, kind `INTERNAL` | Span `tools/call <tool_name>`, kind `SERVER` |
| Span status `OK` on success | Unset on success |
| `tool.name` | `gen_ai.tool.name` |
| `tool.outcome` = `success` | `error.type` absent |
| `tool.outcome` = `error` | `error.type` present |
| `tool.duration_ms` on the span | The span's own start and end times |
| `tool.duration_ms` on the log record | Removed; `mcp.server.operation.duration` |
| `tool.args` (JSON text) | `gen_ai.tool.call.arguments`: JSON text on the span, a structured value on the log record |
| `error.type` on an `isError` result or a throw | `error.type` = `tool_error`; the earlier value is `universal_netlist.error.category` |
| Metric `tool.duration`, milliseconds | Metric `mcp.server.operation.duration`, seconds: multiply a threshold by 0.001 |
| Metric `tool.calls` | The count of `mcp.server.operation.duration` |
| Metric `tool.errors` | The count of `mcp.server.operation.duration` with `error.type` present |
| Metric label `tool` | `gen_ai.tool.name` |
| Metric label `outcome` | `error.type` present or absent |
| Metric label `error_type` | `universal_netlist.error.category` |
| Log attributes `trace_id`, `span_id` | The log record's own trace context |
| Log body `tool/<tool_name> success` or `error` | `tools/call <tool_name> succeeded` or `failed` |

### Commands

Each command run from the shell follows the [semantic conventions for CLI programs](https://opentelemetry.io/docs/specs/semconv/cli/cli-spans/), and records `version`, `help`, `update`, `uninstall`, a tool's name, `export-json`, `export-telemetry` (which now only says it was removed), or `unknown` for a word that is no command. The word itself is never recorded as the name. Serving MCP is not a command, and is reported per tool call.

One span of kind `INTERNAL`, named `universal-netlist <command>`, the low-cardinality form the convention allows and asks to have documented. Its status is `ERROR` when the exit code is not 0, and otherwise unset.

| Attribute | Description |
|-----------|-------------|
| `process.executable.name` | `universal-netlist`. |
| `process.exit.code` | The exit code. |
| `process.pid` | The process id. |
| `universal_netlist.command` | The command, as above. |
| `error.type` | On a non-zero exit only: `invalid_argument` for the usage exit 2, otherwise a category from the closed set above. |
| `error.class` | Runtime exception class, when the command threw. |
| `process.command_args` | All arguments, starting with the executable. Only present when `UNIVERSAL_NETLIST_CAPTURE_ARGS` is enabled, as the convention asks. |
| `universal_netlist.design.path` | The design's path relative to `UNIVERSAL_NETLIST_DESIGN_ROOT`, or to a packaged build's `designRoot`. Only present when one of them is set and the path qualifies. |

One metric, a histogram `universal_netlist.command.duration` in seconds, with the labels `universal_netlist.command` and, on failure, `error.type`. Its count is the number of runs, and `error.type` separates the failures, so no separate counters are needed.

One log record, with the event name `universal_netlist.command.completed`, severity `INFO` or `ERROR`, and the body `universal-netlist <command> exited <code>`. It carries the span's attributes, `error.message` on failure, and the user attributes, and its own trace context ties it to the span.

The process flushes before it exits. A flush that takes more than 5 seconds is abandoned, so a stuck backend delays a command by at most that long, and the command keeps its exit code.

### Resource attributes

All telemetry — traces, metrics, and logs alike — is tagged with:

| Attribute | Description |
|-----------|-------------|
| `service.name` | `OTEL_SERVICE_NAME` if set, otherwise `universal-netlist`. |
| `service.version` | The server version. |
| `user.name` | The host OS account name of whoever is running the program, attributing usage to the per-session user. Best-effort; omitted if it can't be read. |
| `enduser.id` | The same value, for backends already indexing it. |

The SDK's only default resource detector here is the environment one, for `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_SERVICE_NAME`. `OTEL_NODE_RESOURCE_DETECTORS` asks for others, such as `host` and `process`; `process` records the whole command line on every export.

> **Privacy note:** `user.name` and `enduser.id` are your host OS account name. Whenever telemetry is enabled it is included in exported telemetry by default (best-effort, as above), including to any third-party or managed backend you export to. If that is undesirable, leave telemetry disabled (the default).

## Reliability

Telemetry is designed to be invisible to callers:

- Instrumentation never alters a tool's result or a command's output and exit code, and never throws on its own; a failing exporter or SDK degrades to "no telemetry".
- When unconfigured, the OpenTelemetry instrumentation path is a pure pass-through with zero overhead, and the SDK is never imported.
- Pending, batched exports are flushed on process shutdown, for at most 5 seconds, so short-lived invocations don't lose data. That covers a command finishing, `SIGINT`/`SIGTERM`, and the MCP server's client closing stdin, after which the server finishes any call in progress, flushes, and exits.

## See Also

- [Tool Documentation](tools/) — the tools that generate this telemetry
- [API Documentation](README.md) — overview and response schemas
