import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { JsonObject, ProcessResult } from "./types.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(
  repositoryRoot,
  "plugins",
  "atskills-codex",
  "skills",
  "atskills",
  "scripts",
  "atskills.js",
);

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

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolveResult, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
      child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

function jsonResult(run: ProcessResult): JsonObject {
  assert.equal(run.stdout.split("\n").filter(Boolean).length, 1, run.stderr);
  const parsed: unknown = JSON.parse(run.stdout);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  return parsed as JsonObject;
}

test("CLI routes management commands through shared workspace state", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "atskills-cli-"));
  const workspace = join(fixtureRoot, "workspace");
  const remotes = join(fixtureRoot, "remotes");
  const remote = join(remotes, "acme", "cli.git");

  try {
    await mkdir(join(workspace, ".atskills", "local"), { recursive: true });
    await writeFile(
      join(workspace, ".atskills", "local", "SKILL.md"),
      "---\nname: local\ndescription: local skill\n---\nlocal body\n",
    );

    await mkdir(remote, { recursive: true });
    git(remote, "init", "-q", "-b", "main");
    await mkdir(join(remote, "mine"), { recursive: true });
    await writeFile(
      join(remote, "mine", "SKILL.md"),
      "---\nname: mine\ndescription: remote skill\n---\nremote body\n",
    );
    git(remote, "add", "-A");
    git(remote, "commit", "-q", "-m", "initial");
    const githubBaseUrl = `file://${remotes}`;
    const env = {
      ATSKILLS_CACHE: join(fixtureRoot, "cache"),
      ATSKILLS_GITHUB_BASE_URL: githubBaseUrl,
    };
    const cwd = ["--cwd", workspace, "--json"];

    const got = await runCli(["get", "local", ...cwd], env);
    const gotJson = jsonResult(got);
    assert.equal(got.code, 0);
    assert.equal(gotJson.ok, true);
    assert.match(gotJson.content, /local body/);

    const saved = await runCli(["save", "gh:acme/cli/mine", ...cwd], env);
    const savedJson = jsonResult(saved);
    assert.equal(saved.code, 0, saved.stderr);
    assert.equal(savedJson.saved, true);
    const savedDir = join(workspace, ".atskills", "gh", "acme", "cli", "mine");
    assert.equal(existsSync(join(savedDir, "SKILL.md")), true);

    const installed = await runCli(["install", "gh:acme/cli/mine", ...cwd], env);
    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(jsonResult(installed).installed, true);

    const listed = await runCli(["list", ...cwd], env);
    const listJson = jsonResult(listed);
    assert.equal(listed.code, 0);
    assert.equal(listJson.skills.some((skill: JsonObject) => skill.id === "gh:acme/cli/mine" && skill.installed), true);

    const triggers = await runCli(["triggers", ...cwd], env);
    assert.equal(triggers.code, 0);
    assert.equal(jsonResult(triggers).triggers[0].line, "gh/acme/cli/mine");

    const provenance = await runCli(["provenance", "gh:acme/cli/mine", ...cwd], env);
    const provenanceJson = jsonResult(provenance);
    assert.equal(provenance.code, 0);
    assert.equal(provenanceJson.source, "github");
    assert.equal(provenanceJson.installed, true);

    const uninstalled = await runCli(["uninstall", "gh:acme/cli/mine", ...cwd], env);
    assert.equal(uninstalled.code, 0);
    assert.equal(jsonResult(uninstalled).installed, false);

    const refused = await runCli(["remove", "gh:acme/cli/mine", ...cwd], env);
    assert.equal(refused.code, 1);
    assert.equal(jsonResult(refused).code, "CONFIRMATION_REQUIRED");
    assert.equal(existsSync(savedDir), true);

    const removed = await runCli(["remove", "gh:acme/cli/mine", "--yes", ...cwd], env);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(jsonResult(removed).removed, true);
    assert.equal(existsSync(savedDir), false);

    const human = await runCli(["get", "local", "--cwd", workspace]);
    assert.equal(human.code, 0);
    assert.match(human.stdout, /local body/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("CLI rejects relative workspaces and keeps JSON stdout clean on errors", async () => {
  const result = await runCli(["list", "--cwd", "relative", "--json"]);
  assert.equal(result.code, 2);
  const parsed = jsonResult(result);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "USAGE");
  assert.match(parsed.error, /absolute path/);
});
