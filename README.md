# ai-code-monitor

Real-time monitoring dashboard for AI coding agents. One command to track tokens, costs, and latency for **Claude Code**, **OpenCode**, and any OpenTelemetry-compatible AI tool.

```bash
npx ai-code-monitor
```

## Why?

AI coding assistants are powerful — but expensive and opaque. Teams have zero visibility into what they're spending, which models are being used, or how tools perform. **ai-code-monitor** gives you instant, real-time metrics with one command — no Docker, no Grafana, no config files.

## Features

- **One-command setup** — `npx ai-code-monitor` and you're running
- **Real-time dashboard** — Token usage, costs, latency charts, live request feed via WebSocket
- **Multi-agent support** — Monitor Claude Code, OpenCode, and any OTel-compatible tool side by side
- **Multi-model tracking** — Breaks down metrics by model, provider, and tool
- **Provider detection** — Automatically identifies Amazon Bedrock, Anthropic, OpenAI, Google, and more from model IDs
- **Standard OTLP** — Receives OpenTelemetry metrics, logs, and traces over HTTP on port 4318

---

## Quick Start

### Step 1: Start the monitor

```bash
npx ai-code-monitor
```

This starts two servers:
- **Dashboard** at `http://localhost:3000` — open in your browser
- **OTLP receiver** at `http://localhost:4318` — where agents send telemetry

### Step 2: Connect your AI coding agent

#### Claude Code (recommended)

Set these environment variables before running Claude Code:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
claude
```

**Tip:** Add these to your `.bashrc` / `.zshrc` so telemetry is always on:

```bash
# ~/.zshrc
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

**What gets tracked:** tokens (input/output/cache), cost per request, model, latency, tool usage (Bash, Read, Write, etc.), errors.

#### OpenCode

One command — no manual config needed:

```bash
cd /your/project
npx ai-code-monitor setup-opencode
opencode
```

This installs a lightweight telemetry plugin into `.opencode/plugin/` and configures `opencode.jsonc` automatically.

**What gets tracked:** tool executions, tool latency, lines of code added/deleted, permissions, and token usage via AI SDK trace export.

**Custom endpoint:**

```bash
npx ai-code-monitor setup-opencode --endpoint http://myserver:4318
```

#### Codex CLI

Codex CLI has OTel infrastructure built into its Rust binary. Run the setup command to configure it:

```bash
npx ai-code-monitor setup-codex
codex
```

This writes OTLP HTTP export config to `~/.codex/config.toml`.

> **Note:** Codex CLI v0.120.0 currently filters OTel exports to internal analytics (Statsig). Full OTLP export support is expected in a future release. The setup command and metric handling are ready — it will work automatically once OpenAI enables public OTLP export.

#### Kiro CLI

Kiro CLI monitoring is **automatic** — just run the monitor and use kiro-cli normally:

```bash
# Terminal 1: Start the monitor (auto-sets up kiro-cli wrapper)
npx ai-code-monitor

# Terminal 2: Use kiro-cli with telemetry
export PATH=.kiro/bin:$PATH
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
kiro-cli help
```

The wrapper automatically captures execution time and success/failure, then sends it to the monitor.

**Manual setup (if needed):**

```bash
npx ai-code-monitor setup-kiro
```

**Custom endpoint:**

```bash
npx ai-code-monitor setup-kiro --endpoint http://localhost:9999
```

#### Any OTel-compatible tool

Any tool that exports OTLP over HTTP works out of the box:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
```

### Step 3: View the dashboard

Open `http://localhost:3000` in your browser. Metrics appear in real-time as you use your AI coding agent. The dashboard auto-updates every 5 seconds via WebSocket.

---

## Dashboard


| Section | What it shows |
|---|---|
| **Summary Cards** | Total tokens (in/out), cost, requests, errors, avg latency, lines changed |
| **Token Chart** | Token usage over time (1-minute buckets) |
| **Cost Chart** | Cost accumulation over time |
| **Model Breakdown** | Doughnut chart of requests by model |
| **Tool Breakdown** | Doughnut chart of tool executions with avg latency |
| **Service Breakdown** | Per-service stats (Claude Code, OpenCode, etc.) |
| **Live Feed** | Real-time table of recent requests with model, provider, tokens, cost |
| **Logs Panel** | Collapsible log stream from all connected services |

---

## CLI Reference

```
Usage: ai-code-monitor [options] [command]

Options:
  -p, --port <number>       Dashboard port (default: 3000)
  -o, --otlp-port <number>  OTLP receiver port (default: 4318)
  --no-open                 Don't auto-open browser
  -V, --version             Show version
  -h, --help                Show help

Commands:
  setup-opencode            Install OpenCode telemetry plugin in current project
  setup-codex               Configure Codex CLI OTel export in ~/.codex/config.toml
  setup-kiro                Set up Kiro CLI telemetry monitoring
```

### Examples

