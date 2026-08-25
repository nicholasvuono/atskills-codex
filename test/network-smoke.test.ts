import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { JsonObject, ProcessResult } from "./types.js";

const repositoryRoot = resolve(process.cwd());
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");
const cliPath = join(pluginRoot, "skills", "atskills", "scripts", "atskills.js");
const enabled = process.env.ATSKILLS_NETWORK_SMOKE === "1";

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<ProcessResult> {
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

test("optional network smoke resolves an immutable public GitHub fixture", { skip: !enabled }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "atskills-network-smoke-"));
  const id = process.env.ATSKILLS_NETWORK_ID || "gh:SylphAI-Inc/atskills/examples/simple-tdd";
  const expectedRevision = process.env.ATSKILLS_NETWORK_SHA || "858802c58636e43d04edae51d4ac5d7c3819decf";
  const mirrorRoot = join(workspace, "remotes");
  const mirror = join(mirrorRoot, "SylphAI-Inc", "atskills.git");
  try {
    await mkdir(join(mirrorRoot, "SylphAI-Inc"), { recursive: true });
    execFileSync("git", ["init", "--bare", "-q", mirror], { encoding: "utf8" });
    execFileSync(
      "git",
      ["--git-dir", mirror, "fetch", "--quiet", "--depth", "1", "https://github.com/SylphAI-Inc/atskills.git", expectedRevision],
      { encoding: "utf8", timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
    execFileSync("git", ["--git-dir", mirror, "update-ref", "refs/heads/main", expectedRevision]);
    execFileSync("git", ["--git-dir", mirror, "symbolic-ref", "HEAD", "refs/heads/main"]);
    const revision = execFileSync(
      "git",
      ["ls-remote", `file://${mirrorRoot}/SylphAI-Inc/atskills.git`, "HEAD"],
      { encoding: "utf8", timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
    assert.match(revision, new RegExp(`^${expectedRevision}\\s`));
    const result = await runCli(["get", id, "--cwd", workspace, "--json"], {
      ATSKILLS_CACHE: join(workspace, "cache"),
      ATSKILLS_GITHUB_BASE_URL: `file://${mirrorRoot}`,
    });
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as JsonObject;
    assert.equal(payload.ok, true);
    assert.equal(payload.kind, "skill");
    assert.match(payload.content, /name:|description:/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
