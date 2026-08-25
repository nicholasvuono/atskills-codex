import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { WorkspaceOptions } from "../plugins/atskills-codex/runtime/types.js";
import {
  installSkill,
  readWorkspaceState,
  removeSkill,
  saveSkill,
  uninstallSkill,
} from "../plugins/atskills-codex/runtime/state.js";

const fixtureRoot = mkdtempSync(join(tmpdir(), "atskills-state-fixture-"));
const remotesRoot = join(fixtureRoot, "remotes");
const githubBaseUrl = `file://${remotesRoot}`;

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

function remote(owner: string, repo: string, files: Record<string, string>): string {
  const dir = join(remotesRoot, owner, `${repo}.git`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "uploadpack.allowFilter", "true");
    git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
  }
  for (const [file, content] of Object.entries(files)) {
    const path = join(dir, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "update", "--allow-empty");
  return git(dir, "rev-parse", "HEAD");
}

function project(name: string): { workingDir: string; opts: WorkspaceOptions } {
  const workingDir = mkdtempSync(join(fixtureRoot, `${name}-`));
  mkdirSync(join(workingDir, ".atskills"));
  return {
    workingDir,
    opts: {
      workingDir,
      cacheDir: join(workingDir, "cache"),
      githubBaseUrl,
    },
  };
}

const skill = (description = "a saved skill") =>
  `---\nname: mine\ndescription: ${description}\n---\nbody\n`;

test("save writes provenance and index; install is idempotent and uninstall preserves it", async () => {
  const sha = remote("acme", "state", { "mine/SKILL.md": skill() });
  const { workingDir, opts } = project("state");

  const saved = await saveSkill("gh:acme/state/mine", opts);
  assert.equal(saved.success, true);
  assert.equal(saved.saved, true);

  const dest = join(workingDir, ".atskills", "gh", "acme", "state", "mine");
  assert.match(readFileSync(join(dest, ".source"), "utf8"), new RegExp(`rev:${sha}`));

  const first = await installSkill("gh:acme/state/mine", opts);
  const second = await installSkill("gh:acme/state/mine", opts);
  assert.equal(first.success, true);
  assert.equal(first.added, true);
  assert.equal(second.added, false);
  assert.equal(readdirSync(join(workingDir, ".atskills")).filter((name) => name === ".autotrigger").length, 1);

  const uninstalled = uninstallSkill("gh:acme/state/mine", opts);
  assert.equal(uninstalled.success, true);
  assert.equal(uninstalled.removed, true);
  assert.equal(existsSync(join(dest, "SKILL.md")), true);

  const state = readWorkspaceState(workingDir);
  assert.ok(state.index);
  assert.equal(state.index.version, 1);
  assert.equal(state.skills[0].saved, true);
  assert.equal(state.provenance[0].revision, sha);
  assert.equal(state.triggers.length, 0);
});

test("edited saved content conflicts unless force is explicit", async () => {
  remote("acme", "conflict", { "mine/SKILL.md": skill("v1") });
  const { workingDir, opts } = project("conflict");
  const dest = join(workingDir, ".atskills", "gh", "acme", "conflict", "mine");

  assert.equal((await saveSkill("gh:acme/conflict/mine", opts)).success, true);
  writeFileSync(join(dest, "SKILL.md"), `${skill("edited")}local rules\n`);

  const conflict = await saveSkill("gh:acme/conflict/mine", opts);
  assert.equal(conflict.success, false);
  assert.equal(conflict.code, "CONFLICT");
  assert.match(readFileSync(join(dest, "SKILL.md"), "utf8"), /local rules/);

  const forced = await saveSkill("gh:acme/conflict/mine", { ...opts, force: true });
  assert.equal(forced.success, true);
  assert.doesNotMatch(readFileSync(join(dest, "SKILL.md"), "utf8"), /local rules/);
});

test("oversized snapshots return TOO_LARGE without creating workspace content", async () => {
  const files: Record<string, string> = { "mine/SKILL.md": skill() };
  for (let i = 0; i < 64; i++) files[`mine/r${i}.txt`] = "x";
  remote("acme", "many-files", files);
  const { workingDir, opts } = project("many-files");

  const result = await saveSkill("gh:acme/many-files/mine", opts);
  assert.equal(result.success, false);
  assert.equal(result.code, "TOO_LARGE");
  assert.equal(existsSync(join(workingDir, ".atskills", "gh")), false);

  remote("acme", "too-big", { "mine/SKILL.md": skill() + "x".repeat(4 * 1024 * 1024) });
  const second = project("too-big");
  const bytes = await saveSkill("gh:acme/too-big/mine", second.opts);
  assert.equal(bytes.success, false);
  assert.equal(bytes.code, "TOO_LARGE");
  assert.equal(existsSync(join(second.workingDir, ".atskills", "gh")), false);
});

test("remove requires confirmation and deletes only the saved snapshot", async () => {
  remote("acme", "remove", { "mine/SKILL.md": skill() });
  const { workingDir, opts } = project("remove");
  const dest = join(workingDir, ".atskills", "gh", "acme", "remove", "mine");

  await saveSkill("gh:acme/remove/mine", opts);
  await installSkill("gh:acme/remove/mine", opts);

  const refused = removeSkill("gh:acme/remove/mine", opts);
  assert.equal(refused.code, "CONFIRMATION_REQUIRED");
  assert.equal(existsSync(dest), true);

  const removed = removeSkill("gh:acme/remove/mine", { ...opts, confirm: true });
  assert.equal(removed.success, true);
  assert.equal(existsSync(dest), false);
  assert.equal(readWorkspaceState(workingDir).triggers.length, 0);
});
