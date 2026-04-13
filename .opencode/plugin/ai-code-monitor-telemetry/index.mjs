// ai-code-monitor — Built-in OpenCode Telemetry Plugin
// Sends OTLP metrics via fetch() AND bootstraps OTel tracing so the
// Vercel AI SDK's experimental_telemetry exports token/model spans.

const EXPORT_INTERVAL_MS = 5000;
const DEFAULT_ENDPOINT = "http://localhost:4318";

// --- Language detection from file extension ---
const LANG_MAP = {
  js: "javascript", ts: "typescript", jsx: "javascript", tsx: "typescript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  kt: "kotlin", swift: "swift", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", php: "php", sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", html: "html", css: "css", scss: "scss", less: "less",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml",
  md: "markdown", txt: "text", lua: "lua", r: "r", dart: "dart",
  ex: "elixir", exs: "elixir", erl: "erlang", zig: "zig", nim: "nim",
  vue: "vue", svelte: "svelte", astro: "astro",
};

function inferLanguage(filePath) {
  if (!filePath) return "";
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return LANG_MAP[ext] || ext;
}

// --- Metric accumulators (DELTA temporality, flushed each interval) ---

class MetricAccumulator {
  constructor() {
    this.counters = new Map();   // key -> value
    this.histograms = new Map(); // key -> { count, sum, min, max }
  }

  addCounter(name, value, attributes) {
    const key = name + "|" + JSON.stringify(attributes);
    const existing = this.counters.get(key) || { name, value: 0, attributes };
    existing.value += value;
    this.counters.set(key, existing);
  }

  addHistogram(name, value, attributes) {
    const key = name + "|" + JSON.stringify(attributes);
    const existing = this.histograms.get(key) || {
      name, count: 0, sum: 0, min: Infinity, max: -Infinity, attributes,
    };
    existing.count += 1;
    existing.sum += value;
    existing.min = Math.min(existing.min, value);
    existing.max = Math.max(existing.max, value);
    this.histograms.set(key, existing);
  }

  flush() {
    const counters = [...this.counters.values()];
    const histograms = [...this.histograms.values()];
    this.counters.clear();
    this.histograms.clear();
    return { counters, histograms };
  }

  get isEmpty() {
    return this.counters.size === 0 && this.histograms.size === 0;
  }
}

// --- Build OTLP JSON payload ---

function makeAttribute(key, value) {
  return { key, value: { stringValue: String(value) } };
}

function buildOtlpPayload(counters, histograms) {
  const now = String(Date.now() * 1_000_000); // nanoseconds
  const metrics = [];

  for (const c of counters) {
    if (c.value === 0) continue;
    metrics.push({
      name: c.name,
      sum: {
        dataPoints: [{
          asInt: String(c.value),
          startTimeUnixNano: now,
          timeUnixNano: now,
          attributes: Object.entries(c.attributes).map(([k, v]) => makeAttribute(k, v)),
        }],
        aggregationTemporality: 1, // DELTA
        isMonotonic: true,
      },
    });
  }

  for (const h of histograms) {
    if (h.count === 0) continue;
    metrics.push({
      name: h.name,
      histogram: {
        dataPoints: [{
          count: String(h.count),
          sum: h.sum,
          min: h.min === Infinity ? 0 : h.min,
          max: h.max === -Infinity ? 0 : h.max,
          startTimeUnixNano: now,
          timeUnixNano: now,
          attributes: Object.entries(h.attributes).map(([k, v]) => makeAttribute(k, v)),
        }],
        aggregationTemporality: 1, // DELTA
      },
    });
  }

  if (metrics.length === 0) return null;

  return {
    resourceMetrics: [{
      resource: {
        attributes: [
          makeAttribute("service.name", "opencode"),
          makeAttribute("service.version", "ai-code-monitor-plugin-1.0.0"),
          makeAttribute("telemetry.sdk.name", "ai-code-monitor"),
        ],
      },
      scopeMetrics: [{ metrics }],
    }],
  };
}

// --- OTel Trace Bootstrapping ---
// The Vercel AI SDK creates OTel spans when experimental_telemetry is enabled,
// but only if a TracerProvider is registered. OpenCode doesn't set one up,
// so we register one here with a custom OTLP/HTTP exporter using fetch.
// @opentelemetry/api uses Symbol.for() for global state, so even if there are
// multiple copies of the package, our TracerProvider is visible to the AI SDK.

