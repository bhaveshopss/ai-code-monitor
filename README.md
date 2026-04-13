# ai-code-monitor

Real-time monitoring dashboard for AI coding agents. One command to track tokens, costs, and latency for **Claude Code** and any OpenTelemetry-compatible AI tool.

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

#### OpenCode (with telemetry plugin)

Install the [opencode-telemetry-plugin](https://github.com/pai4451/opencode-telemetry-plugin):

```bash
cd /your/project
mkdir -p .opencode/plugin
git clone https://github.com/pai4451/opencode-telemetry-plugin .opencode/plugin/opencode-telemetry
cd .opencode/plugin/opencode-telemetry && npm install && npm run build && cd -
```

Add to `.opencode/opencode.jsonc`:

```jsonc
{
  "plugin": ["file://.opencode/plugin/opencode-telemetry"],
  "experimental": { "openTelemetry": true }
}
```

Then run `opencode` — telemetry auto-exports to `localhost:4318`.

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

### OTLP Logs (Claude Code)

| Log Event | Extracted Data |
|---|---|
| `claude_code.api_request` | tokens, cost, model, latency |
| `claude_code.api_error` | error count |
| `claude_code.tool_result` | tool usage |

### OTLP Metrics (OpenCode plugin)

| Metric | Type | Description |
|---|---|---|
| `opencode.tool.executions` | Counter | Tool execution count |
| `opencode.tool.duration` | Histogram | Tool execution latency (ms) |
| `opencode.tool.loc.added` | Counter | Lines of code added |
| `opencode.tool.loc.deleted` | Counter | Lines of code deleted |
| `opencode.permission.requests` | Counter | Permission ask/accept/reject |

### OTLP Metrics (gen_ai.* semantic conventions)

| Metric | Type | Description |
|---|---|---|
| `gen_ai.client.token.usage` | Histogram | Input/output token counts |
| `gen_ai.client.operation.duration` | Histogram | Request latency |
| `llm.tokens.input` / `llm.tokens.output` | Counter | Token counters |
| `llm.cost.total` | Counter | Cost in USD |
| `llm.request.count` | Counter | Request count |
| `tool.execution.count` | Counter | Tool invocations |

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

## Compatibility

| Tool | Status | Notes |
|---|---|---|
| **Claude Code** | Works | Native OTel log export with token/cost data |
| **OpenCode** | Works (with plugin) | Via [opencode-telemetry-plugin](https://github.com/pai4451/opencode-telemetry-plugin) — tracks tool usage, LOC, permissions |
| **Codex (OpenAI)** | Ready when supported | Codex Rust binary has OTel support; npm `@openai/codex` does not yet export telemetry |
| **Any OTel tool** | Works | Any app exporting OTLP metrics/logs/traces over HTTP |

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
