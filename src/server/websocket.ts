import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { MetricsStore } from "../store/metrics-store.js";

export function createWebSocketServer(server: Server, store: MetricsStore) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  let clientCount = 0;

  wss.on("connection", (ws: WebSocket) => {
    clientCount++;
    console.log(`[WS] Client connected (${clientCount} total)`);

    // Send full snapshot on connect
    const snapshot = store.getSnapshot();
    ws.send(JSON.stringify({ type: "snapshot", data: snapshot }));

    ws.on("close", () => {
      clientCount--;
      console.log(`[WS] Client disconnected (${clientCount} total)`);
    });

    ws.on("error", (err) => {
      console.error("[WS] Client error:", err.message);
    });
  });

  // Listen for store updates and broadcast to all connected clients
  store.onUpdate((type: string, data: unknown) => {
    const message = JSON.stringify({ type, data });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  });

  // Periodic full snapshot broadcast (every 5 seconds as heartbeat)
  setInterval(() => {
    if (wss.clients.size === 0) return;
    const snapshot = store.getSnapshot();
    const message = JSON.stringify({ type: "snapshot", data: snapshot });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }, 5000);

  return wss;
}