async function setupOtelTracing(endpoint) {
  try {
    const { BasicTracerProvider, SimpleSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
    const { Resource } = await import("@opentelemetry/resources");

    // Minimal OTLP/HTTP trace exporter using fetch (works in Bun and Node)
    class FetchTraceExporter {
      constructor(url) {
        this._url = url;
        this._stopped = false;
      }

      export(spans, cb) {
        if (this._stopped || !spans.length) { cb({ code: 0 }); return; }

        const resourceSpans = [{
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "opencode" } },
              { key: "telemetry.sdk.name", value: { stringValue: "ai-code-monitor" } },
            ],
          },
          scopeSpans: [{
            scope: { name: "ai" },
            spans: spans.map(s => this._convert(s)),
          }],
        }];

        fetch(this._url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resourceSpans }),
        })
          .then(() => cb({ code: 0 }))
          .catch(() => cb({ code: 0 }));
      }

      shutdown() { this._stopped = true; return Promise.resolve(); }
      forceFlush() { return Promise.resolve(); }

      _convert(span) {
        const ctx = span.spanContext();
        const toNano = (hr) => String(BigInt(hr[0]) * 1_000_000_000n + BigInt(hr[1]));

        const attrs = [];
        for (const [k, v] of Object.entries(span.attributes || {})) {
          if (v == null) continue;
          if (typeof v === "number") {
            attrs.push({ key: k, value: Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v } });
          } else if (typeof v === "boolean") {
            attrs.push({ key: k, value: { boolValue: v } });
          } else {
            attrs.push({ key: k, value: { stringValue: String(v) } });
          }
        }

        return {
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          parentSpanId: span.parentSpanId || undefined,
          name: span.name,
          kind: span.kind ?? 0,
          startTimeUnixNano: toNano(span.startTime),
          endTimeUnixNano: toNano(span.endTime),
          attributes: attrs,
          status: span.status?.code ? { code: span.status.code, message: span.status.message } : undefined,
        };
      }
    }

    const tracesUrl = endpoint.replace(/\/$/, "") + "/v1/traces";
    const exporter = new FetchTraceExporter(tracesUrl);

    const provider = new BasicTracerProvider({
      resource: new Resource({ "service.name": "opencode" }),
    });
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();

    console.log("[ai-code-monitor] OTel tracing registered →", tracesUrl);
    return true;
  } catch (err) {
    // OTel packages not available — metrics still work, traces won't
    console.warn("[ai-code-monitor] OTel tracing unavailable:", err?.message ?? String(err));
    return false;
  }
}

// --- The plugin ---

async function plugin(input) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_ENDPOINT;
  const metricsUrl = endpoint.replace(/\/$/, "") + "/v1/metrics";

  // Bootstrap OTel tracing so AI SDK spans (tokens, model, latency) get exported
  await setupOtelTracing(endpoint);

  const accumulator = new MetricAccumulator();
  const callContexts = new Map(); // callID -> { tool, sessionID, startTime }

  // Periodic flush
  const flushInterval = setInterval(async () => {
    if (accumulator.isEmpty) return;
    const { counters, histograms } = accumulator.flush();
    const payload = buildOtlpPayload(counters, histograms);
    if (!payload) return;

    try {
      await fetch(metricsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Silently ignore — monitor may not be running
    }
  }, EXPORT_INTERVAL_MS);

  // Don't let the interval keep the process alive
  if (flushInterval.unref) flushInterval.unref();

  return {
    // Before tool execution — record start time
    "tool.execute.before": async ({ tool, sessionID, callID }) => {
      callContexts.set(callID, {
        tool: tool ?? "unknown",
        sessionID: sessionID ?? "",
        startTime: Date.now(),
      });
    },

    // After tool execution — record metrics
    "tool.execute.after": async ({ tool, sessionID, callID, args }, output) => {
      const ctx = callContexts.get(callID);
      const durationMs = ctx ? Date.now() - ctx.startTime : 0;
      const toolName = tool ?? ctx?.tool ?? "unknown";

      callContexts.delete(callID);

      const baseAttrs = {
        "tool.name": toolName,
        "session.id": sessionID ?? ctx?.sessionID ?? "",
      };

      // Tool execution counter
      const status = output?.metadata?.error ? "error" : "success";
      accumulator.addCounter("opencode.tool.executions", 1, {
        ...baseAttrs, "tool.status": status,
      });

      // Tool duration histogram
      if (durationMs > 0) {
        accumulator.addHistogram("opencode.tool.duration", durationMs, baseAttrs);
      }

      // Lines of code from file diffs
      const filediff = output?.metadata?.filediff;
      if (filediff) {
        const diffs = Array.isArray(filediff) ? filediff : [filediff];
        for (const diff of diffs) {
          const file = diff.file || "";
          const language = inferLanguage(file);
          const locAttrs = { ...baseAttrs, "file.path": file, language };

          if (diff.additions > 0) {
            accumulator.addCounter("opencode.tool.loc.added", diff.additions, locAttrs);
          }
          if (diff.deletions > 0) {
            accumulator.addCounter("opencode.tool.loc.deleted", diff.deletions, locAttrs);
          }
        }
      }
    },

    // Permission events
    event: async ({ event }) => {
      if (!event) return;
      const type = event.type ?? "";

      if (type === "permission.asked" || type === "permission.replied") {
        const props = event.properties || {};
        const attrs = {
          "permission.name": props.permission ?? props.name ?? "",
          "permission.reply": props.reply ?? props.status ?? type.split(".")[1],
        };
        accumulator.addCounter("opencode.permission.requests", 1, attrs);
      }
    },
  };
}

// OpenCode expects a PluginModule with a `server` property
export default {
  id: "ai-code-monitor-telemetry",
  server: plugin,
};
