import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");

function run(label: string, command: string, args: string[]): void {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed${result.signal ? ` (${result.signal})` : ""}`);
}

function officialPluginValidator() {
  const python = process.env.ATSKILLS_PYTHON || "python3";
  const codexRoot = process.env.ATSKILLS_CODEX_HOME || join(homedir(), ".codex");
  const validator = process.env.ATSKILLS_PLUGIN_VALIDATOR || join(
    codexRoot,
    "skills",
    ".system",
    "plugin-creator",
    "scripts",
    "validate_plugin.py",
  );
  if (!existsSync(validator)) {
    console.warn(`Official plugin validator not found at ${validator}; quick validation ran instead.`);
    return;
  }
  const yaml = spawnSync(python, ["-c", "import yaml"], { stdio: "ignore" });
  if (yaml.status !== 0) {
    console.warn("Official plugin validator skipped because its PyYAML dependency is unavailable; quick validation ran instead.");
    return;
  }
  run("official plugin validator", python, [validator, pluginRoot]);
}

try {
  run("offline bundle reproduction", process.execPath, ["scripts/build.js"]);
  run("release metadata and skill validator", process.execPath, ["scripts/release-check.js"]);
  officialPluginValidator();
  run("unit, integration, and security tests", process.execPath, ["--test", "test/*.test.js"]);
  console.log("\nAtSkills PR-7 check passed.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nAtSkills PR-7 check failed: ${message}`);
  process.exitCode = 1;
}
