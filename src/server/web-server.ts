import express from "express";
import { createServer, type Server } from "http";
import net from "net";
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

export interface StartedServers {
  dashboardServer: Server;
  otlpServer: Server;
  dashboardPort: number;
  otlpPort: number;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

async function findFreePort(startPort: number): Promise<number> {
  let port = startPort;
  while (port < startPort + 100) {
    if (await isPortFree(port)) return port;
    port++;
  }
  throw new Error(`No free port found in range ${startPort}-${startPort + 99}`);
}

function listenAsync(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

export async function startServers(store: MetricsStore, options: ServerOptions): Promise<StartedServers> {
  // Find free ports (auto-increment if requested port is busy)
  const dashboardPort = await findFreePort(options.dashboardPort);
  const otlpPort = await findFreePort(options.otlpPort);

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
      dashboardPort,
      otlpPort,
      uptimeMs: Date.now(),
    });
  });

  // Fallback to index.html for SPA (exclude /ws to avoid interfering with WebSocket upgrade)
  dashboardApp.get("*", (req, res, next) => {
    if (req.path === "/ws") {
      return next();
    }
    res.sendFile(path.join(dashboardDir, "index.html"));
  });

  const dashboardServer = createServer(dashboardApp);

  // Attach WebSocket to dashboard server
  createWebSocketServer(dashboardServer, store);

  await listenAsync(dashboardServer, dashboardPort);

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
      console.warn("[OTLP] Received protobuf payload. For best results, set OTEL_EXPORTER_OTLP_PROTOCOL=http/json");
    }
    next();
  });

  const otlpRouter = createOtlpRouter(store);
  otlpApp.use(otlpRouter);

  const otlpServer = createServer(otlpApp);

  await listenAsync(otlpServer, otlpPort);

  return { dashboardServer, otlpServer, dashboardPort, otlpPort };
}
