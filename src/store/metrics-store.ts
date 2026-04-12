import {
  type OtlpMetricsPayload,
  type OtlpLogsPayload,
  type OtlpTracesPayload,
  type ParsedMetricDataPoint,
  type ParsedLogRecord,
  type ParsedSpan,
  extractAttributes,
  extractValue,
  getNumericValue,
  nanosToMs,
} from "../types/otlp.js";

// --- Public interfaces ---

export interface ModelMetrics {
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  requests: number;
  errors: number;
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

export interface RequestEvent {
  timestamp: number;
  model: string;
  provider: string;
  tool: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  latencyMs: number;
  error: boolean;
}

export interface LogEvent {
  timestamp: number;
  severity: string;
  message: string;
  attributes: Record<string, string>;
  service: string;
}

export interface MetricsSnapshot {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  totalRequests: number;
  totalErrors: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  byModel: Record<string, ModelMetrics>;
  byProvider: Record<string, { requests: number; tokens: number; cost: number }>;
  byTool: Record<string, { count: number; avgLatencyMs: number }>;
  tokenTimeSeries: TimeSeriesPoint[];
  costTimeSeries: TimeSeriesPoint[];
  requestTimeSeries: TimeSeriesPoint[];
  recentRequests: RequestEvent[];
  recentLogs: LogEvent[];
  connectedServices: string[];
  uptimeMs: number;
}

// --- Known metric name mappings ---

const TOKEN_INPUT_NAMES = new Set([
  "llm.tokens.input",
  "llm.token.usage.input",
  "gen_ai.client.token.usage.input_tokens",
  "gen_ai.client.token.usage",
  "llm_tokens_input",
]);

const TOKEN_OUTPUT_NAMES = new Set([
  "llm.tokens.output",
  "llm.token.usage.output",
  "gen_ai.client.token.usage.output_tokens",
  "gen_ai.client.token.usage",
  "llm_tokens_output",
]);

const COST_NAMES = new Set([
  "llm.cost.total",
  "llm.cost",
  "gen_ai.client.cost",
  "llm_cost_total",
]);

const LATENCY_NAMES = new Set([
  "llm.request.duration",
  "llm.request.latency",
  "gen_ai.client.operation.duration",
  "llm_request_duration",
]);

const REQUEST_COUNT_NAMES = new Set([
  "llm.request.count",
  "llm.requests",
  "gen_ai.client.requests",
  "llm_request_count",
]);

const ERROR_NAMES = new Set([
  "llm.request.errors",
  "llm.errors",
  "llm_request_errors",
]);

const TOOL_DURATION_NAMES = new Set([
  "tool.execution.duration",
  "tool.duration",
  "tool_execution_duration",
]);

const TOOL_COUNT_NAMES = new Set([
  "tool.execution.count",
  "tool.executions",
  "tool_execution_count",
]);

// --- Ring buffer ---

class RingBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T) {
    this.buffer.push(item);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  toArray(): T[] {
    return [...this.buffer];
  }

  get length(): number {
    return this.buffer.length;
  }
}

// --- Time series bucket ---

class TimeSeries {
  private buckets: Map<number, number> = new Map();
  private bucketSizeMs: number;
  private maxBuckets: number;

  constructor(bucketSizeMs = 60_000, maxBuckets = 60) {
    this.bucketSizeMs = bucketSizeMs;
    this.maxBuckets = maxBuckets;
  }

  add(value: number, timestamp?: number) {
    const ts = timestamp ?? Date.now();
    const bucket = Math.floor(ts / this.bucketSizeMs) * this.bucketSizeMs;
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + value);
    this.prune();
  }

  private prune() {
    if (this.buckets.size > this.maxBuckets) {
      const sorted = [...this.buckets.keys()].sort((a, b) => a - b);
      const toRemove = sorted.length - this.maxBuckets;
      for (let i = 0; i < toRemove; i++) {
        this.buckets.delete(sorted[i]);
      }
    }
  }

  toArray(): TimeSeriesPoint[] {
    return [...this.buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([timestamp, value]) => ({ timestamp, value }));
  }
}

