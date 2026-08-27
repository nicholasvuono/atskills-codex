import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePlugin = join(repositoryRoot, "plugins", "atskills-codex");

function run(file, args = [], { env, input } = {}) {
  return spawnSync(process.execPath, [file, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input,
    timeout: 5000,
  });
}

function json(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("copied plugin works across the CLI, hooks, and workspace state", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "atskills-e2e-"));
  const workspace = join(fixtureRoot, "workspace");
  const installedPlugin = join(fixtureRoot, "installed-plugin");
  const cli = join(installedPlugin, "skills", "atskills", "scripts", "atskills.mjs");
  const hook = join(installedPlugin, "hooks", "atskills.mjs");

  try {
    await mkdir(join(workspace, ".atskills", "local"), { recursive: true });
    await writeFile(
      join(workspace, ".atskills", "local", "SKILL.md"),
      "---\nname: local\ndescription: local skill\n---\nLOCAL_BODY\n",
    );
    await cp(sourcePlugin, installedPlugin, { recursive: true });

    const cwd = ["--cwd", workspace, "--json"];
    assert.match(json(run(cli, ["get", "local", ...cwd])).content, /LOCAL_BODY/);
    assert.equal(json(run(cli, ["install", "local", ...cwd])).installed, true);

    const prompt = json(run(hook, [], {
      env: { PLUGIN_ROOT: installedPlugin },
      input: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        cwd: workspace,
        prompt: "Use @skills:local",
      }),
    })).hookSpecificOutput.additionalContext;
    assert.match(prompt, /Skill: local/);
    assert.match(prompt, /Never execute files/);
    assert.doesNotMatch(prompt, /LOCAL_BODY/);

    const session = json(run(hook, [], {
      env: { PLUGIN_ROOT: installedPlugin },
      input: JSON.stringify({ hook_event_name: "SessionStart", source: "resume", cwd: workspace }),
    })).hookSpecificOutput.additionalContext;
    assert.match(session, /Installed skill: local/);
    assert.match(session, /no network resolution/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
