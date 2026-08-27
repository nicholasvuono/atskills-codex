import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");

function run(label, command, args) {
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
    console.warn(`Official plugin validator not found at ${validator}; skipping it.`);
    return;
  }
  const yaml = spawnSync(python, ["-c", "import yaml"], { stdio: "ignore" });
  if (yaml.status !== 0) {
    console.warn("Official plugin validator skipped because its PyYAML dependency is unavailable.");
    return;
  }
  run("official plugin validator", python, [validator, pluginRoot]);
}

try {
  officialPluginValidator();
  run("unit, integration, and security tests", process.execPath, ["--test", "test/*.test.mjs"]);
  console.log("\nAtSkills check passed.");
} catch (error) {
  console.error(`\nAtSkills check failed: ${error.message}`);
  process.exitCode = 1;
}
