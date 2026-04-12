import { MetricsStore } from "./store/metrics-store.js";
import { startServers } from "./server/web-server.js";
import { banner, info, success } from "./utils/logger.js";

export interface MonitorOptions {
  dashboardPort: number;
  otlpPort: number;
  openBrowser: boolean;
}

export async function startMonitor(options: MonitorOptions) {
  const store = new MetricsStore();

  info("Starting AI Code Monitor...");

  const { dashboardServer, otlpServer } = startServers(store, {
    dashboardPort: options.dashboardPort,
    otlpPort: options.otlpPort,
  });

  // Wait for both servers to be listening
  await Promise.all([
    new Promise<void>((resolve) => {
      dashboardServer.on("listening", resolve);
    }),
    new Promise<void>((resolve) => {
      otlpServer.on("listening", resolve);
    }),
  ]);

  banner(options.dashboardPort, options.otlpPort);

  success(`Dashboard running at http://localhost:${options.dashboardPort}`);
  success(`OTLP receiver running at http://localhost:${options.otlpPort}`);

  // Auto-open browser
  if (options.openBrowser) {
    try {
      const open = (await import("open")).default;
      await open(`http://localhost:${options.dashboardPort}`);
    } catch {
      // Silently ignore if browser can't be opened
    }
  }

  // Graceful shutdown
  const shutdown = () => {
    info("Shutting down...");
    dashboardServer.close();
    otlpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { store, dashboardServer, otlpServer };
}
