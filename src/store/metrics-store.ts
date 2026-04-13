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
  service: string;
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
  totalLinesAdded: number;
  totalLinesDeleted: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  byModel: Record<string, ModelMetrics>;
  byProvider: Record<string, { requests: number; tokens: number; cost: number }>;
  byTool: Record<string, { count: number; avgLatencyMs: number }>;
  byService: Record<string, { requests: number; tokens: number; cost: number; tools: number }>;
  tokenTimeSeries: TimeSeriesPoint[];
  costTimeSeries: TimeSeriesPoint[];
  requestTimeSeries: TimeSeriesPoint[];
  recentRequests: RequestEvent[];
  recentLogs: LogEvent[];
  connectedServices: string[];
  uptimeMs: number;
}

// --- Known OTLP metric name mappings ---
// Supports: generic LLM metrics, gen_ai.* semantic conventions,
// Codex CLI (codex.*), and any OTel-compatible tool.

const TOKEN_INPUT_NAMES = new Set([
  "llm.tokens.input",
  "llm.token.usage.input",
  "gen_ai.client.token.usage.input_tokens",
  "gen_ai.client.token.usage",        // with gen_ai.token.type=input attribute
  "llm_tokens_input",
  "codex.turn.token_usage",           // Codex per-turn token counter
]);

const TOKEN_OUTPUT_NAMES = new Set([
  "llm.tokens.output",
  "llm.token.usage.output",
  "gen_ai.client.token.usage.output_tokens",
  "gen_ai.client.token.usage",        // with gen_ai.token.type=output attribute
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
  "codex.api_request.duration_ms",    // Codex API request latency (histogram, in ms)
  "codex.turn.e2e_duration_ms",       // Codex end-to-end turn latency
]);

const REQUEST_COUNT_NAMES = new Set([
  "llm.request.count",
  "llm.requests",
  "gen_ai.client.requests",
  "llm_request_count",
  "codex.api_request",                // Codex API request counter
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
  "codex.tool.call.duration_ms",      // Codex tool call latency (histogram, in ms)
  "opencode.tool.duration",           // OpenCode plugin tool duration (histogram, in ms)
]);

const TOOL_COUNT_NAMES = new Set([
  "tool.execution.count",
  "tool.executions",
  "tool_execution_count",
  "codex.tool.call",                  // Codex tool call counter
  "codex.turn.tool.call",             // Codex per-turn tool call counter
  "codex.tool.unified_exec",          // Codex unified exec tool calls
  "opencode.tool.executions",         // OpenCode plugin tool execution counter
]);

// OpenCode telemetry plugin — Lines of Code metrics
const LOC_ADDED_NAMES = new Set([
  "opencode.tool.loc.added",
]);

const LOC_DELETED_NAMES = new Set([
  "opencode.tool.loc.deleted",
]);

