import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { success, info } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve the bundled wrapper .js file shipped in the npm package */
function getWrapperSourcePath(): string {
  // From dist/src/setup-kiro.js -> ../../assets/kiro-cli-wrapper.js
  const fromDist = resolve(__dirname, "..", "..", "assets", "kiro-cli-wrapper.js");
  if (existsSync(fromDist)) return fromDist;

  // From src/setup-kiro.ts (dev mode) -> ../assets/kiro-cli-wrapper.js
  const fromSrc = resolve(__dirname, "..", "assets", "kiro-cli-wrapper.js");
  if (existsSync(fromSrc)) return fromSrc;

  throw new Error("Could not find bundled wrapper file. Reinstall ai-code-monitor.");
}

export async function setupKiro(endpoint: string) {
  const dir = process.cwd();

  info(`Setting up Kiro CLI telemetry in: ${dir}`);

  // 1. Create .kiro/bin directory
  const kiroBinDir = join(dir, ".kiro", "bin");
  mkdirSync(kiroBinDir, { recursive: true });

  // 2. Copy the wrapper script with Unix line endings
  const src = getWrapperSourcePath();
  const dest = join(kiroBinDir, "kiro-cli");
  
  // Read, convert line endings, and write to ensure Unix format
  const content = readFileSync(src, "utf-8");
  const unixContent = content.replace(/\r\n/g, "\n");
  writeFileSync(dest, unixContent);
  
  // Make it executable
  chmodSync(dest, 0o755);
  
  success(`Kiro CLI wrapper installed: .kiro/bin/kiro-cli`);

  // 3. Print next steps
  console.log("");
  console.log("  Setup complete! To start monitoring Kiro CLI:");
  console.log("");
  console.log("    Terminal 1:  npx ai-code-monitor");
  console.log("    Terminal 2:  export PATH=.kiro/bin:$PATH");
  console.log(`    Terminal 2:  export OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`);
  console.log("    Terminal 2:  kiro-cli <your-command>");
  console.log("");
  console.log("  The wrapper will automatically send telemetry to the monitor.");
  console.log("");
}
