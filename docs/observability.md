# Observability (OpenTelemetry)

The server can emit [OpenTelemetry](https://opentelemetry.io/) **traces, metrics, and logs** for every tool call, so you can see which tools are used, how long they take, and what fails. It is vendor-neutral and speaks OTLP, so it works with any OTLP-compatible backend — an OpenTelemetry Collector, Jaeger, Tempo, Prometheus, Honeycomb, Datadog, or a managed cloud tracing service — letting you integrate your own Otel service without any code changes.

## Overview

- **Disabled by default.** Telemetry is a no-op with zero overhead unless you point it at an OTLP endpoint. The OpenTelemetry SDK is not even imported until it is configured.
- **Configured purely through standard `OTEL_*` environment variables.** No bespoke config and no code changes.
- **Never affects tool results.** Every span, metric, and log operation is wrapped so that an exporter fault, misconfiguration, or unreachable backend degrades to "no telemetry" rather than an error. Pending data is flushed on shutdown.
- **stdio-safe.** The MCP stdio transport owns stdout, so all diagnostics are written to stderr only; no console/stdout exporter is ever used.

## Enabling and disabling

Telemetry turns on as soon as you set an OTLP endpoint — either the general endpoint or any per-signal endpoint:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`

Setting `OTEL_SDK_DISABLED=1` (or `true`) forces telemetry off even when an endpoint is present. With no endpoint configured, telemetry stays off.

## Quick start with a local Collector / Jaeger

Run an all-in-one Jaeger (which accepts OTLP and renders traces) and point the server at it:

```bash
docker run --rm -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one:latest

export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=universal-netlist
# then start the MCP server as usual; open http://localhost:16686 to view traces
```

## Plug in your own Otel service

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

4. **Start the MCP server as usual.** Instrumentation is automatic — every tool call emits a span, metrics, and a log record.

The default wire protocol is `http/protobuf`. Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` if your backend prefers JSON. `grpc` is **not** bundled in the standalone binaries and falls back to `http/protobuf` with a warning.

## Configuration reference

Only standard OpenTelemetry environment variables are used.

| Variable | Purpose |
|----------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint to export to. **Setting this (or any per-signal endpoint) enables telemetry.** |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Per-signal endpoint override for traces. |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Per-signal endpoint override for metrics. |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Per-signal endpoint override for logs. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers for the exporter, e.g. `Authorization=Bearer <token>` for a managed backend. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (default) or `http/json`. `grpc` is not bundled in the standalone binaries and falls back to `http/protobuf`. |
| `OTEL_SERVICE_NAME` | Service name on the resource. Defaults to `universal-netlist`. |
| `OTEL_RESOURCE_ATTRIBUTES` | Additional resource identity attributes. |
| `OTEL_SDK_DISABLED` | Set to `1`/`true` to force telemetry off. |
| `OTEL_TRACES_SAMPLER` | Standard trace sampler configuration. |
| `OTEL_BSP_SCHEDULE_DELAY` | Batch span processor export interval (ms). |
| `OTEL_BLRP_SCHEDULE_DELAY` | Batch log record processor export interval (ms). |
| `OTEL_METRIC_EXPORT_INTERVAL` | Metric export interval (ms). Default `60000`. |

One additional, clearly-scoped option is specific to this server:

| Variable | Purpose |
|----------|---------|
| `OTEL_CAPTURE_TOOL_ARGS` | Set to `1`/`true` to also record raw tool arguments on the span as `tool.args`. Off by default, since arguments may be sensitive. |

## What gets emitted

Each tool call produces a span, three metric updates, and one log record.

### Spans

One span per call, named `tool/<tool_name>`.

| Attribute | Description |
|-----------|-------------|
| `tool.name` | The tool that was invoked. |
| `tool.outcome` | `success` or `error`. |
| `tool.duration_ms` | Wall-clock duration of the call in milliseconds. |
| `error.type` | Present on failure; the error class name (or `tool_error` for an error result). |
| `tool.args` | Full tool arguments as JSON. Only present when `OTEL_CAPTURE_TOOL_ARGS` is enabled. |

The span status is set to `ERROR` on failure and `OK` otherwise; exceptions are recorded on the span.

### Metrics

| Instrument | Type | Unit | Labels |
|------------|------|------|--------|
| `tool.calls` | Counter | — | `tool`, `outcome` |
| `tool.duration` | Histogram | ms | `tool`, `outcome` |
| `tool.errors` | Counter | — | `tool`, `error_type` |

### Logs

One structured log record per call, with body `tool/<tool_name> <outcome>` and severity `INFO` on success or `ERROR` on failure. Each record carries:

| Attribute | Description |
|-----------|-------------|
| `tool.name` | The tool that was invoked. |
| `tool.outcome` | `success` or `error`. |
| `tool.duration_ms` | Duration in milliseconds. |
| `error.type` | Present on failure. |
| `trace_id`, `span_id` | The active trace/span IDs, for trace-to-log correlation. |

### Resource attributes

All telemetry — traces, metrics, and logs alike — is tagged with:

| Attribute | Description |
|-----------|-------------|
| `service.name` | `OTEL_SERVICE_NAME` if set, otherwise `universal-netlist`. |
| `service.version` | The server version. |
| `enduser.id` | The host OS account name of whoever is running the server, attributing usage to the per-session user. Best-effort; omitted if it can't be read. |

## Reliability

Telemetry is designed to be invisible to callers:

- Instrumentation never alters a tool's result and never throws on its own; a failing exporter or SDK degrades to "no telemetry".
- When unconfigured, the instrumentation path is a pure pass-through with zero overhead, and the SDK is never imported.
- Pending, batched exports are flushed on process shutdown (including on `SIGINT`/`SIGTERM`), so short-lived invocations don't lose data.

## See Also

- [Tool Documentation](tools/) — the tools that generate this telemetry
- [API Documentation](README.md) — overview and response schemas
