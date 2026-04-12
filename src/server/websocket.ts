import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { MetricsStore } from "../store/metrics-store.js";

function safeSend(ws: WebSocket, message: string) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  } catch {
    // Ignore send errors — client will reconnect
  }
}

export function createWebSocketServer(server: Server, store: MetricsStore) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  let clientCount = 0;

  wss.on("connection", (ws: WebSocket) => {
    clientCount++;
    console.log(`[WS] Client connected (${clientCount} total)`);

    // Mark client as alive for ping/pong
    (ws as any).isAlive = true;

    ws.on("pong", () => {
      (ws as any).isAlive = true;
    });

    // Send full snapshot on connect
    const snapshot = store.getSnapshot();
    safeSend(ws, JSON.stringify({ type: "snapshot", data: snapshot }));

    ws.on("close", () => {
      clientCount--;
      console.log(`[WS] Client disconnected (${clientCount} total)`);
    });

    ws.on("error", (err) => {
      console.error("[WS] Client error:", err.message);
    });
  });

  // Ping/pong keepalive — terminate dead connections every 30s
  const pingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if ((ws as any).isAlive === false) {
        ws.terminate();
        continue;
      }
      (ws as any).isAlive = false;
      ws.ping();
    }
  }, 30_000);

  wss.on("close", () => {
    clearInterval(pingInterval);
  });

  // Listen for store updates and broadcast to all connected clients
  store.onUpdate((type: string, data: unknown) => {
    const message = JSON.stringify({ type, data });
    for (const client of wss.clients) {
      safeSend(client, message);
    }
  });

  // Periodic full snapshot broadcast (every 5 seconds as heartbeat)
  setInterval(() => {
    if (wss.clients.size === 0) return;
    const snapshot = store.getSnapshot();
    const message = JSON.stringify({ type: "snapshot", data: snapshot });
    for (const client of wss.clients) {
      safeSend(client, message);
    }
  }, 5000);

  return wss;
}
