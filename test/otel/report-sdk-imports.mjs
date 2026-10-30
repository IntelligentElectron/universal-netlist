// Preload for the end-to-end test: counts the OpenTelemetry SDK modules a run loads, on stderr.
import { registerHooks } from "node:module";

let count = 0;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^@opentelemetry\/(sdk-|exporter-|resources)/.test(specifier)) count++;
    return nextResolve(specifier, context);
  },
});
process.on("exit", () => process.stderr.write(`sdk imports: ${count}\n`));
