# ai-code-monitor

Real-time monitoring dashboard for AI coding agents. One command to track tokens, costs, and latency for **Claude Code**, **OpenCode**, and any OpenTelemetry-compatible AI tool.

```bash
npx ai-code-monitor
```

## Why?

Teams using AI coding assistants have zero visibility into what they're spending. This tool gives you instant, real-time metrics — no Docker, no Grafana, no config.

## Features

- **OTLP HTTP Receiver** — Standard OpenTelemetry endpoint on port 4318
- **Real-time Web Dashboard** — Token usage, costs, latency charts, live request feed
- **Multi-model tracking** — Breaks down metrics by model, provider, and tool
- **Zero config** — Just run `npx ai-code-monitor` and point your AI CLI at it
- **Works with Claude Code** — Claude Code has built-in OTel telemetry support

## Quick Start

### 1. Start the monitor

```bash
npx ai-code-monitor
```

This starts:
- Dashboard at `http://localhost:3000`
- OTLP receiver at `http://localhost:4318`

### 2. Configure Claude Code

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
claude
```

### 3. View the dashboard

Open `http://localhost:3000` in your browser. Metrics appear in real-time as you use your AI coding agent.

## Dashboard

The dashboard shows:

| Section | What it shows |
|---|---|
| **Summary Cards** | Total tokens (in/out), cost, requests, errors, avg latency |
| **Token Chart** | Token usage over time (1-minute buckets) |
| **Cost Chart** | Cost accumulation over time |
| **Model Breakdown** | Doughnut chart of requests by model |
| **Tool Breakdown** | Doughnut chart of tool executions |
| **Live Feed** | Real-time table of recent requests |
| **Logs Panel** | Collapsible log stream from connected services |

## CLI Options

```
Usage: ai-code-monitor [options]

Options:
  -p, --port <number>       Dashboard port (default: 3000)
  -o, --otlp-port <number>  OTLP receiver port (default: 4318)
  --no-open                 Don't auto-open browser
  -V, --version             Show version
  -h, --help                Show help
```

### Examples

```bash
# Custom ports
npx ai-code-monitor --port 8080 --otlp-port 9999

# Don't auto-open browser
npx ai-code-monitor --no-open
```

## Supported Metrics

The monitor recognizes these OpenTelemetry metric names:

| Metric | Type | Description |
|---|---|---|
| `llm.tokens.input` | Counter | Input tokens consumed |
| `llm.tokens.output` | Counter | Output tokens generated |
| `llm.cost.total` | Counter | Cost in USD |
| `llm.request.duration` | Histogram | Request latency |
| `llm.request.count` | Counter | Number of LLM requests |
| `llm.request.errors` | Counter | Failed requests |
| `tool.execution.duration` | Histogram | Tool execution latency |
| `tool.execution.count` | Counter | Tool invocations |

Also supports `gen_ai.client.*` semantic conventions.

## OTLP Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `POST /v1/metrics` | POST | Receive OTel metrics |
| `POST /v1/logs` | POST | Receive OTel logs |
| `POST /v1/traces` | POST | Receive OTel traces |
| `GET /health` | GET | Health check |

## REST API

| Endpoint | Description |
|---|---|
| `GET /api/snapshot` | Full metrics snapshot |
| `GET /api/requests?limit=N` | Recent request events |
| `GET /api/logs?limit=N` | Recent log entries |
| `GET /api/config` | Monitor configuration |

## Works With

- **Claude Code** — Set `CLAUDE_CODE_ENABLE_TELEMETRY=1` + OTLP env vars
- **OpenCode / Crush** — Add OTel instrumentation (see [implementation guide](./OPENCODE_INSTRUMENTATION.md))
- **Any OTel-compatible tool** — Any app that exports OTLP metrics/logs/traces

## Tech Stack

- **TypeScript** + Node.js
- **Express** — HTTP server
- **WebSocket (ws)** — Real-time dashboard updates
- **Chart.js** — Charts via CDN
- **OpenTelemetry** — Standard OTLP HTTP protocol

## Development

```bash
git clone https://github.com/bhaveshkumarparmar/ai-code-monitor.git
cd ai-code-monitor
npm install
npm run dev
```

## License

MIT
