import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { success, info, warn } from "./utils/logger.js";

/** The TOML block we inject into ~/.codex/config.toml */
function buildOtelBlock(endpoint: string): string {
  return [
    "",
    "# --- ai-code-monitor: OTel export ---",
    "[otel]",
    'environment = "dev"',
    "",
    "[otel.exporter.otlp-http]",
    `endpoint = "${endpoint}"`,
    'protocol = "json"',
    "",
    "[otel.trace_exporter.otlp-http]",
    `endpoint = "${endpoint}"`,
    'protocol = "json"',
    "",
    "[otel.metrics_exporter.otlp-http]",
    `endpoint = "${endpoint}"`,
    'protocol = "json"',
    "# --- end ai-code-monitor ---",
    "",
  ].join("\n");
}

/**
 * Remove any existing ai-code-monitor OTel block and any standalone [otel]
 * sections so we can write a clean replacement.
 */
function stripExistingOtelBlock(content: string): string {
  // Remove our marked block if present
  const markerStart = "# --- ai-code-monitor: OTel export ---";
  const markerEnd = "# --- end ai-code-monitor ---";
  const startIdx = content.indexOf(markerStart);
  const endIdx = content.indexOf(markerEnd);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = content.slice(0, startIdx).trimEnd();
    const after = content.slice(endIdx + markerEnd.length).trimStart();
    return before + (after ? "\n\n" + after : "\n");
  }

  return content;
}

export async function setupCodex(endpoint: string) {
  const codexHome = join(homedir(), ".codex");
  const configPath = join(codexHome, "config.toml");

  info("Configuring Codex CLI OTel export...");

  // Ensure ~/.codex/ exists
  if (!existsSync(codexHome)) {
    mkdirSync(codexHome, { recursive: true });
    info("Created ~/.codex/");
  }

  // Read existing config or start fresh
  let content = "";
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
    info("Found existing config.toml — updating it");

    // Check if there's already an [otel] section we didn't write
    if (content.includes("[otel]") && !content.includes("ai-code-monitor")) {
      warn("Existing [otel] section found in config.toml — it will be preserved.");
      warn("The ai-code-monitor block will be appended. You may need to remove duplicates manually.");
    }

    content = stripExistingOtelBlock(content);
  }

  // Append OTel block
  content = content.trimEnd() + "\n" + buildOtelBlock(endpoint);

  writeFileSync(configPath, content);
  success(`Config updated: ~/.codex/config.toml`);

  // Print next steps
  console.log("");
  console.log("  Setup complete! To start monitoring Codex CLI:");
  console.log("");
  console.log("    Terminal 1:  npx ai-code-monitor");
  console.log("    Terminal 2:  codex");
  console.log("");
  console.log("  Codex will export logs, traces, and metrics to ai-code-monitor.");
  console.log("  The dashboard will show token usage, costs, tool executions, and latency.");
  console.log("");
  console.log("  To undo, remove the [otel] block from ~/.codex/config.toml");
  console.log("");
}
