import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(
  repositoryRoot,
  "plugins",
  "atskills-codex",
  "skills",
  "atskills",
  "scripts",
  "atskills.mjs",
);

test("CLI rejects relative workspaces with one JSON error", () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, "list", "--cwd", "relative", "--json"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  const lines = result.stdout.trim().split("\n");
  assert.equal(result.status, 2);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    command: null,
    ok: false,
    success: false,
    code: "USAGE",
    error: "--cwd must be an absolute path",
  });
});
