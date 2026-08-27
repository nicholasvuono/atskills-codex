import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { JsonObject, ProcessResult } from "./types.js";

const repositoryRoot = resolve(process.cwd());
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");
const hookPath = join(pluginRoot, "hooks", "atskills.js");

function runHook(input: JsonObject, env: NodeJS.ProcessEnv = {}): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolveResult, reject) => {
    const child = spawn(process.execPath, [hookPath], {
      cwd: repositoryRoot,
      env: { ...process.env, PLUGIN_ROOT: pluginRoot, ...env },
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
    child.stdin.end(JSON.stringify(input));
  });
}

function output(result: ProcessResult): JsonObject {
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout, result.stderr);
  const parsed: unknown = JSON.parse(result.stdout);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  return parsed as JsonObject;
}

async function workspace(name = "hooks") {
  const root = await mkdtemp(join(tmpdir(), `atskills-${name}-`));
  await mkdir(join(root, ".atskills"), { recursive: true });
  return root;
}

async function skill(
  root: string,
  id: string,
  name = id,
  body = "untrusted body",
): Promise<void> {
  const dir = join(root, ".atskills", ...id.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} description\n---\n${body}\n`,
  );
}

test("collections inject bounded menus, ordinary prompts stay silent, and failures stay fail-open", async () => {
  const root = await workspace("menu");
  try {
    await skill(root, "bundle/alpha", "Alpha", "ALPHA_BODY");
    await skill(root, "bundle/beta", "Beta", "BETA_BODY");

    const collection = output(
      await runHook({
        hook_event_name: "UserPromptSubmit",
        cwd: root,
        prompt: "Choose @skills:bundle",
      }),
    );
    const menu = collection.hookSpecificOutput.additionalContext;
    assert.match(menu, /Collection: bundle/);
    assert.match(menu, /bundle\/alpha/);
    assert.match(menu, /bundle\/beta/);
    assert.doesNotMatch(menu, /ALPHA_BODY|BETA_BODY/);

    const ordinary = await runHook({
      hook_event_name: "UserPromptSubmit",
      cwd: root,
      prompt: "Please inspect this ordinary prompt.",
    });
    assert.equal(ordinary.stdout, "");
    assert.equal(ordinary.stderr, "");

    const failure = output(
      await runHook({
        hook_event_name: "UserPromptSubmit",
        cwd: root,
        prompt: "Use @skills:missing",
      }),
    );
    assert.match(failure.hookSpecificOutput.additionalContext, /warning/i);
    assert.match(failure.hookSpecificOutput.additionalContext, /missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prompt resolution processes eight references and reports omitted ones", async () => {
  const root = await workspace("limit");
  try {
    for (let index = 1; index <= 9; index += 1) await skill(root, `s${index}`);
    const result = output(
      await runHook({
        hook_event_name: "UserPromptSubmit",
        cwd: root,
        prompt: Array.from({ length: 9 }, (_, index) => `@skills:s${index + 1}`).join(" "),
      }),
    );
    const context = result.hookSpecificOutput.additionalContext;
    assert.match(context, /s1/);
    assert.match(context, /s8/);
    assert.doesNotMatch(context, /Skill: s9/);
    assert.match(context, /Ignored 1 additional/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SessionStart restores local metadata for every supported source without resolving the network", async () => {
  const root = await workspace("session");
  try {
    await skill(root, "saved/local", "Saved", "SESSION_BODY");
    await writeFile(
      join(root, ".atskills", ".autotrigger"),
      "saved/local\n@gh:acme/private/skill\n",
    );
    await mkdir(join(root, ".atskills", ".codex"), { recursive: true });
    await writeFile(
      join(root, ".atskills", ".codex", "index.json"),
      JSON.stringify({
        version: 1,
        skills: [
          {
            id: "saved/local",
            path: join(root, ".atskills", "saved", "local", "SKILL.md"),
            saved: true,
          },
        ],
        provenance: [{ id: "saved/local", revision: "abc123" }],
        triggers: [
          { line: "saved/local", cloud: false },
          { line: "@gh:acme/private/skill", cloud: true, id: "gh:acme/private/skill" },
        ],
        resident: [
          {
            line: "saved/local",
            id: "saved/local",
            where: "saved",
            file: join(root, ".atskills", "saved", "local", "SKILL.md"),
          },
          { line: "@gh:acme/private/skill", id: "gh:acme/private/skill", where: "cloud" },
        ],
      }),
    );

    for (const source of ["startup", "resume", "clear", "compact"]) {
      const result = output(
        await runHook(
          { hook_event_name: "SessionStart", source, cwd: root },
          { ATSKILLS_GITHUB_BASE_URL: "http://127.0.0.1:1", ATSKILLS_CACHE: join(root, "cache") },
        ),
      );
      const context = result.hookSpecificOutput.additionalContext;
      assert.equal(result.hookSpecificOutput.hookEventName, "SessionStart");
      assert.match(context, /saved\/local/);
      assert.match(context, /SKILL\.md/);
      assert.match(context, /revision: abc123/);
      assert.match(context, /gh:acme\/private\/skill/);
      assert.match(context, /no network resolution/i);
      assert.doesNotMatch(context, /SESSION_BODY/);
    }

    const irrelevant = await runHook({ hook_event_name: "SessionStart", source: "other", cwd: root });
    assert.equal(irrelevant.stdout, "");
    assert.equal(irrelevant.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hook context is capped and reports omitted session entries", async () => {
  const root = await workspace("context-cap");
  try {
    const resident = [];
    for (let index = 0; index < 80; index += 1) {
      const id = `local/${index.toString().padStart(2, "0")}`;
      await skill(root, id, `skill-${index}`);
      resident.push({ id, where: "yours", file: join(root, ".atskills", ...id.split("/"), "SKILL.md") });
    }
    await mkdir(join(root, ".atskills", ".codex"), { recursive: true });
    await writeFile(join(root, ".atskills", ".codex", "index.json"), JSON.stringify({ resident }));
    const result = output(await runHook({ hook_event_name: "SessionStart", source: "startup", cwd: root }));
    const context = result.hookSpecificOutput.additionalContext;
    assert.ok(Buffer.byteLength(context, "utf8") <= 8 * 1024);
    assert.match(context, /Omitted .*entries/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