```bash
# Default — dashboard on 3000, OTLP on 4318
npx ai-code-monitor

# Custom ports
npx ai-code-monitor --port 8080 --otlp-port 9999

# Don't auto-open browser
npx ai-code-monitor --no-open

# Set up OpenCode monitoring (one-time, per project)
cd /your/project && npx ai-code-monitor setup-opencode

# Set up Codex CLI monitoring (one-time, writes to ~/.codex/config.toml)
npx ai-code-monitor setup-codex
```

---

## Compatibility

| Tool | Status | Setup | What's tracked |
|---|---|---|---|
| **Claude Code** | Full support | Env vars | Tokens, cost, model, latency, tools, errors |
| **OpenCode** | Full support | `npx ai-code-monitor setup-opencode` | Tool executions, LOC changes, permissions, tokens via AI SDK |
| **Kiro CLI** | Full support | Auto (on first `npm start`) | Execution time, success/failure |
| **Codex CLI** | Config ready | `npx ai-code-monitor setup-codex` | Waiting on OpenAI to enable public OTLP export |
| **Any OTel tool** | Full support | `OTEL_EXPORTER_OTLP_ENDPOINT` env var | Whatever metrics/logs/traces the tool exports |

### Provider auto-detection

ai-code-monitor automatically detects your cloud provider from model IDs:

| Pattern | Detected Provider |
|---|---|
| `claude-opus-4-6` (no date suffix) | Amazon Bedrock |
| `claude-opus-4-6-20250514` (with date) | Anthropic (direct API) |
| `global.anthropic.*`, `us.*`, `eu.*`, ARN | Amazon Bedrock |
| `gpt-*`, `o1*`, `o3*`, `o4*` | OpenAI |
| `gemini-*` | Google |

---

## REST API

The monitor exposes a JSON API for programmatic access:

| Endpoint | Description |
|---|---|
| `GET /api/snapshot` | Full metrics snapshot (tokens, cost, latency, breakdowns) |
| `GET /api/requests?limit=N` | Recent request events |
| `GET /api/logs?limit=N` | Recent log entries |
| `GET /api/config` | Monitor configuration |
| `GET /health` | Health check |

### OTLP Endpoints (for agents)

| Endpoint | Description |
|---|---|
| `POST /v1/metrics` | Receive OTel metrics |
| `POST /v1/logs` | Receive OTel logs |
| `POST /v1/traces` | Receive OTel traces |

---

## Roadmap

### Team Dashboard (coming next)

We're building **team-level monitoring** so engineering leads and managers can see usage across the entire team:

- **Per-developer breakdown** — See which team members are using AI agents, how much they're spending, and what models they prefer
- **Team cost tracking** — Aggregate cost dashboard with daily/weekly/monthly rollups
- **Shared dashboard** — One URL the whole team can access to view real-time and historical usage
- **Usage alerts** — Get notified when team spend exceeds thresholds
- **Project-level metrics** — Break down costs by project/repository, not just by person

If you're interested in the team dashboard, star the repo and [open an issue](https://github.com/bhaveshopss/ai-code-monitor/issues) with your use case.

---

## Supported Telemetry Formats

<details>
<summary>OTLP Logs (Claude Code)</summary>

| Log Event | Extracted Data |
|---|---|
| `claude_code.api_request` | tokens, cost, model, latency, cache tokens |
| `claude_code.api_error` | error count, model, status code |
| `claude_code.tool_result` | tool name, duration, success/failure |

</details>

<details>
<summary>OTLP Metrics (OpenCode plugin)</summary>

| Metric | Type | Description |
|---|---|---|
| `opencode.tool.executions` | Counter | Tool execution count |
| `opencode.tool.duration` | Histogram | Tool execution latency (ms) |
| `opencode.tool.loc.added` | Counter | Lines of code added |
| `opencode.tool.loc.deleted` | Counter | Lines of code deleted |

</details>

<details>
<summary>OTLP Logs + Metrics (Codex CLI — when enabled)</summary>

| Event / Metric | Type | Description |
|---|---|---|
| `codex.api_request` | Log / Counter | API requests with token counts, model, latency |
| `codex.sse_event` | Log | SSE events with token counts |
| `codex.tool.call` | Counter | Tool call count |
| `codex.tool.call.duration_ms` | Histogram | Tool call latency (ms) |
| `codex.turn.token_usage` | Counter | Per-turn token usage |
| `codex.api_request.duration_ms` | Histogram | API request latency (ms) |

</details>

<details>
<summary>OTLP Metrics (gen_ai.* semantic conventions)</summary>

| Metric | Type | Description |
|---|---|---|
| `gen_ai.client.token.usage` | Histogram | Input/output token counts |
| `gen_ai.client.operation.duration` | Histogram | Request latency |
| `llm.tokens.input` / `llm.tokens.output` | Counter | Token counters |
| `llm.cost.total` | Counter | Cost in USD |
| `llm.request.count` | Counter | Request count |
| `tool.execution.count` | Counter | Tool invocations |

</details>

<details>
<summary>OTLP Traces</summary>

Any OTLP trace with `gen_ai.*` attributes is automatically parsed for token counts, model, provider, and latency.

</details>

---

## Tech Stack

- **TypeScript** + Node.js
- **Express** — HTTP server
- **WebSocket (ws)** — Real-time dashboard updates (5s interval)
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
