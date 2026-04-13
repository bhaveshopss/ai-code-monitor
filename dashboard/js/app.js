// AI Code Monitor — Dashboard Client

const CHART_COLORS = [
  "#58a6ff", "#3fb950", "#bc8cff", "#d29922",
  "#f85149", "#39d2c0", "#f778ba", "#79c0ff",
];

// Service name → display label and color
const SERVICE_STYLES = {
  "claude-code":  { label: "Claude Code", color: "#bc8cff" },
  "claude_code":  { label: "Claude Code", color: "#bc8cff" },
  "opencode":     { label: "OpenCode",    color: "#3fb950" },
  "codex":        { label: "Codex",       color: "#58a6ff" },
  "codex-cli":    { label: "Codex",       color: "#58a6ff" },
};

function getServiceStyle(name) {
  const key = (name || "").toLowerCase().replace(/\s+/g, "-");
  return SERVICE_STYLES[key] || { label: name || "Unknown", color: "#8b949e" };
}

// --- State ---
let ws = null;
let snapshot = null;
let tokenChart = null;
let costChart = null;
let modelChart = null;
let toolChart = null;

// --- Formatters ---

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

function formatCost(n) {
  if (n >= 100) return "$" + n.toFixed(0);
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toFixed(4);
}

function formatLatency(ms) {
  if (ms <= 0) return "--";
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms) + "ms";
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

// --- Safe DOM helpers (no innerHTML with untrusted content) ---

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function createEl(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

function createTd(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

// --- Chart Setup ---

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: {
      grid: { color: "rgba(48,54,61,0.5)" },
      ticks: { color: "#8b949e", font: { size: 10 } },
    },
    y: {
      grid: { color: "rgba(48,54,61,0.5)" },
      ticks: { color: "#8b949e", font: { size: 10 } },
      beginAtZero: true,
    },
  },
};

function initCharts() {
  const tokenCtx = document.getElementById("tokenChart").getContext("2d");
  tokenChart = new Chart(tokenCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Tokens",
        data: [],
        borderColor: "#58a6ff",
        backgroundColor: "rgba(88,166,255,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        borderWidth: 2,
      }],
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins },
    },
  });

  const costCtx = document.getElementById("costChart").getContext("2d");
  costChart = new Chart(costCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Cost ($)",
        data: [],
        borderColor: "#3fb950",
        backgroundColor: "rgba(63,185,80,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        borderWidth: 2,
      }],
    },
    options: {
      ...chartDefaults,
      scales: {
        ...chartDefaults.scales,
        y: {
          ...chartDefaults.scales.y,
          ticks: {
            ...chartDefaults.scales.y.ticks,
            callback: v => "$" + v.toFixed(2),
          },
        },
      },
    },
  });

  const modelCtx = document.getElementById("modelChart").getContext("2d");
  modelChart = new Chart(modelCtx, {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: CHART_COLORS,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: { legend: { display: false } },
      cutout: "65%",
    },
  });

  const toolCtx = document.getElementById("toolChart").getContext("2d");
  toolChart = new Chart(toolCtx, {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: CHART_COLORS.slice().reverse(),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: { legend: { display: false } },
      cutout: "65%",
    },
  });
}

// --- Update Functions ---

function updateCards(data) {
  document.getElementById("tokensIn").textContent = formatNumber(data.totalTokensIn);
  document.getElementById("tokensOut").textContent = formatNumber(data.totalTokensOut);
  document.getElementById("totalCost").textContent = formatCost(data.totalCost);
  document.getElementById("totalRequests").textContent = formatNumber(data.totalRequests);
  document.getElementById("totalErrors").textContent = formatNumber(data.totalErrors);
  document.getElementById("avgLatency").textContent = formatLatency(data.avgLatencyMs);

  const errorRate = data.totalRequests > 0
    ? ((data.totalErrors / data.totalRequests) * 100).toFixed(1) + "%"
    : "0%";
  document.getElementById("errorRate").textContent = errorRate;
  document.getElementById("p99Latency").textContent = "p99: " + formatLatency(data.p99LatencyMs);

  document.getElementById("uptime").textContent = formatUptime(data.uptimeMs);

  const totalLoc = (data.totalLinesAdded || 0) + (data.totalLinesDeleted || 0);
  document.getElementById("linesChanged").textContent = formatNumber(totalLoc);
  document.getElementById("linesSub").textContent =
    "+" + formatNumber(data.totalLinesAdded || 0) + " / -" + formatNumber(data.totalLinesDeleted || 0);

  const servicesEl = document.getElementById("connectedServices");
  if (data.connectedServices && data.connectedServices.length > 0) {
    servicesEl.textContent = data.connectedServices.join(", ");
  }
}

