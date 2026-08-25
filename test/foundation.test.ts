import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { JsonObject } from "./types.js";

const repositoryRoot = process.cwd();
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

test("package declares the supported Node.js runtime and foundation scripts", async () => {
  const packageJson = await readJson(join(repositoryRoot, "package.json"));

  assert.equal(packageJson.engines.node, ">=20");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.devDependencies.typescript, "^5.9.3");
  assert.equal(packageJson.devDependencies["@types/node"], "^22.20.1");
  assert.equal(packageJson.scripts.compile, "tsc -p tsconfig.json");
  assert.equal(packageJson.scripts.typecheck, "tsc -p tsconfig.json --noEmit");
  assert.equal(packageJson.scripts.build, "npm run compile && node scripts/build.js");
  assert.equal(packageJson.scripts.test, "npm run compile && node --test test/*.test.js");
  assert.equal(packageJson.scripts.check, "npm run build && node scripts/check.js");
  assert.equal(packageJson.scripts["refresh:upstream"], "npm run compile && node scripts/refresh-upstream.js");
});

test("plugin manifest has valid PR 1 metadata", async () => {
  const manifest = await readJson(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
  );

  assert.equal(manifest.name, "atskills-codex");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.repository, "https://github.com/nicholasvuono/atskills-codex");
  assert.equal(manifest.skills, "./skills/");
  assert.equal("hooks" in manifest, false);
  assert.equal("mcpServers" in manifest, false);
  assert.equal("apps" in manifest, false);
});

test("repo marketplace points to the local plugin", async () => {
  const marketplace = await readJson(
    join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
  );
  const pluginEntry = marketplace.plugins.find(
    (entry: JsonObject) => entry.name === "atskills-codex",
  );

  assert.equal(marketplace.name, "atskills-local");
  assert.equal(marketplace.interface.displayName, "Local @skills");
  assert.equal(pluginEntry.source.source, "local");
  assert.equal(pluginEntry.source.path, "./plugins/atskills-codex");
  assert.equal(pluginEntry.policy.installation, "AVAILABLE");
  assert.equal(pluginEntry.policy.authentication, "ON_INSTALL");
  assert.equal(pluginEntry.category, "Productivity");
});
