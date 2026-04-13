import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { success, info, warn } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve the bundled plugin .mjs file shipped in the npm package */
function getPluginSourcePath(): string {
  // From dist/src/setup-opencode.js -> ../../assets/opencode-telemetry-plugin.mjs
  const fromDist = resolve(__dirname, "..", "..", "assets", "opencode-telemetry-plugin.mjs");
  if (existsSync(fromDist)) return fromDist;

  // From src/setup-opencode.ts (dev mode) -> ../assets/opencode-telemetry-plugin.mjs
  const fromSrc = resolve(__dirname, "..", "assets", "opencode-telemetry-plugin.mjs");
  if (existsSync(fromSrc)) return fromSrc;

  throw new Error("Could not find bundled plugin file. Reinstall ai-code-monitor.");
}

export async function setupOpenCode(projectDir: string, endpoint: string) {
  const dir = resolve(projectDir);

  info(`Setting up OpenCode telemetry in: ${dir}`);

  // 1. Create plugin directory
  const pluginDir = join(dir, ".opencode", "plugin", "ai-code-monitor-telemetry");
  mkdirSync(pluginDir, { recursive: true });

  // 2. Copy the bundled plugin
  const src = getPluginSourcePath();
  const dest = join(pluginDir, "index.mjs");
  copyFileSync(src, dest);
  success(`Plugin installed: .opencode/plugin/ai-code-monitor-telemetry/index.mjs`);

  // 3. Write a minimal package.json for the plugin
  const pluginPkg = {
    name: "ai-code-monitor-telemetry",
    version: "1.0.0",
    type: "module",
    main: "index.mjs",
  };
  writeFileSync(join(pluginDir, "package.json"), JSON.stringify(pluginPkg, null, 2) + "\n");

  // 4. Create or update .opencode/opencode.jsonc
  const configPath = join(dir, ".opencode", "opencode.jsonc");
  const pluginRef = "file://.opencode/plugin/ai-code-monitor-telemetry";
  let config: Record<string, any> = {};

  if (existsSync(configPath)) {
    try {
      // Strip JSONC single-line comments (but not // inside strings)
      const raw = readFileSync(configPath, "utf-8");
      const stripped = raw.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (_, str) => str ?? "");
      config = JSON.parse(stripped);
      info("Found existing opencode.jsonc — updating it");
    } catch {
      warn("Could not parse existing opencode.jsonc — creating new one");
      config = {};
    }
  }

  // Ensure plugin array includes our plugin
  if (!Array.isArray(config.plugin)) {
    config.plugin = [];
  }
  if (!config.plugin.includes(pluginRef)) {
    config.plugin.push(pluginRef);
  }

  // Ensure experimental.openTelemetry is enabled
  if (!config.experimental || typeof config.experimental !== "object") {
    config.experimental = {};
  }
  config.experimental.openTelemetry = true;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  success(`Config updated: .opencode/opencode.jsonc`);

  // 5. Print next steps
  console.log("");
  console.log("  Setup complete! To start monitoring OpenCode:");
  console.log("");
  console.log("    Terminal 1:  npx ai-code-monitor");
  if (endpoint !== "http://localhost:4318") {
    console.log(`    Terminal 2:  OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint} opencode`);
  } else {
    console.log("    Terminal 2:  opencode");
  }
  console.log("");
  console.log("  The dashboard will show tool executions, LOC changes, and permissions.");
  console.log("");
}