function updateTimeSeriesChart(chart, series) {
  if (!series || series.length === 0) return;
  chart.data.labels = series.map(p => formatTime(p.timestamp));
  chart.data.datasets[0].data = series.map(p => p.value);
  chart.update("none");
}

function updateDoughnutChart(chart, legendEl, dataMap, valueKey) {
  const entries = Object.entries(dataMap);
  if (entries.length === 0) return;

  const sorted = entries.sort((a, b) => b[1][valueKey] - a[1][valueKey]);
  chart.data.labels = sorted.map(([k]) => k);
  chart.data.datasets[0].data = sorted.map(([, v]) => v[valueKey]);
  chart.update("none");

  // Build legend using safe DOM methods
  clearChildren(legendEl);
  const total = sorted.reduce((s, [, val]) => s + val[valueKey], 0);
  const colors = chart === modelChart ? CHART_COLORS : CHART_COLORS.slice().reverse();

  sorted.forEach(([k, v], i) => {
    const pct = total > 0 ? ((v[valueKey] / total) * 100).toFixed(0) : 0;
    const item = createEl("span", "legend-item");
    const dot = createEl("span", "legend-dot");
    dot.style.background = colors[i % colors.length];
    item.appendChild(dot);
    item.appendChild(document.createTextNode(` ${k} (${pct}%)`));
    legendEl.appendChild(item);
  });
}

function updateFeed(requests) {
  const tbody = document.getElementById("feedBody");
  if (!requests || requests.length === 0) return;

  document.getElementById("feedCount").textContent = requests.length + " events";

  // Show last 50, newest first
  const recent = requests.slice(-50).reverse();

  clearChildren(tbody);
  recent.forEach((r, i) => {
    const tr = document.createElement("tr");
    if (r.error) tr.className = "error-row";
    if (i === 0) tr.classList.add("new-row");

    tr.appendChild(createTd(formatTime(r.timestamp)));

    // Source badge
    const sourceTd = document.createElement("td");
    const style = getServiceStyle(r.service);
    const badge = createEl("span", "service-badge");
    badge.textContent = style.label;
    badge.style.borderColor = style.color;
    badge.style.color = style.color;
    sourceTd.appendChild(badge);
    tr.appendChild(sourceTd);

    tr.appendChild(createTd(r.model || "--"));
    tr.appendChild(createTd(r.provider || "--"));
    tr.appendChild(createTd(r.tool || "--"));
    tr.appendChild(createTd(formatNumber(r.tokensIn)));
    tr.appendChild(createTd(formatNumber(r.tokensOut)));
    tr.appendChild(createTd(formatCost(r.cost)));
    tr.appendChild(createTd(formatLatency(r.latencyMs)));

    tbody.appendChild(tr);
  });
}

function updateLogs(logs) {
  const container = document.getElementById("logsContent");
  if (!logs || logs.length === 0) return;

  const recent = logs.slice(-100).reverse();

  clearChildren(container);
  recent.forEach(l => {
    const sevClass = (l.severity || "INFO").toUpperCase();

    const entry = createEl("div", "log-entry");
    entry.appendChild(createEl("span", "log-time", formatTime(l.timestamp)));
    entry.appendChild(createEl("span", "log-severity " + sevClass, sevClass));
    entry.appendChild(createEl("span", "log-service", l.service || ""));
    entry.appendChild(createEl("span", "log-message", l.message));

    container.appendChild(entry);
  });
}

