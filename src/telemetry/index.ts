/**
 * Telemetry public API.
 *
 * - `otel`: opt-in OpenTelemetry traces/metrics/logs (no-op unless the environment
 *           or the build asks for an export; see `otel-config`).
 * - `mcp`:  the MCP server's tool calls, reported through `otel`.
 *
 * Import telemetry from this barrel rather than the individual modules.
 */
export * from "./mcp.js";
export * from "./otel.js";
