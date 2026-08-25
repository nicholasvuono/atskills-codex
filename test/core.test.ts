import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  parseSkillReferences,
  resolveSkillReferences,
} from "../plugins/atskills-codex/runtime/core.js";

test("parser extracts ordered references and keeps invalid ones visible", () => {
  const references = parseSkillReferences(
    "Use @skills:local/one:save then @skills:../escape and @workflow:local/two.",
  );

  assert.equal(references.length, 3);
  assert.deepEqual(
    references[0],
    {
      raw: "@skills:local/one:save",
      start: 4,
      end: 26,
      id: "local/one",
      wholeDir: false,
      save: true,
      install: false,
      index: false,
    },
  );
  assert.match(references[1].error ?? "", /invalid path segment/);
  assert.equal("id" in references[2] ? references[2].id : undefined, "local/two.");
});

test("resolution uses the bundled core and keeps results aligned", async () => {
  const workingDir = await mkdtemp(join(tmpdir(), "atskills-core-"));
  try {
    const skillDir = join(workingDir, ".atskills", "local");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: local\ndescription: local skill\n---\nbody\n",
    );

    const references = await resolveSkillReferences(
      "@skills:local @skills:../escape @skills:missing @skills:local",
      { workingDir, cacheDir: join(workingDir, "cache") },
    );

    assert.equal(references.length, 4);
    assert.equal(references[0].result.success, true);
    assert.match(references[0].result.content ?? "", /body/);
    assert.equal(references[1].result.success, false);
    assert.match(references[1].result.error ?? "", /invalid path segment/);
    assert.equal(references[2].result.success, false);
    assert.match(references[2].result.error ?? "", /No skill/);
    assert.strictEqual(references[0].result, references[3].result);
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
});
