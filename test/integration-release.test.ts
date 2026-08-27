import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { JsonObject, ProcessResult, RunOptions } from "./types.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePlugin = join(repositoryRoot, "plugins", "atskills-codex");

function git(cwd: string, ...args: string[]): string {
  return String(execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "user.name=AtSkills Test",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  )).trim();
}

function run(
  file: string,
  args: string[],
  { cwd, env, input = "" }: RunOptions = {},
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolveResult, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: cwd ?? repositoryRoot,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function json(result: ProcessResult): JsonObject {
  assert.equal(result.stdout.split("\n").filter(Boolean).length, 1, result.stderr);
  const parsed: unknown = JSON.parse(result.stdout);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  return parsed as JsonObject;
}

test("copied installed plugin works end to end across CLI, hooks, and workspace state", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "atskills-e2e-"));
  const workspace = join(fixtureRoot, "workspace");
  const remotes = join(fixtureRoot, "remotes");
  const remote = join(remotes, "acme", "e2e.git");
  const installedPlugin = join(fixtureRoot, "installed-plugin");
  const cli = join(installedPlugin, "skills", "atskills", "scripts", "atskills.js");
  const hook = join(installedPlugin, "hooks", "atskills.js");
  const env = {
    ATSKILLS_CACHE: join(fixtureRoot, "cache"),
    ATSKILLS_GITHUB_BASE_URL: `file://${remotes}`,
  };

  try {
    await mkdir(join(workspace, ".atskills", "local"), { recursive: true });
    await writeFile(
      join(workspace, ".atskills", "local", "SKILL.md"),
      "---\nname: local\ndescription: local skill\n---\nLOCAL_BODY\n",
    );
    await mkdir(remote, { recursive: true });
    git(remote, "init", "-q", "-b", "main");
    await mkdir(join(remote, "remote"), { recursive: true });
    await writeFile(
      join(remote, "remote", "SKILL.md"),
      "---\nname: remote\ndescription: remote skill\n---\nREMOTE_BODY\n",
    );
    git(remote, "add", "-A");
    git(remote, "commit", "-q", "-m", "initial");
    await cp(sourcePlugin, installedPlugin, { recursive: true });

    const cwd = ["--cwd", workspace, "--json"];
    const local = await run(cli, ["get", "local", ...cwd], { env });
    assert.equal(local.code, 0, local.stderr);
    assert.match(json(local).content, /LOCAL_BODY/);

    const human = await run(cli, ["get", "local", "--cwd", workspace], { env });
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /LOCAL_BODY/);

    const invalidCwd = await run(cli, ["list", "--cwd", "relative", "--json"], { env });
    const invalidCwdJson = json(invalidCwd);
    assert.equal(invalidCwd.code, 2);
    assert.equal(invalidCwdJson.ok, false);
    assert.equal(invalidCwdJson.code, "USAGE");
    assert.match(invalidCwdJson.error, /absolute path/);

    const saved = await run(cli, ["save", "gh:acme/e2e/remote", ...cwd], { env });
    assert.equal(saved.code, 0, saved.stderr);
    assert.equal(json(saved).saved, true);

    const installed = await run(cli, ["install", "gh:acme/e2e/remote", ...cwd], { env });
    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(json(installed).installed, true);

    const triggers = await run(cli, ["triggers", ...cwd], { env });
    assert.equal(triggers.code, 0, triggers.stderr);
    assert.equal(json(triggers).triggers[0].line, "gh/acme/e2e/remote");

    const provenance = await run(cli, ["provenance", "gh:acme/e2e/remote", ...cwd], { env });
    const provenanceJson = json(provenance);
    assert.equal(provenance.code, 0, provenance.stderr);
    assert.equal(provenanceJson.source, "github");
    assert.equal(provenanceJson.installed, true);

    const uninstalled = await run(cli, ["uninstall", "gh:acme/e2e/remote", ...cwd], { env });
    assert.equal(uninstalled.code, 0, uninstalled.stderr);
    assert.equal(json(uninstalled).installed, false);

    const reinstalled = await run(cli, ["install", "gh:acme/e2e/remote", ...cwd], { env });
    assert.equal(reinstalled.code, 0, reinstalled.stderr);
    assert.equal(json(reinstalled).installed, true);

    const prompt = await run(hook, [], {
      env: { ...env, PLUGIN_ROOT: installedPlugin },
      input: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        cwd: workspace,
        prompt: "Use @skills:local and @skills:gh:acme/e2e/remote",
      }),
    });
    assert.equal(prompt.code, 0, prompt.stderr);
    assert.ok(prompt.stdout, JSON.stringify(prompt));
    const promptContext = (JSON.parse(prompt.stdout) as JsonObject).hookSpecificOutput.additionalContext;
    assert.match(promptContext, /Skill: local/);
    assert.match(promptContext, /Skill: gh:acme\/e2e\/remote/);
    assert.doesNotMatch(promptContext, /LOCAL_BODY|REMOTE_BODY/);
    assert.match(promptContext, /Never execute files/);

    const session = await run(hook, [], {
      env: { ...env, PLUGIN_ROOT: installedPlugin },
      input: JSON.stringify({
        hook_event_name: "SessionStart",
        source: "resume",
        cwd: workspace,
      }),
    });
    assert.equal(session.code, 0, session.stderr);
    assert.ok(session.stdout, JSON.stringify(session));
    const sessionContext = (JSON.parse(session.stdout) as JsonObject).hookSpecificOutput.additionalContext;
    assert.match(sessionContext, /gh:acme\/e2e\/remote/);
    assert.match(sessionContext, /no network resolution/i);

    const listed = await run(cli, ["list", ...cwd], { env });
    assert.equal(json(listed).skills.some((skill: JsonObject) => skill.id === "gh:acme/e2e/remote" && skill.installed), true);
    assert.equal(existsSync(join(workspace, ".atskills", "gh", "acme", "e2e", "remote", "SKILL.md")), true);

    const refused = await run(cli, ["remove", "gh:acme/e2e/remote", ...cwd], { env });
    assert.equal(refused.code, 1);
    assert.equal(json(refused).code, "CONFIRMATION_REQUIRED");
    assert.equal(existsSync(join(workspace, ".atskills", "gh", "acme", "e2e", "remote")), true);

    const removed = await run(cli, ["remove", "gh:acme/e2e/remote", "--yes", ...cwd], { env });
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(json(removed).removed, true);
    assert.equal(existsSync(join(workspace, ".atskills", "gh")), false);
    assert.equal((await readFile(join(workspace, ".atskills", ".autotrigger"), "utf8")).trim(), "");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