// --- Percentile calculator ---

class LatencyTracker {
  private values: number[] = [];
  private maxValues = 10_000;

  add(value: number) {
    this.values.push(value);
    if (this.values.length > this.maxValues) {
      this.values.shift();
    }
  }

  percentile(p: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  average(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }
}

// --- Main store ---

export type StoreEventCallback = (type: string, data: unknown) => void;

export class MetricsStore {
  private startTime = Date.now();
  private totalTokensIn = 0;
  private totalTokensOut = 0;
  private totalCost = 0;
  private totalRequests = 0;
  private totalErrors = 0;

  private modelMetrics = new Map<string, ModelMetrics>();
  private providerMetrics = new Map<string, { requests: number; tokens: number; cost: number }>();
  private toolMetrics = new Map<string, { count: number; totalLatencyMs: number }>();

  private tokenTimeSeries = new TimeSeries();
  private costTimeSeries = new TimeSeries();
  private requestTimeSeries = new TimeSeries();

  private latencyTracker = new LatencyTracker();
  private toolLatencyTrackers = new Map<string, LatencyTracker>();

  private recentRequests = new RingBuffer<RequestEvent>(200);
  private recentLogs = new RingBuffer<LogEvent>(200);

  private connectedServices = new Set<string>();
  private listeners: StoreEventCallback[] = [];

  onUpdate(callback: StoreEventCallback) {
    this.listeners.push(callback);
  }

  private emit(type: string, data: unknown) {
    for (const listener of this.listeners) {
      listener(type, data);
    }
  }

  ingestMetrics(payload: OtlpMetricsPayload) {
    const resourceMetrics = payload.resourceMetrics ?? [];

    for (const rm of resourceMetrics) {
      const resourceAttrs = extractAttributes(rm.resource?.attributes);
      const serviceName = resourceAttrs["service.name"] ?? "unknown";
      this.connectedServices.add(serviceName);

      for (const sm of rm.scopeMetrics ?? []) {
        for (const metric of sm.metrics ?? []) {
          this.processMetric(metric, serviceName);
        }
      }
    }

    this.emit("metric_update", this.getSnapshot());
  }

