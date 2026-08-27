import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const repositoryRoot = process.cwd();
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("plugin manifest uses default component discovery", async () => {
  const manifest = await readJson(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
  );

  assert.equal(manifest.name, "atskills-codex");
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
  assert.equal(pluginEntry.source.source, "local");
  assert.equal(pluginEntry.source.path, "./plugins/atskills-codex");
});

test("management skill has discoverable metadata", async () => {
  const skillRoot = join(pluginRoot, "skills", "atskills");
  const [skill, agent] = await Promise.all([
    readFile(join(skillRoot, "SKILL.md"), "utf8"),
    readFile(join(skillRoot, "agents", "openai.yaml"), "utf8"),
  ]);

  assert.match(skill, /^---\nname:\s*atskills\ndescription:\s*\S/m);
  assert.match(agent, /display_name:\s*"AtSkills for Codex"/);
  assert.match(agent, /allow_implicit_invocation:\s*true/);
});
