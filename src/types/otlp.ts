// OTLP JSON type definitions
// Based on OpenTelemetry Protocol specification

// --- Common ---

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: OtlpAnyValue[] };
  kvlistValue?: { values: OtlpKeyValue[] };
}

export interface OtlpResource {
  attributes?: OtlpKeyValue[];
}

export interface OtlpInstrumentationScope {
  name?: string;
  version?: string;
}

// --- Metrics ---

export interface OtlpMetricsPayload {
  resourceMetrics?: OtlpResourceMetrics[];
}

export interface OtlpResourceMetrics {
  resource?: OtlpResource;
  scopeMetrics?: OtlpScopeMetrics[];
}

export interface OtlpScopeMetrics {
  scope?: OtlpInstrumentationScope;
  metrics?: OtlpMetric[];
}

export interface OtlpMetric {
  name: string;
  description?: string;
  unit?: string;
  sum?: OtlpSum;
  gauge?: OtlpGauge;
  histogram?: OtlpHistogram;
  summary?: OtlpSummary;
}

export interface OtlpNumberDataPoint {
  attributes?: OtlpKeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano?: string;
  asInt?: string | number;
  asDouble?: number;
}

export interface OtlpHistogramDataPoint {
  attributes?: OtlpKeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano?: string;
  count?: string | number;
  sum?: number;
  bucketCounts?: (string | number)[];
  explicitBounds?: number[];
  min?: number;
  max?: number;
}

export interface OtlpSum {
  dataPoints?: OtlpNumberDataPoint[];
  aggregationTemporality?: number;
  isMonotonic?: boolean;
}

export interface OtlpGauge {
  dataPoints?: OtlpNumberDataPoint[];
}

export interface OtlpHistogram {
  dataPoints?: OtlpHistogramDataPoint[];
  aggregationTemporality?: number;
}

export interface OtlpSummary {
  dataPoints?: Array<{
    attributes?: OtlpKeyValue[];
    startTimeUnixNano?: string;
    timeUnixNano?: string;
    count?: string | number;
    sum?: number;
  }>;
}

// --- Logs ---

export interface OtlpLogsPayload {
  resourceLogs?: OtlpResourceLogs[];
}

export interface OtlpResourceLogs {
  resource?: OtlpResource;
  scopeLogs?: OtlpScopeLogs[];
}

export interface OtlpScopeLogs {
  scope?: OtlpInstrumentationScope;
  logRecords?: OtlpLogRecord[];
}

export interface OtlpLogRecord {
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
  severityNumber?: number;
  severityText?: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
  traceId?: string;
  spanId?: string;
}

// --- Traces ---

export interface OtlpTracesPayload {
  resourceSpans?: OtlpResourceSpans[];
}

export interface OtlpResourceSpans {
  resource?: OtlpResource;
  scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpScopeSpans {
  scope?: OtlpInstrumentationScope;
  spans?: OtlpSpan[];
}

export interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: OtlpKeyValue[];
  status?: {
    code?: number;
    message?: string;
  };
  events?: Array<{
    timeUnixNano?: string;
    name?: string;
    attributes?: OtlpKeyValue[];
  }>;
}

// --- Internal types for our store ---

export interface ParsedMetricDataPoint {
  name: string;
  type: "sum" | "gauge" | "histogram";
  value: number;
  count?: number;
  sum?: number;
  min?: number;
  max?: number;
  attributes: Record<string, string>;
  timestamp: number;
  serviceName: string;
}

export interface ParsedLogRecord {
  timestamp: number;
  severity: string;
  body: string;
  attributes: Record<string, string>;
  serviceName: string;
}

export interface ParsedSpan {
  name: string;
  traceId: string;
  spanId: string;
  durationMs: number;
  attributes: Record<string, string>;
  status: string;
  serviceName: string;
  timestamp: number;
}

// Helper to extract string value from OtlpAnyValue
export function extractValue(val?: OtlpAnyValue): string {
  if (!val) return "";
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.intValue !== undefined) return String(val.intValue);
  if (val.doubleValue !== undefined) return String(val.doubleValue);
  if (val.boolValue !== undefined) return String(val.boolValue);
  return "";
}

// Helper to extract attributes as a flat Record
export function extractAttributes(attrs?: OtlpKeyValue[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!attrs) return result;
  for (const attr of attrs) {
    result[attr.key] = extractValue(attr.value);
  }
  return result;
}

// Helper to get numeric value from a data point
export function getNumericValue(point: OtlpNumberDataPoint): number {
  if (point.asDouble !== undefined) return point.asDouble;
  if (point.asInt !== undefined) return Number(point.asInt);
  return 0;
}

// Convert nanos string to milliseconds
export function nanosToMs(nanos?: string): number {
  if (!nanos) return Date.now();
  return Number(BigInt(nanos) / BigInt(1_000_000));
}