function updateServiceCards(byService) {
  const container = document.getElementById("serviceCards");
  if (!byService || Object.keys(byService).length === 0) return;

  clearChildren(container);

  const entries = Object.entries(byService).sort((a, b) => b[1].requests - a[1].requests);

  entries.forEach(([name, stats]) => {
    const style = getServiceStyle(name);

    const card = createEl("div", "service-card");
    card.style.borderLeftColor = style.color;

    const header = createEl("div", "service-card-header");
    const dot = createEl("span", "service-dot");
    dot.style.background = style.color;
    header.appendChild(dot);
    header.appendChild(createEl("span", "service-card-name", style.label));
    card.appendChild(header);

    const stats_row = createEl("div", "service-card-stats");
    stats_row.appendChild(createStatItem("Requests", formatNumber(stats.requests)));
    stats_row.appendChild(createStatItem("Tokens", formatNumber(stats.tokens)));
    stats_row.appendChild(createStatItem("Cost", formatCost(stats.cost)));
    stats_row.appendChild(createStatItem("Tools", formatNumber(stats.tools)));
    card.appendChild(stats_row);

    container.appendChild(card);
  });
}

function createStatItem(label, value) {
  const item = createEl("div", "service-stat-item");
  item.appendChild(createEl("div", "service-stat-label", label));
  item.appendChild(createEl("div", "service-stat-value", value));
  return item;
}

function updateAll(data) {
  snapshot = data;
  updateCards(data);
  updateTimeSeriesChart(tokenChart, data.tokenTimeSeries);
  updateTimeSeriesChart(costChart, data.costTimeSeries);

  if (data.byModel && Object.keys(data.byModel).length > 0) {
    updateDoughnutChart(
      modelChart,
      document.getElementById("modelLegend"),
      data.byModel,
      "requests"
    );
  }

  if (data.byTool && Object.keys(data.byTool).length > 0) {
    updateDoughnutChart(
      toolChart,
      document.getElementById("toolLegend"),
      data.byTool,
      "count"
    );
  }

  updateServiceCards(data.byService);
  updateFeed(data.recentRequests);
  updateLogs(data.recentLogs);
}

// --- WebSocket ---

let wsReconnectDelay = 1000;
const WS_MAX_RECONNECT_DELAY = 30000;

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${location.host}/ws`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    wsReconnectDelay = 1000; // Reset backoff on successful connect
    const badge = document.getElementById("connectionStatus");
    badge.className = "status-badge status-connected";
    clearChildren(badge);
    const dot = createEl("span", "status-dot");
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(" Connected"));
    console.log("[WS] Connected");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "snapshot" || msg.type === "metric_update") {
        updateAll(msg.data);
      } else if (msg.type === "new_logs") {
        updateLogs(msg.data);
      }
    } catch (err) {
      console.error("[WS] Parse error:", err);
    }
  };

  ws.onclose = () => {
    const badge = document.getElementById("connectionStatus");
    badge.className = "status-badge status-disconnected";
    clearChildren(badge);
    const dot = createEl("span", "status-dot");
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(" Disconnected"));
    console.log("[WS] Disconnected, reconnecting in " + (wsReconnectDelay / 1000) + "s...");
    setTimeout(connectWebSocket, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_MAX_RECONNECT_DELAY);
  };

  ws.onerror = (err) => {
    console.error("[WS] Error:", err);
    // Don't call ws.close() here — the close event fires automatically after error
  };
}

// --- Logs toggle ---

document.getElementById("logsToggle").addEventListener("click", () => {
  const body = document.getElementById("logsBody");
  const icon = document.getElementById("logsToggleIcon");
  const isOpen = body.style.display !== "none";
  body.style.display = isOpen ? "none" : "block";
  icon.classList.toggle("open", !isOpen);
});

// --- Init ---

initCharts();
connectWebSocket();

// Fetch initial data via REST as fallback
fetch("/api/snapshot")
  .then(r => r.json())
  .then(data => updateAll(data))
  .catch(() => {});
