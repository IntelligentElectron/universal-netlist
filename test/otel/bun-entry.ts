/**
 * Standalone entry used only to validate that the OpenTelemetry stack bundles and
 * runs inside a `bun build --compile` standalone binary (the riskiest part of
 * shipping OTel in these servers). It initializes telemetry, emits one
 * instrumented call, flushes, and exits. Drive it with OTEL_* env pointed at a
 * receiver; the binary should deliver a span/metric/log and exit 0.
 */
import { initOtel, instrumentTool, shutdownOtel } from "../../src/telemetry/index.js";

const main = async (): Promise<void> => {
  await initOtel({ serviceName: "bun-smoke", serviceVersion: "0.0.0" });
  await instrumentTool("smoke_tool", { hello: "world" }, async () => ({
    content: [{ type: "text", text: "ok" }],
  }));
  await shutdownOtel();
  process.stderr.write("[bun-entry] done\n");
};

void main();
