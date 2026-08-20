import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const repositoryRoot = process.cwd();
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("package declares the supported Node.js runtime and foundation scripts", async () => {
  const packageJson = await readJson(join(repositoryRoot, "package.json"));

  assert.equal(packageJson.engines.node, ">=20");
  assert.equal(packageJson.scripts.build, "node scripts/build.mjs");
  assert.equal(packageJson.scripts.test, "node --test test/foundation.test.mjs");
  assert.equal(packageJson.scripts.check, "npm run build && npm test");
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
    (entry) => entry.name === "atskills-codex",
  );

  assert.equal(marketplace.name, "atskills-local");
  assert.equal(marketplace.interface.displayName, "Local @skills");
  assert.equal(pluginEntry.source.source, "local");
  assert.equal(pluginEntry.source.path, "./plugins/atskills-codex");
  assert.equal(pluginEntry.policy.installation, "AVAILABLE");
  assert.equal(pluginEntry.policy.authentication, "ON_INSTALL");
  assert.equal(pluginEntry.category, "Productivity");
});
