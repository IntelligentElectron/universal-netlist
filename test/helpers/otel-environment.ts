/**
 * OpenTelemetry enabled against a closed local port, so nothing leaves the machine and
 * nothing from the shell's `OTEL_*` settings reaches the SDK.
 */

const CLOSED_EXPORTER: Record<string, string> = {
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
  // Shutdown gives up on the refused port at once instead of retrying it.
  OTEL_EXPORTER_OTLP_TIMEOUT: "200",
  // Batches export only at shutdown.
  OTEL_BSP_SCHEDULE_DELAY: "600000",
  OTEL_BLRP_SCHEDULE_DELAY: "600000",
  OTEL_METRIC_EXPORT_INTERVAL: "600000",
};

const otelNames = (): string[] =>
  Object.keys(process.env).filter((name) => name.startsWith("OTEL_"));

/** Replace the shell's `OTEL_*` settings with the closed exporter's; returns the restore. */
export const useClosedOtelExporter = (): (() => void) => {
  const shell = otelNames().map((name) => [name, process.env[name]] as const);
  for (const name of otelNames()) delete process.env[name];
  Object.assign(process.env, CLOSED_EXPORTER);
  return () => {
    for (const name of otelNames()) delete process.env[name];
    for (const [name, value] of shell) process.env[name] = value;
  };
};
