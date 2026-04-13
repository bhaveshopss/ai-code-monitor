import { MetricsStore } from "./store/metrics-store.js";
import { startServers } from "./server/web-server.js";
import { banner, info, success, warn } from "./utils/logger.js";
import { setupKiro } from "./setup-kiro.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface MonitorOptions {
  dashboardPort: number;
  otlpPort: number;
  openBrowser: boolean;
}

export async function startMonitor(options: MonitorOptions) {
  const store = new MetricsStore();

  info("Starting AI Code Monitor...");

  const { dashboardServer, otlpServer, dashboardPort, otlpPort } = await startServers(store, {
    dashboardPort: options.dashboardPort,
    otlpPort: options.otlpPort,
  });

  if (dashboardPort !== options.dashboardPort) {
    warn(`Port ${options.dashboardPort} was in use, dashboard running on ${dashboardPort} instead`);
  }
  if (otlpPort !== options.otlpPort) {
    warn(`Port ${options.otlpPort} was in use, OTLP receiver running on ${otlpPort} instead`);
  }

  banner(dashboardPort, otlpPort);

  success(`Dashboard running at http://localhost:${dashboardPort}`);
  success(`OTLP receiver running at http://localhost:${otlpPort}`);

  // Auto-setup kiro-cli in background if not already done
  const kiroBinPath = join(process.cwd(), ".kiro", "bin", "kiro-cli");
  if (!existsSync(kiroBinPath)) {
    setupKiro(`http://localhost:${otlpPort}`).catch(() => {
      warn("Could not auto-setup kiro-cli monitoring");
    });
  }

  // Auto-open browser
  if (options.openBrowser) {
    try {
      const open = (await import("open")).default;
      await open(`http://localhost:${dashboardPort}`);
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