  private processMetric(metric: { name: string; sum?: any; gauge?: any; histogram?: any }, serviceName: string) {
    const name = metric.name;

    // Process sum data points
    const sumPoints = metric.sum?.dataPoints ?? [];
    for (const point of sumPoints) {
      const value = getNumericValue(point);
      const attrs = extractAttributes(point.attributes);
      const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? attrs["llm.model"] ?? "";
      const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? attrs["llm.provider"] ?? "";
      const tool = attrs["tool"] ?? attrs["tool.name"] ?? "";
      const tokenType = attrs["gen_ai.token.type"] ?? attrs["token.type"] ?? "";

      // Token input
      if (TOKEN_INPUT_NAMES.has(name) || (name === "gen_ai.client.token.usage" && tokenType === "input")) {
        this.totalTokensIn += value;
        this.tokenTimeSeries.add(value);
        this.updateModelMetrics(model, provider, { tokensIn: value });
      }

      // Token output
      if (TOKEN_OUTPUT_NAMES.has(name) || (name === "gen_ai.client.token.usage" && tokenType === "output")) {
        this.totalTokensOut += value;
        this.tokenTimeSeries.add(value);
        this.updateModelMetrics(model, provider, { tokensOut: value });
      }

      // Cost
      if (COST_NAMES.has(name)) {
        this.totalCost += value;
        this.costTimeSeries.add(value);
        this.updateModelMetrics(model, provider, { cost: value });
      }

      // Request count
      if (REQUEST_COUNT_NAMES.has(name)) {
        this.totalRequests += value;
        this.requestTimeSeries.add(value);
        this.updateModelMetrics(model, provider, { requests: value });

        this.recentRequests.push({
          timestamp: Date.now(),
          model,
          provider,
          tool,
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          latencyMs: 0,
          error: false,
        });
      }

      // Errors
      if (ERROR_NAMES.has(name)) {
        this.totalErrors += value;
        this.updateModelMetrics(model, provider, { errors: value });
      }

      // Tool execution count
      if (TOOL_COUNT_NAMES.has(name) && tool) {
        const existing = this.toolMetrics.get(tool) ?? { count: 0, totalLatencyMs: 0 };
        existing.count += value;
        this.toolMetrics.set(tool, existing);
      }
    }

    // Process histogram data points (latency)
    const histPoints = metric.histogram?.dataPoints ?? [];
    for (const point of histPoints) {
      const attrs = extractAttributes(point.attributes);
      const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? "";
      const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? "";
      const tool = attrs["tool"] ?? attrs["tool.name"] ?? "";

      if (LATENCY_NAMES.has(name)) {
        const count = Number(point.count ?? 0);
        const sum = point.sum ?? 0;
        if (count > 0) {
          const avgMs = (sum / count) * 1000; // Convert seconds to ms
          this.latencyTracker.add(avgMs);
          this.totalRequests += count;
          this.requestTimeSeries.add(count);
          this.updateModelMetrics(model, provider, { requests: count });

          this.recentRequests.push({
            timestamp: Date.now(),
            model,
            provider,
            tool,
            tokensIn: 0,
            tokensOut: 0,
            cost: 0,
            latencyMs: avgMs,
            error: false,
          });
        }
      }

      if (TOOL_DURATION_NAMES.has(name) && tool) {
        const count = Number(point.count ?? 0);
        const sum = point.sum ?? 0;
        if (count > 0) {
          const avgMs = (sum / count) * 1000;
          const existing = this.toolMetrics.get(tool) ?? { count: 0, totalLatencyMs: 0 };
          existing.count += count;
          existing.totalLatencyMs += sum * 1000;
          this.toolMetrics.set(tool, existing);

          if (!this.toolLatencyTrackers.has(tool)) {
            this.toolLatencyTrackers.set(tool, new LatencyTracker());
          }
          this.toolLatencyTrackers.get(tool)!.add(avgMs);
        }
      }
    }

    // Process gauge data points
    const gaugePoints = metric.gauge?.dataPoints ?? [];
    for (const point of gaugePoints) {
      const value = getNumericValue(point);
      const attrs = extractAttributes(point.attributes);
      // Store generic gauge metrics if they match known patterns
      if (TOKEN_INPUT_NAMES.has(name)) {
        this.totalTokensIn = value;
      }
      if (TOKEN_OUTPUT_NAMES.has(name)) {
        this.totalTokensOut = value;
      }
    }
  }

  private updateModelMetrics(
    model: string,
    provider: string,
    delta: Partial<{ tokensIn: number; tokensOut: number; cost: number; requests: number; errors: number }>
  ) {
    if (!model && !provider) return;

    const key = model || provider || "unknown";

    // Model metrics
    if (model) {
      const existing = this.modelMetrics.get(model) ?? {
        model,
        provider,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        requests: 0,
        errors: 0,
      };
      existing.tokensIn += delta.tokensIn ?? 0;
      existing.tokensOut += delta.tokensOut ?? 0;
      existing.cost += delta.cost ?? 0;
      existing.requests += delta.requests ?? 0;
      existing.errors += delta.errors ?? 0;
      if (provider) existing.provider = provider;
      this.modelMetrics.set(model, existing);
    }

    // Provider metrics
    if (provider) {
      const existing = this.providerMetrics.get(provider) ?? { requests: 0, tokens: 0, cost: 0 };
      existing.requests += delta.requests ?? 0;
      existing.tokens += (delta.tokensIn ?? 0) + (delta.tokensOut ?? 0);
      existing.cost += delta.cost ?? 0;
      this.providerMetrics.set(provider, existing);
    }
  }

