// ai-code-monitor — Built-in OpenCode Telemetry Plugin
// Zero dependencies. Sends OTLP metrics directly via fetch().
// Installed automatically by: npx ai-code-monitor setup-opencode

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

// --- The plugin ---

export default async function plugin(input) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_ENDPOINT;
  const metricsUrl = endpoint.replace(/\/$/, "") + "/v1/metrics";

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
