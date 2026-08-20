import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(repositoryRoot, "plugins", "atskills-codex");

const requiredDirectories = [
  join(pluginRoot, "hooks"),
  join(pluginRoot, "runtime"),
  join(pluginRoot, "skills"),
];

const requiredFiles = [
  join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
  join(pluginRoot, ".codex-plugin", "plugin.json"),
  join(repositoryRoot, "package-lock.json"),
];

for (const directory of requiredDirectories) {
  const details = await stat(directory).catch(() => null);
  if (!details?.isDirectory()) {
    throw new Error(`Missing required plugin directory: ${directory}`);
  }
}

for (const file of requiredFiles) {
  await access(file).catch(() => {
    throw new Error(`Missing required foundation file: ${file}`);
  });
}

const manifest = JSON.parse(
  await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
);
if (manifest.name !== "atskills-codex") {
  throw new Error("Plugin manifest name must be atskills-codex.");
}
if (manifest.skills !== "./skills/") {
  throw new Error("Plugin manifest skills path must be ./skills/.");
}
if (Object.hasOwn(manifest, "hooks")) {
  throw new Error("Hook discovery must use the default plugin location.");
}

const marketplace = JSON.parse(
  await readFile(
    join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
    "utf8",
  ),
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

console.log("Foundation build check passed.");
