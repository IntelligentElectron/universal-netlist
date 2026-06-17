/**
 * Telemetry public API.
 *
 * - `local`: fire-and-forget JSONL usage analytics written next to the install.
 * - `otel`:  opt-in OpenTelemetry traces/metrics/logs (no-op unless OTEL_* env
 *            is configured).
 *
 * Import telemetry from this barrel rather than the individual modules.
 */
export * from "./local.js";
export * from "./otel.js";
