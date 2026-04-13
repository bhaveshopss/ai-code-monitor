import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import type { Duplex } from "stream";
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
  // Use noServer mode to fully decouple WS upgrade from Express request handling.
  // This prevents Express middleware/routes from interfering with the WS handshake.
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;

    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  let clientCount = 0;

  wss.on("connection", (ws: WebSocket) => {
    clientCount++;
    if (clientCount === 1) {
      console.log("[WS] Dashboard client connected");
    }

    // Mark client as alive for ping/pong
    (ws as any).isAlive = true;

    ws.on("pong", () => {
      (ws as any).isAlive = true;
    });

    // Send full snapshot on connect (small delay to ensure connection is stable)
    setTimeout(() => {
      const snapshot = store.getSnapshot();
      safeSend(ws, JSON.stringify({ type: "snapshot", data: snapshot }));
    }, 100);

    ws.on("close", (code, reason) => {
      clientCount--;
      // Only log unexpected disconnects (1000=normal, 1001=going away are expected)
      if (code !== 1000 && code !== 1001) {
        console.log(`[WS] Client disconnected (${clientCount} total) code=${code} reason=${reason?.toString() || ""}`);
      }
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
