import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const run = promisify(execFile);
const repositoryRoot = process.cwd();
const artifactPath = join(
  repositoryRoot,
  "plugins",
  "atskills-codex",
  "runtime",
  "atskills.mjs",
);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("the upstream source is pinned and exposed by the bundled runtime", async () => {
  const config = await readJson(join(repositoryRoot, "upstream.json"));
  const snapshot = await readJson(
    join(repositoryRoot, "vendor", "atskills.snapshot.json"),
  );
  const runtime = await import(pathToFileURL(artifactPath));

  assert.equal(snapshot.repository, config.repository);
  assert.equal(snapshot.commit, config.commit);
  assert.equal(runtime.upstreamRepository, config.repository);
  assert.equal(runtime.upstreamCommit, config.commit);
  assert.equal(typeof runtime.normalizeId, "function");
  assert.equal(runtime.normalizeId("gh:owner/repo/skill"), "gh:owner/repo/skill");
  assert.equal(runtime.MAX_COLLECTION_SKILLS, 128);
});

test("the checked-in runtime reproduces from the offline snapshot", async () => {
  const before = await readFile(artifactPath, "utf8");
  await run(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot });
  const after = await readFile(artifactPath, "utf8");
  assert.equal(after, before);
});

test("the runtime imports without repository dependencies", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "atskills-runtime-test-"));
  try {
    const copy = join(tempRoot, "atskills.mjs");
    await copyFile(artifactPath, copy);
    const runtime = await import(pathToFileURL(copy));
    assert.equal(runtime.normalizeId("local/skill"), "local/skill");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
