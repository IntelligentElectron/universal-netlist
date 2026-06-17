/**
 * Minimal in-process OTLP/HTTP (JSON) receiver for end-to-end telemetry tests.
 *
 * Listens on an ephemeral port and captures the OTLP export envelopes the MCP
 * server sends for traces, metrics, and logs. Hermetic: no Docker, no real
 * collector. Tests point the server at it via:
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<port>
 *   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
 */

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

/** A decoded OTLP attribute value (only the subset we assert on). */
type AnyValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
};

export interface CapturedSpan {
  name: string;
  traceId: string;
  spanId: string;
  attributes: Record<string, string | number | boolean>;
  status?: { code?: number };
}

export interface CapturedMetric {
  name: string;
  /** Flattened data points with their decoded attributes and value. */
  points: Array<{ attributes: Record<string, string | number | boolean>; value: number }>;
}

export interface CapturedLog {
  body?: string;
  severityText?: string;
  attributes: Record<string, string | number | boolean>;
}

const decodeAttrs = (
  attrs: Array<{ key: string; value: AnyValue }> | undefined
): Record<string, string | number | boolean> => {
  const out: Record<string, string | number | boolean> = {};
  for (const a of attrs ?? []) {
    const v = a.value ?? {};
    if (v.stringValue !== undefined) out[a.key] = v.stringValue;
    else if (v.intValue !== undefined) out[a.key] = Number(v.intValue);
    else if (v.doubleValue !== undefined) out[a.key] = v.doubleValue;
    else if (v.boolValue !== undefined) out[a.key] = v.boolValue;
  }
  return out;
};

export class OtlpReceiver {
  private server: Server | undefined;
  readonly traceEnvelopes: unknown[] = [];
  readonly metricEnvelopes: unknown[] = [];
  readonly logEnvelopes: unknown[] = [];

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if (req.url?.endsWith("/v1/traces")) this.traceEnvelopes.push(body);
          else if (req.url?.endsWith("/v1/metrics")) this.metricEnvelopes.push(body);
          else if (req.url?.endsWith("/v1/logs")) this.logEnvelopes.push(body);
        } catch {
          // ignore malformed bodies
        }
        // OTLP/HTTP expects a 200 with a (possibly empty) export response.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  get port(): number {
    return (this.server!.address() as AddressInfo).port;
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  // --- Flattened accessors -------------------------------------------------

  spans(): CapturedSpan[] {
    const out: CapturedSpan[] = [];
    for (const env of this.traceEnvelopes as Array<{ resourceSpans?: any[] }>) {
      for (const rs of env.resourceSpans ?? []) {
        for (const ss of rs.scopeSpans ?? []) {
          for (const s of ss.spans ?? []) {
            out.push({
              name: s.name,
              traceId: s.traceId,
              spanId: s.spanId,
              attributes: decodeAttrs(s.attributes),
              status: s.status,
            });
          }
        }
      }
    }
    return out;
  }

  metrics(): CapturedMetric[] {
    const out: CapturedMetric[] = [];
    for (const env of this.metricEnvelopes as Array<{ resourceMetrics?: any[] }>) {
      for (const rm of env.resourceMetrics ?? []) {
        for (const sm of rm.scopeMetrics ?? []) {
          for (const m of sm.metrics ?? []) {
            const dps = m.sum?.dataPoints ?? m.histogram?.dataPoints ?? m.gauge?.dataPoints ?? [];
            out.push({
              name: m.name,
              points: dps.map((dp: any) => ({
                attributes: decodeAttrs(dp.attributes),
                value:
                  dp.asInt !== undefined
                    ? Number(dp.asInt)
                    : dp.asDouble !== undefined
                      ? dp.asDouble
                      : dp.count !== undefined
                        ? Number(dp.count)
                        : 0,
              })),
            });
          }
        }
      }
    }
    return out;
  }

  logs(): CapturedLog[] {
    const out: CapturedLog[] = [];
    for (const env of this.logEnvelopes as Array<{ resourceLogs?: any[] }>) {
      for (const rl of env.resourceLogs ?? []) {
        for (const sl of rl.scopeLogs ?? []) {
          for (const lr of sl.logRecords ?? []) {
            out.push({
              body: lr.body?.stringValue,
              severityText: lr.severityText,
              attributes: decodeAttrs(lr.attributes),
            });
          }
        }
      }
    }
    return out;
  }

  /** Merged resource-level attributes across all captured trace/metric/log envelopes. */
  resourceAttributes(): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    const collect = (envs: unknown[], key: string): void => {
      for (const env of envs as Array<
        Record<string, Array<{ resource?: { attributes?: Parameters<typeof decodeAttrs>[0] } }>>
      >) {
        for (const r of env[key] ?? []) {
          Object.assign(out, decodeAttrs(r.resource?.attributes));
        }
      }
    };
    collect(this.traceEnvelopes, "resourceSpans");
    collect(this.metricEnvelopes, "resourceMetrics");
    collect(this.logEnvelopes, "resourceLogs");
    return out;
  }
}

/** Poll until `predicate` is true or `timeoutMs` elapses. */
export const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 8000,
  intervalMs = 100
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return predicate();
};
