import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import type { MetricsStore } from "../store/metrics-store.js";
import { createOtlpRouter } from "./otlp-receiver.js";
import { createWebSocketServer } from "./websocket.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOptions {
  dashboardPort: number;
  otlpPort: number;
}

export function startServers(store: MetricsStore, options: ServerOptions) {
  // --- Dashboard + API server ---
  const dashboardApp = express();
  dashboardApp.use(express.json({ limit: "50mb" }));

  // Serve dashboard static files
  // __dirname is dist/src/server/ → go up 3 levels to project root
  const dashboardDir = path.resolve(__dirname, "../../../dashboard");
  dashboardApp.use(express.static(dashboardDir));

  // REST API endpoints
  dashboardApp.get("/api/snapshot", (_req, res) => {
    res.json(store.getSnapshot());
  });

  dashboardApp.get("/api/requests", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const snapshot = store.getSnapshot();
    res.json(snapshot.recentRequests.slice(-limit));
  });

  dashboardApp.get("/api/logs", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const snapshot = store.getSnapshot();
    res.json(snapshot.recentLogs.slice(-limit));
  });

  dashboardApp.get("/api/config", (_req, res) => {
    res.json({
      dashboardPort: options.dashboardPort,
      otlpPort: options.otlpPort,
      uptimeMs: Date.now(),
    });
  });

  // Fallback to index.html for SPA
  dashboardApp.get("*", (_req, res) => {
    res.sendFile(path.join(dashboardDir, "index.html"));
  });

  const dashboardServer = createServer(dashboardApp);

  // Attach WebSocket to dashboard server
  createWebSocketServer(dashboardServer, store);

  dashboardServer.listen(options.dashboardPort, () => {
    // Startup message handled by CLI
  });

  // --- OTLP Receiver server ---
  const otlpApp = express();

  // Support both JSON and raw body (for protobuf)
  otlpApp.use(express.json({ limit: "50mb", type: "application/json" }));
  otlpApp.use(express.raw({ limit: "50mb", type: "application/x-protobuf" }));

  // CORS for OTLP (some exporters send preflight)
  otlpApp.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (_req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Handle protobuf → JSON conversion middleware
  otlpApp.use((req, _res, next) => {
    if (req.headers["content-type"] === "application/x-protobuf" && Buffer.isBuffer(req.body)) {
      // For now, log that we received protobuf but can't decode it
      // Users should use http/json protocol
      console.warn("[OTLP] Received protobuf payload. For best results, set OTEL_EXPORTER_OTLP_PROTOCOL=http/json");
      // Try to pass through — some fields may still be parseable
    }
    next();
  });

  const otlpRouter = createOtlpRouter(store);
  otlpApp.use(otlpRouter);

  const otlpServer = createServer(otlpApp);

  otlpServer.listen(options.otlpPort, () => {
    // Startup message handled by CLI
  });

  return { dashboardServer, otlpServer };
}
