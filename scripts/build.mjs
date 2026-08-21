import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");
const snapshotRoot = join(repositoryRoot, "vendor", "atskills");
const snapshotManifestPath = join(repositoryRoot, "vendor", "atskills.snapshot.json");
const ignoreRoot = join(repositoryRoot, "vendor", "ignore");
const artifactPath = join(pluginRoot, "runtime", "atskills.mjs");

const requiredDirectories = [
  join(pluginRoot, "hooks"),
  join(pluginRoot, "runtime"),
  join(pluginRoot, "skills"),
];

const requiredFiles = [
  join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
  join(pluginRoot, ".codex-plugin", "plugin.json"),
  join(pluginRoot, "hooks", "hooks.json"),
  join(repositoryRoot, "package-lock.json"),
  join(repositoryRoot, "upstream.json"),
  snapshotManifestPath,
  join(ignoreRoot, "index.js"),
  join(ignoreRoot, "package.json"),
];

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

async function snapshotFiles(root, prefix = "") {
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
    files.push({
      path: path.split("\\").join("/"),
      sha256: createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex"),
    });
  }
  return files;
}

async function verifySnapshot(config) {
  const manifest = await readJson(snapshotManifestPath);
  if (manifest.repository !== config.repository || manifest.commit !== config.commit) {
    throw new Error("Upstream snapshot metadata does not match upstream.json.");
  }
  const actual = await snapshotFiles(snapshotRoot);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) {
    throw new Error("Checked-in upstream snapshot does not match its integrity manifest.");
  }
}

function moduleSource(id, source) {
  return `${JSON.stringify(id)}: function (module, exports, require) {\n${source}\n}`;
}

function publicNames(sources) {
  const names = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
      if (match[1] !== "__esModule") names.add(match[1]);
    }
    for (const match of source.matchAll(
      /Object\.defineProperty\(exports,\s*["']([^"']+)["']/g,
    )) {
      if (match[1] !== "__esModule" && /^[A-Za-z_$][\w$]*$/.test(match[1])) {
        names.add(match[1]);
      }
    }
  }
  return [...names].sort();
}

const config = await readJson(join(repositoryRoot, "upstream.json"));
if (
  typeof config.repository !== "string" ||
  typeof config.commit !== "string" ||
  !/^[0-9a-f]{40}$/i.test(config.commit)
) {
  throw new Error("Invalid upstream.json.");
}
config.commit = config.commit.toLowerCase();

for (const directory of requiredDirectories) {
  const details = await stat(directory).catch(() => null);
  if (!details?.isDirectory()) {
    throw new Error(`Missing required plugin directory: ${directory}`);
  }
}
for (const file of requiredFiles) {
  await stat(file).catch(() => {
    throw new Error(`Missing required PR 2 file: ${file}`);
  });
}

await verifySnapshot(config);

const manifest = await readJson(join(pluginRoot, ".codex-plugin", "plugin.json"));
if (manifest.name !== "atskills-codex") {
  throw new Error("Plugin manifest name must be atskills-codex.");
}
if (manifest.skills !== "./skills/") {
  throw new Error("Plugin manifest skills path must be ./skills/.");
}
if (Object.hasOwn(manifest, "hooks")) {
  throw new Error("Hook discovery must use the default plugin location.");
}

const marketplace = await readJson(
  join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
);
const pluginEntry = marketplace.plugins?.find(
  (entry) => entry?.name === "atskills-codex",
);
if (marketplace.name !== "atskills-local" || !pluginEntry) {
  throw new Error("Repo marketplace is missing the atskills-codex entry.");
}
if (pluginEntry.source?.path !== "./plugins/atskills-codex") {
  throw new Error("Marketplace source path must be ./plugins/atskills-codex.");
}

const distRoot = join(snapshotRoot, "dist");
const distEntries = (await readdir(distRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
const modules = [];
const sources = [];
for (const entry of distEntries) {
  const source = await readFile(join(distRoot, entry.name), "utf8");
  sources.push(source);
  modules.push(moduleSource(`dist/${entry.name}`, source));
}
modules.push(
  moduleSource(
    "@bundled/ignore.js",
    await readFile(join(ignoreRoot, "index.js"), "utf8"),
  ),
);

const exportsCode = publicNames(sources)
  .map((name) => `export const ${name} = core[${JSON.stringify(name)}];`)
  .join("\n");
const artifact = [
  "// Generated by scripts/build.mjs; do not edit.",
  `// Upstream: ${config.repository}@${config.commit}`,
  "",
  'import { builtinModules, createRequire } from "node:module";',
  'import { posix } from "node:path";',
  "",
  "const nodeRequire = createRequire(import.meta.url);",
  "const builtinNames = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);",
  "const modules = {",
  modules.join(",\n"),
  "};",
  "const cache = new Map();",
  "",
  "function resolveRequest(request, parent) {",
  '  if (request === "ignore") return "@bundled/ignore.js";',
  "  if (modules[request]) return request;",
  "  if (builtinNames.has(request)) return request;",
  '  if (!request.startsWith(".")) {',
  "    throw new Error(`Bundled runtime refused external module: ${request}`);",
  "  }",
  "  const id = posix.normalize(posix.join(posix.dirname(parent), request));",
  '  return id.endsWith(".js") ? id : `${id}.js`;',
  "}",
  "",
  'function requireModule(request, parent = "dist/index.js") {',
  "  const id = resolveRequest(request, parent);",
  "  if (builtinNames.has(id)) return nodeRequire(id);",
  "  const factory = modules[id];",
  '  if (!factory) throw new Error(`Bundled runtime module not found: ${id}`);',
  "  if (cache.has(id)) return cache.get(id).exports;",
  "  const module = { exports: {} };",
  "  cache.set(id, module);",
  "  factory(module, module.exports, (child) => requireModule(child, id));",
  "  return module.exports;",
  "}",
  "",
  'const core = requireModule("dist/index.js");',
  "export { core };",
  `export const upstreamRepository = ${JSON.stringify(config.repository)};`,
  `export const upstreamCommit = ${JSON.stringify(config.commit)};`,
  exportsCode,
  "export default core;",
  "",
].join("\n");

await writeFile(artifactPath, artifact);
console.log(`Built self-contained runtime: ${artifactPath}`);
