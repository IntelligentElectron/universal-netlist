/**
 * The OTLP File exporter: OTLP JSON, one object per line, in one file per signal,
 * as the specification's File Exporter page lays out. The SDK for JavaScript ships
 * none, so this holds only the file handling; the encoding is the SDK's own.
 *
 * https://opentelemetry.io/docs/specs/otel/protocol/file-exporter/
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  JsonLogsSerializer,
  JsonMetricsSerializer,
  JsonTraceSerializer,
} from "@opentelemetry/otlp-transformer";
import type { SpanExporter } from "@opentelemetry/sdk-trace";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";

const decoder = new TextDecoder();

/** Append a batch to `path`. The records can name users and paths, so only the owner reads them. */
const fileExporter = <T>(path: string, serialize: (batch: T) => Uint8Array | undefined) => ({
  export: (batch: T, done: (result: ExportResult) => void): void => {
    try {
      const encoded = serialize(batch);
      if (encoded) {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        appendFileSync(path, `${decoder.decode(encoded)}\n`, { mode: 0o600 });
      }
      done({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      done({ code: ExportResultCode.FAILED, error: error as Error });
    }
  },
  forceFlush: async (): Promise<void> => {},
  shutdown: async (): Promise<void> => {},
});

export const traceFileExporter = (path: string): SpanExporter =>
  fileExporter(path, (spans: Parameters<SpanExporter["export"]>[0]) =>
    JsonTraceSerializer.serializeRequest(spans)
  );

export const metricFileExporter = (path: string): PushMetricExporter =>
  fileExporter(path, (metrics: Parameters<PushMetricExporter["export"]>[0]) =>
    JsonMetricsSerializer.serializeRequest(metrics)
  );

export const logFileExporter = (path: string): LogRecordExporter =>
  fileExporter(path, (records: Parameters<LogRecordExporter["export"]>[0]) =>
    JsonLogsSerializer.serializeRequest(records)
  );
