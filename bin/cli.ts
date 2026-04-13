#!/usr/bin/env node

import { Command } from "commander";
import { startMonitor } from "../src/index.js";
import { setupOpenCode } from "../src/setup-opencode.js";

const program = new Command();

program
  .name("ai-code-monitor")
  .description(
    "Real-time monitoring dashboard for AI coding agents.\n" +
    "Track tokens, costs, and latency for Claude Code, OpenCode, and more."
  )
  .version("1.3.0")
  .option("-p, --port <number>", "Dashboard port", "3000")
  .option("-o, --otlp-port <number>", "OTLP receiver port", "4318")
  .option("--no-open", "Don't auto-open browser")
  .action(async (opts) => {
    const dashboardPort = parseInt(opts.port, 10);
    const otlpPort = parseInt(opts.otlpPort, 10);
    const openBrowser = opts.open !== false;

    if (isNaN(dashboardPort) || isNaN(otlpPort)) {
      console.error("Error: ports must be valid numbers");
      process.exit(1);
    }

    await startMonitor({
      dashboardPort,
      otlpPort,
      openBrowser,
    });
  });

program
  .command("setup-opencode")
  .description("Install the OpenCode telemetry plugin in the current project")
  .option("-d, --dir <path>", "Project directory", process.cwd())
  .option("-e, --endpoint <url>", "OTLP endpoint", "http://localhost:4318")
  .action(async (opts) => {
    await setupOpenCode(opts.dir, opts.endpoint);
  });

program.parse();
