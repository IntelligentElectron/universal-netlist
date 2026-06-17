/**
 * Test entry point: starts the real MCP server (stdio) without the CLI/auto-update
 * wrapper in src/index.ts, so end-to-end telemetry tests run deterministically
 * with no network calls. Exercises the real server.ts -> telemetry.ts -> otel.ts path.
 */
import { runServer } from "../../src/server.js";

runServer().catch((err) => {
  console.error("test server error:", err);
  process.exit(1);
});