  ingestLogs(payload: OtlpLogsPayload) {
    const resourceLogs = payload.resourceLogs ?? [];
    let hasMetricData = false;

    for (const rl of resourceLogs) {
      const resourceAttrs = extractAttributes(rl.resource?.attributes);
      const serviceName = resourceAttrs["service.name"] ?? "unknown";
      this.connectedServices.add(serviceName);

      for (const sl of rl.scopeLogs ?? []) {
        for (const record of sl.logRecords ?? []) {
          const attrs = extractAttributes(record.attributes);
          const body = extractValue(record.body);
          const timestamp = nanosToMs(record.timeUnixNano);

          const logEvent: LogEvent = {
            timestamp,
            severity: record.severityText ?? `LEVEL_${record.severityNumber ?? 0}`,
            message: body,
            attributes: attrs,
            service: serviceName,
          };
          this.recentLogs.push(logEvent);

          // Extract metrics from Claude Code log records.
          // Claude Code sends telemetry as logs where the body is the event name
          // and attributes contain the actual metric data.
          if (this.extractMetricsFromLog(body, attrs, timestamp, serviceName)) {
            hasMetricData = true;
          }
        }
      }
    }

    this.emit("new_logs", this.recentLogs.toArray().slice(-10));
    if (hasMetricData) {
      this.emit("metric_update", this.getSnapshot());
    }
  }

  /**
   * Extract metrics from log-based telemetry (Claude Code, etc.).
   * Returns true if metrics were extracted.
   */
  private extractMetricsFromLog(
    body: string,
    attrs: Record<string, string>,
    timestamp: number,
    _serviceName: string,
  ): boolean {
    const eventName = body.toLowerCase();

    // Claude Code API request logs contain token counts, cost, and latency
    if (eventName.includes("api_request") || eventName.includes("api.request") || eventName.includes("llm.request")) {
      const tokensIn = this.parseNum(attrs["input_tokens"] ?? attrs["gen_ai.usage.input_tokens"] ?? attrs["prompt_tokens"] ?? attrs["tokens.input"]);
      const tokensOut = this.parseNum(attrs["output_tokens"] ?? attrs["gen_ai.usage.output_tokens"] ?? attrs["completion_tokens"] ?? attrs["tokens.output"]);
      const cost = this.parseFloat(attrs["cost_usd"] ?? attrs["cost"] ?? attrs["llm.cost"] ?? attrs["gen_ai.cost"]);
      const latencyMs = this.parseNum(attrs["duration_ms"] ?? attrs["latency_ms"] ?? attrs["duration"] ?? attrs["response_time"]);
      const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? attrs["llm.model"] ?? "";
      const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? attrs["llm.provider"] ?? "";
      const tool = attrs["tool"] ?? attrs["tool.name"] ?? attrs["tool_name"] ?? "";
      const isError = (attrs["status"] ?? attrs["error"] ?? "").toLowerCase() === "error" ||
                      attrs["status_code"] === "error" ||
                      eventName.includes("error");

      if (tokensIn > 0 || tokensOut > 0 || cost > 0) {
        this.totalTokensIn += tokensIn;
        this.totalTokensOut += tokensOut;
        this.totalCost += cost;
        this.totalRequests += 1;

        if (tokensIn > 0 || tokensOut > 0) {
          this.tokenTimeSeries.add(tokensIn + tokensOut);
        }
        if (cost > 0) {
          this.costTimeSeries.add(cost);
        }
        this.requestTimeSeries.add(1);

        if (latencyMs > 0) {
          this.latencyTracker.add(latencyMs);
        }

        if (isError) {
          this.totalErrors += 1;
        }

        this.updateModelMetrics(model, provider, {
          tokensIn,
          tokensOut,
          cost,
          requests: 1,
          errors: isError ? 1 : 0,
        });

        this.recentRequests.push({
          timestamp: timestamp || Date.now(),
          model,
          provider,
          tool,
          tokensIn,
          tokensOut,
          cost,
          latencyMs,
          error: isError,
        });

        return true;
      }
    }

    // Claude Code API error logs
    if (eventName.includes("api_error") || eventName.includes("api.error")) {
      this.totalErrors += 1;
      const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? "";
      const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? "";
      if (model || provider) {
        this.updateModelMetrics(model, provider, { errors: 1 });
      }
      return true;
    }

    // Tool execution logs
    if (eventName.includes("tool_result") || eventName.includes("tool.execution") || eventName.includes("tool_call")) {
      const tool = attrs["tool"] ?? attrs["tool.name"] ?? attrs["tool_name"] ?? attrs["name"] ?? "";
      const durationMs = this.parseNum(attrs["duration_ms"] ?? attrs["duration"] ?? attrs["latency_ms"]);

      if (tool) {
        const existing = this.toolMetrics.get(tool) ?? { count: 0, totalLatencyMs: 0 };
        existing.count += 1;
        existing.totalLatencyMs += durationMs;
        this.toolMetrics.set(tool, existing);
        return true;
      }
    }

    return false;
  }

