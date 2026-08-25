import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(repositoryRoot, "upstream.json");
const snapshotPath = join(repositoryRoot, "vendor", "atskills");
const snapshotManifestPath = join(repositoryRoot, "vendor", "atskills.snapshot.json");
const noticePath = join(repositoryRoot, "THIRD_PARTY_NOTICES.md");

const config: JsonRecord = JSON.parse(await readFile(configPath, "utf8")) as JsonRecord;
if (
  typeof config.repository !== "string" ||
  !/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/.test(config.repository) ||
  typeof config.commit !== "string" ||
  !/^[0-9a-f]{40}$/i.test(config.commit)
) {
  throw new Error(`Invalid upstream configuration: ${configPath}`);
}

const commit = config.commit.toLowerCase();
const tempRoot = await mkdtemp(join(tmpdir(), "atskills-refresh-"));
const checkoutPath = join(tempRoot, "checkout");
const stagedSnapshotPath = join(tempRoot, "snapshot");

type JsonRecord = Record<string, any>;
interface SnapshotFile {
  path: string;
  sha256: string;
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd: checkoutPath,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function findLicense(snapshot: string): Promise<string> {
  const entries = await readdir(snapshot, { withFileTypes: true });
  const license = entries.find(
    (entry) =>
      entry.isFile() &&
      /^license(?:\.(?:md|txt))?$/i.test(entry.name),
  );
  if (!license) {
    throw new Error("The pinned upstream snapshot does not contain a root license file.");
  }
  return join(snapshot, license.name);
}

async function snapshotFiles(root: string, prefix = ""): Promise<SnapshotFile[]> {
  const entries = (await readdir(join(root, prefix), { withFileTypes: true })).sort(
    (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
  );
  const files = [];
  for (const entry of entries) {
    const path = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await snapshotFiles(root, path)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported file type in upstream snapshot: ${path}`);
    }
    const digest = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
    files.push({ path: path.split("\\").join("/"), sha256: digest });
  }
  return files;
}

try {
  await mkdir(checkoutPath, { recursive: true });
  await execFile("git", ["init", "--quiet"], { cwd: checkoutPath });
  await execFile("git", ["remote", "add", "origin", config.repository], {
    cwd: checkoutPath,
  });
  await git(["fetch", "--quiet", "--depth=1", "origin", commit]);
  await git(["checkout", "--quiet", "--detach", "FETCH_HEAD"]);

  const resolvedHead = await git(["rev-parse", "HEAD"]);
  if (resolvedHead.toLowerCase() !== commit) {
    throw new Error(
      `Upstream HEAD mismatch: expected ${commit}, resolved ${resolvedHead}`,
    );
  }

  await cp(checkoutPath, stagedSnapshotPath, {
    recursive: true,
    filter: (source) => source === checkoutPath || !relative(checkoutPath, source).split("/").includes(".git"),
  });

  const licensePath = await findLicense(stagedSnapshotPath);
  const licenseText = (await readFile(licensePath, "utf8")).trim();
  const ignorePackage: JsonRecord = JSON.parse(
    await readFile(join(repositoryRoot, "vendor", "ignore", "package.json"), "utf8"),
  ) as JsonRecord;
  const ignoreLicense = (
    await readFile(join(repositoryRoot, "vendor", "ignore", "LICENSE-MIT"), "utf8")
  ).trim();
  const files = await snapshotFiles(stagedSnapshotPath);
  const snapshotManifest = `${JSON.stringify(
    { repository: config.repository, commit, files },
    null,
    2,
  )}\n`;
  const notice = `# Third-party notices

## SylphAI-Inc/atskills

This repository includes an immutable source snapshot of
[\`SylphAI-Inc/atskills\`](https://github.com/SylphAI-Inc/atskills) at the exact
revision below. The snapshot is adapted only by the local runtime bundler.

- Repository: ${config.repository}
- Commit: \`${commit}\`
- Snapshot: \`vendor/atskills/\`
- License: MIT

The complete upstream license text at that revision follows:

${licenseText}

## ignore@${ignorePackage.version}

The bundled upstream runtime also includes the \`ignore\` package at the exact
version listed below.

- Repository: ${ignorePackage.repository.url}
- Version: ${ignorePackage.version}
- License: MIT

${ignoreLicense}
`;

  await mkdir(dirname(snapshotPath), { recursive: true });
  await rm(snapshotPath, { recursive: true, force: true });
  await rename(stagedSnapshotPath, snapshotPath);
  await writeFile(snapshotManifestPath, snapshotManifest);
  await writeFile(noticePath, notice);
  console.log(`Refreshed upstream snapshot at ${commit}.`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