// Histogram metrics where the unit is already ms (not seconds)
const MS_UNIT_HISTOGRAMS = new Set([
  "codex.api_request.duration_ms",
  "codex.turn.e2e_duration_ms",
  "codex.turn.ttft.duration_ms",
  "codex.turn.ttfm.duration_ms",
  "codex.tool.call.duration_ms",
  "codex.sse_event.duration_ms",
  "codex.websocket.request.duration_ms",
  "codex.websocket.event.duration_ms",
  "codex.responses_api_overhead.duration_ms",
  "codex.responses_api_inference_time.duration_ms",
  "codex.startup_prewarm.duration_ms",
  "opencode.tool.duration",            // OpenCode plugin tool duration (ms)
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
  private totalLinesAdded = 0;
  private totalLinesDeleted = 0;

  private modelMetrics = new Map<string, ModelMetrics>();
  private providerMetrics = new Map<string, { requests: number; tokens: number; cost: number }>();
  private toolMetrics = new Map<string, { count: number; totalLatencyMs: number }>();
  private serviceMetrics = new Map<string, { requests: number; tokens: number; cost: number; tools: number }>();

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

  // =====================================================================
  // OTLP Metrics ingestion (Codex counters/histograms, gen_ai.*, generic)
  // =====================================================================

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

    // Process sum data points (counters)
    const sumPoints = metric.sum?.dataPoints ?? [];
    for (const point of sumPoints) {
      const value = getNumericValue(point);
      const attrs = extractAttributes(point.attributes);
      const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? attrs["llm.model"] ?? "";
      const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? attrs["llm.provider"] ?? "";
      const tool = attrs["tool"] ?? attrs["tool.name"] ?? attrs["tool_name"] ?? "";
      const tokenType = attrs["gen_ai.token.type"] ?? attrs["token.type"] ?? "";

      // Token input
      if (TOKEN_INPUT_NAMES.has(name) || (name === "gen_ai.client.token.usage" && tokenType === "input")) {
        this.totalTokensIn += value;
        this.tokenTimeSeries.add(value);
        this.updateModelMetrics(model, provider, { tokensIn: value });
        this.updateServiceMetrics(serviceName, { tokens: value });
      }

      // Token output
      if (TOKEN_OUTPUT_NAMES.has(name) || (name === "gen_ai.client.token.usage" && tokenType === "output")) {
        this.totalTokensOut += value;
        this.tokenTimeSeries.add(value);
        this.updateModelMetrics(model, provider, { tokensOut: value });
        this.updateServiceMetrics(serviceName, { tokens: value });
      }

      // Cost
      if (COST_NAMES.has(name)) {
        this.totalCost += value;
        this.costTimeSeries.add(value);
        this.updateModelMetrics(model, provider, { cost: value });
        this.updateServiceMetrics(serviceName, { cost: value });
      }

      // Request count (including codex.api_request counter)
      if (REQUEST_COUNT_NAMES.has(name)) {
        this.totalRequests += value;
        this.requestTimeSeries.add(value);
        this.updateModelMetrics(model, provider, { requests: value });
        this.updateServiceMetrics(serviceName, { requests: value });

        this.recentRequests.push({
          timestamp: Date.now(),
          service: serviceName,
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

      // Tool execution count (including codex.tool.call, opencode.tool.executions)
      if (TOOL_COUNT_NAMES.has(name) && tool) {
        const existing = this.toolMetrics.get(tool) ?? { count: 0, totalLatencyMs: 0 };
        existing.count += value;
        this.toolMetrics.set(tool, existing);
        this.updateServiceMetrics(serviceName, { tools: value });
      }

      // Lines of code (OpenCode telemetry plugin)
      if (LOC_ADDED_NAMES.has(name)) {
        this.totalLinesAdded += value;
      }
      if (LOC_DELETED_NAMES.has(name)) {
        this.totalLinesDeleted += value;
      }
    }

    // Process histogram data points (latency)
    const histPoints = metric.histogram?.dataPoints ?? [];
    for (const point of histPoints) {
      const attrs = extractAttributes(point.attributes);
      const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? "";
      const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? "";
      const tool = attrs["tool"] ?? attrs["tool.name"] ?? attrs["tool_name"] ?? "";
      const isSuccess = attrs["success"] !== "false";

      // Codex histograms are already in ms; gen_ai.* and generic are in seconds
      const isMs = MS_UNIT_HISTOGRAMS.has(name);

      if (LATENCY_NAMES.has(name)) {
        const count = Number(point.count ?? 0);
        const sum = point.sum ?? 0;
        if (count > 0) {
          const avgMs = isMs ? (sum / count) : (sum / count) * 1000;
          this.latencyTracker.add(avgMs);
          this.totalRequests += count;
          this.requestTimeSeries.add(count);
          this.updateModelMetrics(model, provider, { requests: count });
          this.updateServiceMetrics(serviceName, { requests: count });

          if (!isSuccess) {
            this.totalErrors += count;
            this.updateModelMetrics(model, provider, { errors: count });
          }

          this.recentRequests.push({
            timestamp: Date.now(),
            service: serviceName,
            model,
            provider,
            tool,
            tokensIn: 0,
            tokensOut: 0,
            cost: 0,
            latencyMs: avgMs,
            error: !isSuccess,
          });
        }
      }

      if (TOOL_DURATION_NAMES.has(name) && tool) {
        const count = Number(point.count ?? 0);
        const sum = point.sum ?? 0;
        if (count > 0) {
          const avgMs = isMs ? (sum / count) : (sum / count) * 1000;
          const existing = this.toolMetrics.get(tool) ?? { count: 0, totalLatencyMs: 0 };
          existing.count += count;
          existing.totalLatencyMs += isMs ? sum : sum * 1000;
          this.toolMetrics.set(tool, existing);
          this.updateServiceMetrics(serviceName, { tools: count });

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

    if (provider) {
      const existing = this.providerMetrics.get(provider) ?? { requests: 0, tokens: 0, cost: 0 };
      existing.requests += delta.requests ?? 0;
      existing.tokens += (delta.tokensIn ?? 0) + (delta.tokensOut ?? 0);
      existing.cost += delta.cost ?? 0;
      this.providerMetrics.set(provider, existing);
    }
  }

  private updateServiceMetrics(
    service: string,
    delta: Partial<{ requests: number; tokens: number; cost: number; tools: number }>
  ) {
    if (!service || service === "unknown") return;
    const existing = this.serviceMetrics.get(service) ?? { requests: 0, tokens: 0, cost: 0, tools: 0 };
    existing.requests += delta.requests ?? 0;
    existing.tokens += delta.tokens ?? 0;
    existing.cost += delta.cost ?? 0;
    existing.tools += delta.tools ?? 0;
    this.serviceMetrics.set(service, existing);
  }

  // =====================================================================
  // OTLP Logs ingestion (Claude Code, Codex logs, gen_ai.* events)
  // =====================================================================

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

          // Extract metrics from log-based telemetry.
          // Claude Code, Codex, and other tools send telemetry as logs
          // where the body is the event name and attributes contain metric data.
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
   * Extract metrics from log-based telemetry.
   * Supports: Claude Code, Codex CLI, and gen_ai.* conventions.
   */
  private extractMetricsFromLog(
    body: string,
    attrs: Record<string, string>,
    timestamp: number,
    serviceName: string,
  ): boolean {
    const eventName = body.toLowerCase();

    // ---- API request logs (Claude Code + Codex + generic) ----
    // Claude Code: "claude_code.api_request"
    // Codex: "codex.api_request"
    // Generic: "llm.request", "api.request"
    if (
      eventName.includes("api_request") ||
      eventName.includes("api.request") ||
      eventName.includes("llm.request")
    ) {
      const tokensIn = this.parseNum(
        attrs["input_tokens"] ?? attrs["gen_ai.usage.input_tokens"] ??
        attrs["prompt_tokens"] ?? attrs["tokens.input"] ??
        attrs["input_token_count"]   // Codex
      );
      const tokensOut = this.parseNum(
        attrs["output_tokens"] ?? attrs["gen_ai.usage.output_tokens"] ??
        attrs["completion_tokens"] ?? attrs["tokens.output"] ??
        attrs["output_token_count"]  // Codex
      );
      const cost = this.parseFloatVal(
        attrs["cost_usd"] ?? attrs["cost"] ?? attrs["llm.cost"] ?? attrs["gen_ai.cost"]
      );
      const latencyMs = this.parseNum(
        attrs["duration_ms"] ?? attrs["latency_ms"] ?? attrs["duration"] ?? attrs["response_time"]
      );
      const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? attrs["llm.model"] ?? "";
      const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? attrs["llm.provider"] ?? "";
      const tool = attrs["tool"] ?? attrs["tool.name"] ?? attrs["tool_name"] ?? "";
      const isError = (attrs["status"] ?? attrs["error"] ?? "").toLowerCase() === "error" ||
                      attrs["success"] === "false" ||
                      eventName.includes("error");

      if (tokensIn > 0 || tokensOut > 0 || cost > 0 || latencyMs > 0) {
        this.totalTokensIn += tokensIn;
        this.totalTokensOut += tokensOut;
        this.totalCost += cost;
        this.totalRequests += 1;

        if (tokensIn > 0 || tokensOut > 0) this.tokenTimeSeries.add(tokensIn + tokensOut);
        if (cost > 0) this.costTimeSeries.add(cost);
        this.requestTimeSeries.add(1);
        if (latencyMs > 0) this.latencyTracker.add(latencyMs);
        if (isError) this.totalErrors += 1;

        this.updateModelMetrics(model, provider, {
          tokensIn, tokensOut, cost, requests: 1, errors: isError ? 1 : 0,
        });
        this.updateServiceMetrics(serviceName, {
          requests: 1, tokens: tokensIn + tokensOut, cost,
        });

        this.recentRequests.push({
          timestamp: timestamp || Date.now(),
          service: serviceName, model, provider, tool, tokensIn, tokensOut, cost, latencyMs, error: isError,
        });

        return true;
      }
    }

    // ---- SSE event logs (Codex) ----
    // Codex sends "codex.sse_event" with event.kind="response.completed" containing token counts
    if (eventName.includes("sse_event") || eventName.includes("sse.event")) {
      const kind = (attrs["event.kind"] ?? attrs["kind"] ?? "").toLowerCase();
      const tokensIn = this.parseNum(attrs["input_token_count"] ?? attrs["input_tokens"]);
      const tokensOut = this.parseNum(attrs["output_token_count"] ?? attrs["output_tokens"]);
      const cachedTokens = this.parseNum(attrs["cached_token_count"] ?? attrs["cache_read_tokens"]);
      const reasoningTokens = this.parseNum(attrs["reasoning_token_count"]);
      const latencyMs = this.parseNum(attrs["duration_ms"] ?? attrs["duration"]);
      const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? "";
      const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? "openai";

      if (tokensIn > 0 || tokensOut > 0) {
        this.totalTokensIn += tokensIn + cachedTokens;
        this.totalTokensOut += tokensOut + reasoningTokens;
        this.tokenTimeSeries.add(tokensIn + tokensOut + cachedTokens + reasoningTokens);

        // Count as a request if this is a completed response
        if (kind.includes("completed") || kind.includes("done")) {
          this.totalRequests += 1;
          this.requestTimeSeries.add(1);
          if (latencyMs > 0) this.latencyTracker.add(latencyMs);

          this.updateModelMetrics(model, provider, {
            tokensIn: tokensIn + cachedTokens,
            tokensOut: tokensOut + reasoningTokens,
            requests: 1,
          });
          this.updateServiceMetrics(serviceName, {
            requests: 1, tokens: tokensIn + tokensOut + cachedTokens + reasoningTokens,
          });

          this.recentRequests.push({
            timestamp: timestamp || Date.now(),
            service: serviceName, model, provider, tool: "", tokensIn: tokensIn + cachedTokens,
            tokensOut: tokensOut + reasoningTokens, cost: 0, latencyMs, error: false,
          });
        } else {
          this.updateModelMetrics(model, provider, {
            tokensIn: tokensIn + cachedTokens,
            tokensOut: tokensOut + reasoningTokens,
          });
        }

        return true;
      }
    }

    // ---- API error logs (Claude Code + Codex + generic) ----
    if (eventName.includes("api_error") || eventName.includes("api.error")) {
      this.totalErrors += 1;
      const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? "";
      const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? "";
      if (model || provider) {
        this.updateModelMetrics(model, provider, { errors: 1 });
      }
      return true;
    }

    // ---- Tool execution logs (Claude Code + Codex + generic) ----
    // Claude Code: "claude_code.tool_result"
    // Codex: "codex.tool_result", "codex.tool_decision"
    // Generic: "tool.execution", "tool_call"
    if (
      eventName.includes("tool_result") ||
      eventName.includes("tool.execution") ||
      eventName.includes("tool_call")
    ) {
      const tool = attrs["tool"] ?? attrs["tool.name"] ?? attrs["tool_name"] ??
                   attrs["name"] ?? attrs["call_id"] ?? "";
      const durationMs = this.parseNum(attrs["duration_ms"] ?? attrs["duration"] ?? attrs["latency_ms"]);
      const isSuccess = attrs["success"] !== "false";

      if (tool) {
        const existing = this.toolMetrics.get(tool) ?? { count: 0, totalLatencyMs: 0 };
        existing.count += 1;
        existing.totalLatencyMs += durationMs;
        this.toolMetrics.set(tool, existing);
        this.updateServiceMetrics(serviceName, { tools: 1 });

        if (!isSuccess) {
          this.totalErrors += 1;
        }

        return true;
      }
    }

    // ---- Conversation start logs (Codex) ----
    // "codex.conversation_starts" — just track as a connected service
    if (eventName.includes("conversation_start")) {
      return false; // Already tracked via service.name
    }

    // ---- User prompt logs (Claude Code + Codex) ----
    // "claude_code.user_prompt", "codex.user_prompt"
    // No metrics to extract, just informational
    if (eventName.includes("user_prompt")) {
      return false;
    }

    return false;
  }

  private parseNum(val: string | undefined): number {
    if (!val) return 0;
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
  }

  private parseFloatVal(val: string | undefined): number {
    if (!val) return 0;
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  }

  // =====================================================================
  // OTLP Traces ingestion (Codex spans, gen_ai.* spans, generic)
  // =====================================================================

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

          if (durationMs <= 0) continue;

          const model = attrs["model"] ?? attrs["gen_ai.request.model"] ?? "";
          const provider = attrs["provider"] ?? attrs["gen_ai.system"] ?? "";
          const tool = attrs["tool"] ?? attrs["tool.name"] ?? attrs["tool_name"] ?? "";
          const tokensIn = this.parseNum(
            attrs["gen_ai.usage.input_tokens"] ?? attrs["input_tokens"] ??
            attrs["input_token_count"] ?? attrs["prompt_tokens"]
          );
          const tokensOut = this.parseNum(
            attrs["gen_ai.usage.output_tokens"] ?? attrs["output_tokens"] ??
            attrs["output_token_count"] ?? attrs["completion_tokens"]
          );
          const cost = this.parseFloatVal(attrs["llm.cost"] ?? attrs["cost_usd"] ?? attrs["cost"]);
          const isError = span.status?.code === 2 || attrs["success"] === "false";

          // Check if this span has any meaningful AI data.
          // Skip internal/infrastructure spans that have no model, tokens, tool, or cost.
          const hasAiData = model || tokensIn > 0 || tokensOut > 0 || cost > 0 || tool;
          if (!hasAiData) continue;

          this.latencyTracker.add(durationMs);

          // Track tokens/cost from spans
          if (tokensIn > 0 || tokensOut > 0) {
            this.totalTokensIn += tokensIn;
            this.totalTokensOut += tokensOut;
            this.tokenTimeSeries.add(tokensIn + tokensOut);
          }
          if (cost > 0) {
            this.totalCost += cost;
            this.costTimeSeries.add(cost);
          }

          this.totalRequests += 1;
          this.requestTimeSeries.add(1);

          this.updateModelMetrics(model, provider, {
            tokensIn, tokensOut, cost, requests: 1, errors: isError ? 1 : 0,
          });
          this.updateServiceMetrics(serviceName, {
            requests: 1, tokens: tokensIn + tokensOut, cost,
          });

          // Track tool spans
          if (tool) {
            const existing = this.toolMetrics.get(tool) ?? { count: 0, totalLatencyMs: 0 };
            existing.count += 1;
            existing.totalLatencyMs += durationMs;
            this.toolMetrics.set(tool, existing);
            this.updateServiceMetrics(serviceName, { tools: 1 });
          }

          this.recentRequests.push({
            timestamp: startMs,
            service: serviceName, model, provider, tool, tokensIn, tokensOut, cost,
            latencyMs: durationMs, error: isError,
          });

          if (isError) {
            this.totalErrors++;
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

    const byService: Record<string, { requests: number; tokens: number; cost: number; tools: number }> =
      Object.fromEntries(this.serviceMetrics);

    return {
      totalTokensIn: this.totalTokensIn,
      totalTokensOut: this.totalTokensOut,
      totalCost: this.totalCost,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      totalLinesAdded: this.totalLinesAdded,
      totalLinesDeleted: this.totalLinesDeleted,
      avgLatencyMs: this.latencyTracker.average(),
      p50LatencyMs: this.latencyTracker.percentile(50),
      p95LatencyMs: this.latencyTracker.percentile(95),
      p99LatencyMs: this.latencyTracker.percentile(99),
      byModel: Object.fromEntries(this.modelMetrics),
      byProvider: Object.fromEntries(this.providerMetrics),
      byTool,
      byService,
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
