import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");
const errors: string[] = [];
const staleExtension = [".", "mjs"].join("");

type JsonRecord = Record<string, any>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function json(path: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as JsonRecord;
  } catch (error) {
    errors.push(`${path}: ${errorMessage(error)}`);
    return null;
  }
}

async function text(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    errors.push(`${path}: ${errorMessage(error)}`);
    return "";
  }
}

async function filesUnder(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if ([".git", ".atskills", "node_modules", "vendor"].includes(entry.name)) continue;
    const path = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else if (entry.isFile()) files.push(join(root, path));
  }
  return files;
}

function expect(condition: boolean, message: string): void {
  if (!condition) errors.push(message);
}

const [pkg, manifest, marketplace, hooks, upstream, snapshot, skill, agent, release] =
  await Promise.all([
    json(join(repositoryRoot, "package.json")),
    json(join(pluginRoot, ".codex-plugin", "plugin.json")),
    json(join(repositoryRoot, ".agents", "plugins", "marketplace.json")),
    json(join(pluginRoot, "hooks", "hooks.json")),
    json(join(repositoryRoot, "upstream.json")),
    json(join(repositoryRoot, "vendor", "atskills.snapshot.json")),
    text(join(pluginRoot, "skills", "atskills", "SKILL.md")),
    text(join(pluginRoot, "skills", "atskills", "agents", "openai.yaml")),
    text(join(repositoryRoot, "RELEASE.md")),
  ]);

expect(pkg?.type === "module", "package.json must declare ESM output");
expect(pkg?.engines?.node === ">=20", "package.json must require Node.js >=20");
expect(pkg?.devDependencies?.typescript === "^5.9.3", "typescript dependency version is incorrect");
expect(pkg?.devDependencies?.["@types/node"] === "^22.20.1", "@types/node dependency version is incorrect");
expect(pkg?.scripts?.compile === "tsc -p tsconfig.json", "compile script is incorrect");
expect(pkg?.scripts?.typecheck === "tsc -p tsconfig.json --noEmit", "typecheck script is incorrect");
expect(pkg?.scripts?.build === "npm run compile && node scripts/build.js", "build script is incorrect");
expect(pkg?.scripts?.test === "npm run compile && node --test test/*.test.js", "test script is incorrect");
expect(pkg?.scripts?.check === "npm run build && node scripts/check.js", "check script is incorrect");
expect(pkg?.scripts?.["refresh:upstream"] === "npm run compile && node scripts/refresh-upstream.js", "refresh script is incorrect");

expect(manifest?.name === "atskills-codex", "plugin name must be atskills-codex");
expect(manifest?.version === "0.1.0", "plugin version must remain 0.1.0 until a release version is chosen");
expect(manifest?.license === "MIT", "plugin license must be MIT");
expect(manifest?.repository === "https://github.com/nicholasvuono/atskills-codex", "plugin repository is incorrect");
expect(manifest?.skills === "./skills/", "plugin skills path must be ./skills/");
expect(manifest?.interface?.displayName === "AtSkills for Codex", "plugin display name is incomplete");
for (const field of ["hooks", "apps", "mcpServers"]) {
  expect(!(field in (manifest ?? {})), `plugin manifest must not declare ${field}`);
}

const pluginEntry = marketplace?.plugins?.find((entry: JsonRecord | undefined) => entry?.name === "atskills-codex");
expect(marketplace?.name === "atskills-local", "marketplace name must be atskills-local");
expect(marketplace?.interface?.displayName === "Local @skills", "marketplace display name is incorrect");
expect(pluginEntry?.source?.source === "local", "marketplace plugin source must be local");
expect(pluginEntry?.source?.path === "./plugins/atskills-codex", "marketplace source path is incorrect");
expect(pluginEntry?.policy?.installation === "AVAILABLE", "marketplace installation policy is incorrect");
expect(pluginEntry?.policy?.authentication === "ON_INSTALL", "marketplace authentication policy is incorrect");
expect(pluginEntry?.category === "Productivity", "marketplace category is incorrect");

const promptHook = hooks?.hooks?.UserPromptSubmit?.[0]?.hooks?.[0];
const sessionGroup = hooks?.hooks?.SessionStart?.[0];
const sessionHook = sessionGroup?.hooks?.[0];
expect(promptHook?.command === 'node "${PLUGIN_ROOT}/hooks/atskills.js"', "prompt hook command is incorrect");
expect(promptHook?.timeout === 60, "prompt hook timeout must be 60 seconds");
expect(promptHook?.additionalContextLimit === 2000, "prompt hook context limit is incorrect");
expect(sessionGroup?.matcher === "startup|resume|clear|compact", "SessionStart matcher is incomplete");
expect(sessionHook?.command === promptHook?.command && sessionHook?.timeout === 5, "session hook command/timeout is incorrect");
expect(sessionHook?.additionalContextLimit === 2000, "session hook context limit is incorrect");

expect(upstream?.repository === snapshot?.repository, "upstream snapshot repository metadata differs");
expect(upstream?.commit === snapshot?.commit && /^[0-9a-f]{40}$/.test(upstream?.commit ?? ""), "upstream snapshot commit is not immutable");
expect(skill.startsWith("---\n") && /\nname:\s*\S/.test(skill) && /\ndescription:\s*\S/.test(skill), "management skill frontmatter is incomplete");
expect(/display_name:\s*"AtSkills for Codex"/.test(agent), "management skill agent metadata is incomplete");
expect(/allow_implicit_invocation:\s*true/.test(agent), "implicit skill invocation must remain enabled");
expect(release.includes("codex plugin marketplace add") && release.includes("update_plugin_cachebuster.py"), "release documentation is incomplete");

for (const path of [
  join(pluginRoot, "hooks", "atskills.js"),
  join(pluginRoot, "runtime", "atskills.js"),
  join(pluginRoot, "runtime", "atskills.d.ts"),
  join(pluginRoot, "runtime", "core.js"),
  join(pluginRoot, "runtime", "security.js"),
  join(pluginRoot, "runtime", "state.js"),
  join(pluginRoot, "skills", "atskills", "scripts", "atskills.js"),
]) {
  expect((await text(path)).length > 0, `compiled plugin artifact is missing: ${path}`);
}

for (const path of await filesUnder(repositoryRoot)) {
  const contents = await text(path);
  expect(!path.endsWith(staleExtension), `${path} is a stale module artifact`);
  expect(!contents.includes(staleExtension), `${path} contains a stale module path`);
}

const forbidden = ["/Users/nick/Desktop/@skills", "@skills implementation plan"];
for (const path of [
  join(repositoryRoot, "README.md"),
  join(repositoryRoot, "RELEASE.md"),
  join(repositoryRoot, "package.json"),
  join(pluginRoot, ".codex-plugin", "plugin.json"),
]) {
  const contents = await text(path);
  for (const marker of forbidden) expect(!contents.includes(marker), `${path} contains forbidden stale reference: ${marker}`);
}

if (errors.length) {
  console.error("Release metadata validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Release metadata and skill quick validation passed.");
}
