import chalk from "chalk";

export function banner(dashboardPort: number, otlpPort: number) {
  const lines = [
    "",
    chalk.cyan("  ╔═══════════════════════════════════════════════╗"),
    chalk.cyan("  ║") + chalk.bold.white("         AI Code Monitor v1.0.0              ") + chalk.cyan("║"),
    chalk.cyan("  ╠═══════════════════════════════════════════════╣"),
    chalk.cyan("  ║") + "  Dashboard:  " + chalk.green(`http://localhost:${dashboardPort}`) + " ".repeat(Math.max(0, 18 - String(dashboardPort).length)) + chalk.cyan("║"),
    chalk.cyan("  ║") + "  OTLP:       " + chalk.green(`http://localhost:${otlpPort}`) + " ".repeat(Math.max(0, 18 - String(otlpPort).length)) + chalk.cyan("║"),
    chalk.cyan("  ╠═══════════════════════════════════════════════╣"),
    chalk.cyan("  ║") + chalk.dim("  For Kiro CLI monitoring:                    ") + chalk.cyan("║"),
    chalk.cyan("  ║") + "                                               " + chalk.cyan("║"),
    chalk.cyan("  ║") + chalk.yellow(`  export PATH=.kiro/bin:$PATH                 `) + chalk.cyan("║"),
    chalk.cyan("  ║") + chalk.yellow(`  export OTEL_EXPORTER_OTLP_ENDPOINT=\\         `) + chalk.cyan("║"),
    chalk.cyan("  ║") + chalk.yellow(`         http://localhost:${otlpPort}`) + " ".repeat(Math.max(0, 23 - String(otlpPort).length)) + chalk.cyan("║"),
    chalk.cyan("  ║") + chalk.yellow(`  kiro-cli <command>                          `) + chalk.cyan("║"),
    chalk.cyan("  ╠═══════════════════════════════════════════════╣"),
    chalk.cyan("  ║") + chalk.dim("  Waiting for telemetry data...               ") + chalk.cyan("║"),
    chalk.cyan("  ╚═══════════════════════════════════════════════╝"),
    "",
  ];

  console.log(lines.join("\n"));
}

export function info(msg: string) {
  console.log(chalk.cyan("[monitor]") + " " + msg);
}

export function success(msg: string) {
  console.log(chalk.green("[monitor]") + " " + msg);
}

export function warn(msg: string) {
  console.log(chalk.yellow("[monitor]") + " " + msg);
}

export function error(msg: string) {
  console.error(chalk.red("[monitor]") + " " + msg);
}