  private parseNum(val: string | undefined): number {
    if (!val) return 0;
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
  }

  private parseFloat(val: string | undefined): number {
    if (!val) return 0;
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  }

  ingestTraces(payload: OtlpTracesPayload) {
    const resourceSpans = payload.resourceSpans ?? [];

    for (const rs of resourceSpans) {
      const resourceAttrs = extractAttributes(rs.resource?.attributes);
      const serviceName = resourceAttrs["service.name"] ?? "unknown";
      this.connectedServices.add(serviceName);

      for (const ss of rs.scopeSpans ?? []) {
        for (const span of ss.spans ?? []) {
          const startMs = nanosToMs(span.startTimeUnixNano);
          const endMs = nanosToMs(span.endTimeUnixNano);
          const durationMs = endMs - startMs;
          const attrs = extractAttributes(span.attributes);

          if (durationMs > 0) {
            this.latencyTracker.add(durationMs);

            const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? "";
            const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? "";
            const tool = attrs["tool"] ?? "";

            this.recentRequests.push({
              timestamp: startMs,
              model,
              provider,
              tool,
              tokensIn: Number(attrs["gen_ai.usage.input_tokens"] ?? 0),
              tokensOut: Number(attrs["gen_ai.usage.output_tokens"] ?? 0),
              cost: Number(attrs["llm.cost"] ?? 0),
              latencyMs: durationMs,
              error: span.status?.code === 2,
            });

            if (span.status?.code === 2) {
              this.totalErrors++;
            }
          }
        }
      }
    }

    this.emit("metric_update", this.getSnapshot());
  }

  getSnapshot(): MetricsSnapshot {
    const byTool: Record<string, { count: number; avgLatencyMs: number }> = {};
    for (const [tool, data] of this.toolMetrics) {
      byTool[tool] = {
        count: data.count,
        avgLatencyMs: data.count > 0 ? data.totalLatencyMs / data.count : 0,
      };
    }

    return {
      totalTokensIn: this.totalTokensIn,
      totalTokensOut: this.totalTokensOut,
      totalCost: this.totalCost,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      avgLatencyMs: this.latencyTracker.average(),
      p50LatencyMs: this.latencyTracker.percentile(50),
      p95LatencyMs: this.latencyTracker.percentile(95),
      p99LatencyMs: this.latencyTracker.percentile(99),
      byModel: Object.fromEntries(this.modelMetrics),
      byProvider: Object.fromEntries(this.providerMetrics),
      byTool,
      tokenTimeSeries: this.tokenTimeSeries.toArray(),
      costTimeSeries: this.costTimeSeries.toArray(),
      requestTimeSeries: this.requestTimeSeries.toArray(),
      recentRequests: this.recentRequests.toArray(),
      recentLogs: this.recentLogs.toArray(),
      connectedServices: [...this.connectedServices],
      uptimeMs: Date.now() - this.startTime,
    };
  }
}
