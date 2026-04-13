# ai-code-monitor

Real-time monitoring dashboard for AI coding agents. One command to track tokens, costs, and latency for **Claude Code**, **Codex**, and any OpenTelemetry-compatible AI tool.

```bash
npx ai-code-monitor
```

## Why?

Teams using AI coding assistants have zero visibility into what they're spending. This tool gives you instant, real-time metrics — no Docker, no Grafana, no config.

## Features

- **OTLP HTTP Receiver** — Standard OpenTelemetry endpoint on port 4318
- **Real-time Web Dashboard** — Token usage, costs, latency charts, live request feed
- **Multi-agent support** — Works with Claude Code, Codex (OpenAI), and any OTel-compatible tool
- **Multi-model tracking** — Breaks down metrics by model, provider, and tool
- **Zero config** — Just run `npx ai-code-monitor` and point your AI CLI at it

## Quick Start

### 1. Start the monitor

```bash
npx ai-code-monitor
```

This starts:
- Dashboard at `http://localhost:3000`
- OTLP receiver at `http://localhost:4318`

### 2. Configure your AI coding agent

#### Claude Code

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
claude
```

#### Codex (OpenAI)

Add to `~/.codex/config.toml`:

```toml
[otel.exporter]
otlp-http = { endpoint = "http://localhost:4318", protocol = "json" }

[otel.trace_exporter]
otlp-http = { endpoint = "http://localhost:4318", protocol = "json" }

[otel.metrics_exporter]
otlp-http = { endpoint = "http://localhost:4318", protocol = "json" }
```

Then run `codex` as usual.

#### Any OTel-compatible tool

Point OTLP HTTP export to `http://localhost:4318`:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
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

## Supported Telemetry Formats

### OTLP Metrics (Codex, gen_ai.* conventions)

| Metric | Type | Source |
|---|---|---|
| `codex.api_request` | Counter | Codex API request count |
| `codex.api_request.duration_ms` | Histogram | Codex API latency |
| `codex.tool.call` | Counter | Codex tool invocations |
| `codex.tool.call.duration_ms` | Histogram | Codex tool latency |
| `codex.turn.token_usage` | Counter | Codex per-turn token usage |
| `gen_ai.client.token.usage` | Histogram | OTel GenAI semantic conventions |
| `gen_ai.client.operation.duration` | Histogram | OTel GenAI semantic conventions |
| `llm.tokens.input` / `llm.tokens.output` | Counter | Generic LLM metrics |
| `llm.cost.total` | Counter | Generic cost tracking |

### OTLP Logs (Claude Code, Codex)

| Log Event | Source | Extracted Data |
|---|---|---|
| `claude_code.api_request` | Claude Code | tokens, cost, model, latency |
| `claude_code.api_error` | Claude Code | error count |
| `claude_code.tool_result` | Claude Code | tool usage |
| `codex.api_request` | Codex | latency, model, status |
| `codex.sse_event` | Codex | token counts (input/output/cached/reasoning) |
| `codex.tool_result` | Codex | tool usage, duration |

### OTLP Traces

Any OTLP trace with `gen_ai.*` attributes is automatically parsed for token counts, model, provider, and latency.

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

## Supported Tools

| Tool | Support | How |
|---|---|---|
| **Claude Code** | Native OTel logs | Set `CLAUDE_CODE_ENABLE_TELEMETRY=1` + OTLP env vars |
| **Codex (OpenAI)** | Native OTel metrics/logs/traces | Configure `~/.codex/config.toml` |
| **Any OTel tool** | OTLP HTTP | Point `OTEL_EXPORTER_OTLP_ENDPOINT` at the monitor |

> **Note:** OpenCode/Crush do not currently export OpenTelemetry data and cannot be monitored directly.

## Tech Stack

- **TypeScript** + Node.js
- **Express** — HTTP server
- **WebSocket (ws)** — Real-time dashboard updates
- **Chart.js** — Charts via CDN
- **OpenTelemetry** — Standard OTLP HTTP protocol

## Development

```bash
git clone https://github.com/bhaveshopss/ai-code-monitor.git
cd ai-code-monitor
npm install
npm run dev
```

## License

MIT
