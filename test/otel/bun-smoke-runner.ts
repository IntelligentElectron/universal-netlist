/**
 * Runner for the Bun-compiled OTel bundling gate.
 *
 * Starts the in-process OTLP receiver, runs the pre-compiled `bin/otel-bun-smoke`
 * binary against it, and asserts that a span, a metric, and a log were delivered
 * from inside the standalone binary. Exits non-zero on failure.
 *
 * Usage:
 *   bun build --compile test/otel/bun-entry.ts --outfile bin/otel-bun-smoke
 *   npx tsx test/otel/bun-smoke-runner.ts
 */
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OtlpReceiver, waitFor } from "./otlp-receiver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BINARY = join(HERE, "..", "..", "bin", "otel-bun-smoke");

const run = async (): Promise<void> => {
  const receiver = new OtlpReceiver();
  await receiver.start();

  const child = spawn(BINARY, [], {
    env: {
      ...process.env,
      OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_SERVICE_NAME: "bun-smoke",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  const exitCode: number = await new Promise((resolve) => child.on("exit", (c) => resolve(c ?? 1)));

  const ok = await waitFor(
    () =>
      receiver.spans().some((s) => s.name === "tool/smoke_tool") &&
      receiver.metrics().some((m) => m.name === "tool.calls") &&
      receiver.logs().some((l) => l.body === "tool/smoke_tool success"),
    5000
  );

  await receiver.stop();

  const span = receiver.spans().find((s) => s.name === "tool/smoke_tool");
  console.log("binary exit code:", exitCode);
  console.log("span delivered:  ", Boolean(span), span?.attributes["tool.outcome"]);
  console.log(
    "metric delivered:",
    receiver.metrics().some((m) => m.name === "tool.calls")
  );
  console.log(
    "log delivered:   ",
    receiver.logs().some((l) => l.body === "tool/smoke_tool success")
  );

  if (exitCode !== 0 || !ok) {
    console.error("FAIL: OTel did not work inside the bun-compiled binary");
    process.exit(1);
  }
  console.log("PASS: OTel spans/metrics/logs exported from a bun-compiled binary");
};

void run();
