import { createHash } from "node:crypto";
import {
  addTriggerLine,
  diskPath,
  expandLocalTriggers,
  frontmatter,
  hasTriggerLine,
  installLineFor,
  isCloud,
  nearestSource,
  normalizeId,
  parseTriggers,
  removeTriggerLine,
  resolveSkill as upstreamResolveSkill,
  saveSkillToProject as upstreamSaveSkillToProject,
  safeJoin,
  skillsRoot,
  writeFileAtomic,
  SOURCE_FILE,
  DEFAULT_CACHE_DIR,
} from "./atskills.js";
import type { ResidentSkill, TriggerEntry } from "./atskills.js";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  isSafeWorkspacePath,
  MAX_SKILL_BYTES,
  resolveSafely,
} from "./security.js";
import type {
  ResolverOptions,
  ResultCode,
  RuntimeResult,
  WorkspaceIndex,
  WorkspaceOptions,
  WorkspacePaths,
  WorkspaceProvenance,
  WorkspaceSkill,
  WorkspaceState,
} from "./types.js";

export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_SNAPSHOT_FILES = 64;
export const WORKSPACE_INDEX_VERSION = 1;

interface SnapshotStats {
  bytes: number;
  files: number;
}

interface SnapshotSummary extends Partial<SnapshotStats> {
  error?: string;
}

interface FoundSkill {
  rel: string;
  dir: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resultCode(message: unknown, fallback: ResultCode = "NETWORK"): ResultCode {
  const text = String(message);
  if (/invalid|empty skill path|path escapes/i.test(text)) return "INVALID_REF";
  if (/too large|over the \d+|maximum is|exceed/i.test(text)) return "TOO_LARGE";
  if (/conflict|already exists|edited|project's own work/i.test(text)) return "CONFLICT";
  if (/no skill|nothing at|not found|no skills under/i.test(text)) return "NOT_FOUND";
  return fallback;
}

function failure(
  code: ResultCode,
  message: unknown,
  extra: Partial<RuntimeResult> = {},
): RuntimeResult {
  return {
    ok: false,
    success: false,
    code,
    error: String(message),
    ...extra,
  };
}

function success(extra: Partial<RuntimeResult> = {}): RuntimeResult {
  return { ok: true, success: true, ...extra };
}

function workingDirectory(options: Partial<WorkspaceOptions> = {}): string {
  return options.workingDir ?? process.cwd();
}

function resolveSkill(
  id: string,
  save: boolean,
  options: ResolverOptions,
  install = false,
): Promise<RuntimeResult> {
  return resolveSafely(upstreamResolveSkill, id, save, options, install);
}

function stateId(raw: string): string | RuntimeResult {
  let id;
  try {
    id = normalizeId(raw);
  } catch (error) {
    return failure("INVALID_REF", errorMessage(error));
  }
  const disk = diskPath(id);
  if (
    disk === ".codex" ||
    disk.startsWith(`.codex${sep}`) ||
    disk === ".autotrigger"
  ) {
    return failure("INVALID_REF", `'${id}' is reserved workspace state`);
  }
  return id;
}

export function workspacePaths(workingDir = process.cwd()): WorkspacePaths {
  const root = skillsRoot(workingDir);
  const codex = join(root, ".codex");
  return {
    root,
    autotrigger: join(root, ".autotrigger"),
    codex,
    index: join(codex, "index.json"),
  };
}

function snapshotStats(dir: string): SnapshotStats {
  const totals: SnapshotStats = { bytes: 0, files: 0 };

  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const file = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`saved snapshot contains a symbolic link: ${file}`);
      }
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === SOURCE_FILE || entry.name === ".visibility") continue;
      totals.files += 1;
      totals.bytes += statSync(file).size;
    }
  };

  visit(dir);
  return totals;
}

function walkWorkspaceSkills(root: string, rel = ""): FoundSkill[] {
  const dir = rel ? join(root, rel) : root;
  let current;
  try {
    current = lstatSync(dir);
  } catch {
    return [];
  }
  if (!current.isDirectory() || current.isSymbolicLink()) return [];
  const skillFile = join(dir, "SKILL.md");
  try {
    const file = lstatSync(skillFile);
    if (file.isFile()) return [{ rel, dir }];
  } catch {
    // Continue into a namespace directory.
  }

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== ".git")
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => walkWorkspaceSkills(root, rel ? `${rel}/${entry.name}` : entry.name));
}

function safeIndex(index: unknown, root: string): WorkspaceIndex | null {
  if (!index || typeof index !== "object") return null;
  const value = index as Record<string, unknown>;
  const skills = Array.isArray(value.skills)
    ? value.skills.filter((skill): skill is WorkspaceSkill => {
        if (!skill || typeof skill !== "object") return false;
        const record = skill as Record<string, unknown>;
        return typeof record.id === "string" && typeof record.path === "string" && isSafeWorkspacePath(root, record.path, true);
      })
    : [];
  const provenance = Array.isArray(value.provenance)
    ? value.provenance.filter((record): record is WorkspaceProvenance => {
        if (!record || typeof record !== "object") return false;
        const value = record as Record<string, unknown>;
        return typeof value.id === "string" && (!value.path || (typeof value.path === "string" && isSafeWorkspacePath(root, value.path, true)));
      })
    : [];
  const resident = Array.isArray(value.resident)
    ? value.resident
        .filter((entry): entry is ResidentSkill => {
          if (!entry || typeof entry !== "object") return false;
          const value = entry as Record<string, unknown>;
          return !value.file || (typeof value.file === "string" && isSafeWorkspacePath(root, value.file, true));
        })
        .map((entry) => ({ ...entry, ...(entry.id ? { id: canonicalStateId(entry.id) } : {}) }))
    : [];
  return {
    version: typeof value.version === "number" ? value.version : WORKSPACE_INDEX_VERSION,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
    skills,
    provenance,
    triggers: Array.isArray(value.triggers) ? value.triggers as TriggerEntry[] : [],
    resident,
  };
}

function canonicalStateId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    return normalizeId(raw);
  } catch {
    return raw;
  }
}

function snapshotLimitError(stats: SnapshotStats): string | null {
  if (stats.bytes > MAX_SNAPSHOT_BYTES) {
    return `saved snapshot is ${stats.bytes} bytes; maximum is ${MAX_SNAPSHOT_BYTES} bytes`;
  }
  if (stats.files > MAX_SNAPSHOT_FILES) {
    return `saved snapshot has ${stats.files} files; maximum is ${MAX_SNAPSHOT_FILES}`;
  }
  return null;
}

function cacheRevision(cacheDir: string, id: string): string {
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 32);
  try {
    const metadata: unknown = JSON.parse(
      readFileSync(join(cacheDir, ".meta", `${hash}.json`), "utf8"),
    );
    if (
      metadata &&
      typeof metadata === "object" &&
      "revision" in metadata &&
      typeof metadata.revision === "string"
    ) {
      return metadata.revision;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function provenanceFor(
  id: string,
  dir: string,
  options: ResolverOptions,
  resolved: RuntimeResult,
): WorkspaceProvenance {
  const stamp = nearestSource(dir, skillsRoot(workingDirectory(options)));
  if (stamp) {
    return {
      id: stamp.id,
      source: stamp.id.startsWith("gh:")
        ? "github"
        : stamp.id.startsWith("hub:")
          ? "hub"
          : "local",
      revision: stamp.revision ?? "unknown",
      taken: stamp.taken,
      file: stamp.file,
    };
  }
  return {
    id,
    source: resolved?.source ?? "local",
    revision: isCloud(id)
      ? cacheRevision(options.cacheDir ?? DEFAULT_CACHE_DIR, id)
      : "unknown",
    taken: null,
    file: null,
  };
}

function sourceForSave(
  id: string,
  options: ResolverOptions,
): Promise<{ resolved: RuntimeResult; temp: string | null }> {
  if (!isCloud(id)) return resolveSkill(id, false, options).then((resolved) => ({ resolved, temp: null }));

  // Cloud resolution is local-first. Use an empty workspace for the
  // preflight so an existing saved copy cannot hide the snapshot we are about
  // to save.
  const temp = mkdtempSync(join(tmpdir(), "atskills-preflight-"));
  return resolveSkill(id, false, { ...options, workingDir: temp })
    .then((resolved) => ({ resolved, temp }))
    .catch((error) => {
      rmSync(temp, { recursive: true, force: true });
      throw error;
    });
}

function targetPath(id: string, workingDir: string): string {
  return safeJoin(skillsRoot(workingDir), diskPath(id));
}

function retiredPath(dest: string): string {
  return `${dest}.codex-old-${process.pid.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function restoreRetired(dest: string, retired: string | null): void {
  if (!retired || !existsSync(retired)) return;
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  renameSync(retired, dest);
}

function triggerCandidates(id: string): Set<string> {
  return new Set([`@${id}`, diskPath(id), id]);
}

function rebuildAfterMutation(workingDir: string): string | undefined {
  try {
    rebuildWorkspaceIndex(workingDir);
  } catch (error) {
    return `workspace index was not rebuilt: ${errorMessage(error)}`;
  }
}

/** Save a detached snapshot with size, conflict, and provenance rules. */
export async function saveSkill(
  rawId: string,
  options: Partial<WorkspaceOptions> = {},
): Promise<RuntimeResult> {
  const id = stateId(rawId);
  if (typeof id !== "string") return id;

  const workingDir = workingDirectory(options);
  const resolverOptions: ResolverOptions = { ...options, workingDir };
  let resolved: RuntimeResult;
  let preflightTemp = null;
  try {
    const preflight = await sourceForSave(id, resolverOptions);
    resolved = preflight.resolved;
    preflightTemp = preflight.temp;
  } catch (error) {
    return failure(resultCode(errorMessage(error)), errorMessage(error));
  }
  if (!resolved?.success) {
    if (preflightTemp) rmSync(preflightTemp, { recursive: true, force: true });
    return failure(
      resolved?.code ?? resultCode(resolved?.error, "NOT_FOUND"),
      resolved?.error ?? `Unable to resolve '${id}'`,
    );
  }

  const sourceDir = resolved.dir ?? (resolved.path ? dirname(resolved.path) : null);
  if (!sourceDir || !existsSync(sourceDir)) {
    if (preflightTemp) rmSync(preflightTemp, { recursive: true, force: true });
    return failure("NOT_FOUND", `Resolved '${id}' has no materialized snapshot`);
  }
  let stats: SnapshotStats;
  try {
    stats = snapshotStats(sourceDir);
  } catch (error) {
    if (preflightTemp) rmSync(preflightTemp, { recursive: true, force: true });
    return failure("CONFLICT", errorMessage(error));
  }
  if (preflightTemp) rmSync(preflightTemp, { recursive: true, force: true });
  const limitError = snapshotLimitError(stats);
  if (limitError) return failure("TOO_LARGE", limitError, { bytes: stats.bytes, files: stats.files });

  const dest = targetPath(id, workingDir);
  if (!isSafeWorkspacePath(skillsRoot(workingDir), dest)) {
    return failure("INVALID_REF", `refusing unsafe saved-skill path for '${id}'`);
  }
  let retired: string | null = null;
  if (options.force && existsSync(dest)) {
    retired = retiredPath(dest);
    try {
      renameSync(dest, retired);
    } catch (error) {
      return failure("CONFLICT", `could not replace '${id}': ${errorMessage(error)}`);
    }
  }

  let saved: RuntimeResult;
  try {
    saved = await upstreamSaveSkillToProject(id, resolverOptions);
  } catch (error) {
    restoreRetired(dest, retired);
    return failure(resultCode(errorMessage(error)), errorMessage(error));
  }
  if (!saved?.success) {
    restoreRetired(dest, retired);
    return failure(resultCode(saved?.error, "CONFLICT"), saved?.error ?? `Could not save '${id}'`);
  }
  if (retired && existsSync(retired)) rmSync(retired, { recursive: true, force: true });

  let installed = false;
  let warning = saved.warning;
  if (options.install) {
    try {
      const line = installLineFor(skillsRoot(workingDir), id);
      addTriggerLine(skillsRoot(workingDir), line);
      installed = hasTriggerLine(skillsRoot(workingDir), line);
    } catch (error) {
      warning = `saved '${id}' but could not install it: ${errorMessage(error)}`;
    }
  }

  const indexWarning = rebuildAfterMutation(workingDir);
  if (indexWarning) warning = warning ? `${warning}; ${indexWarning}` : indexWarning;
  const provenance = provenanceFor(id, dest, resolverOptions, resolved);
  return success({
    ...saved,
    id,
    saved: true,
    installed,
    revision: provenance.revision,
    bytes: stats.bytes,
    files: stats.files,
    ...(warning ? { warning } : {}),
  });
}

/** Resolve and add the canonical autotrigger line. Safe to call repeatedly. */
export async function installSkill(
  rawId: string,
  options: Partial<WorkspaceOptions> = {},
): Promise<RuntimeResult> {
  const id = stateId(rawId);
  if (typeof id !== "string") return id;
  const workingDir = workingDirectory(options);
  let resolved: RuntimeResult;
  try {
    resolved = await resolveSkill(id, false, { ...options, workingDir });
  } catch (error) {
    return failure(resultCode(errorMessage(error)), errorMessage(error));
  }
  if (!resolved?.success) {
    return failure(
      resolved?.code ?? resultCode(resolved?.error, "NOT_FOUND"),
      resolved?.error ?? `Unable to resolve '${id}'`,
    );
  }

  const line = installLineFor(skillsRoot(workingDir), id);
  let added;
  try {
    added = addTriggerLine(skillsRoot(workingDir), line);
  } catch (error) {
    return failure("CONFLICT", `could not update ${workspacePaths(workingDir).autotrigger}: ${errorMessage(error)}`);
  }
  const indexWarning = rebuildAfterMutation(workingDir);
  return success({
    ...resolved,
    id,
    installed: true,
    added,
    saved: Boolean(readProvenance(id, workingDir)),
    ...(indexWarning ? { warning: indexWarning } : {}),
  });
}

/** Remove trigger lines only; saved snapshots stay untouched. */
export function uninstallSkill(
  rawId: string,
  options: Partial<WorkspaceOptions> = {},
): RuntimeResult {
  const id = stateId(rawId);
  if (typeof id !== "string") return id;
  const workingDir = workingDirectory(options);
  const root = skillsRoot(workingDir);
  const candidates = triggerCandidates(id);
  let removed = false;
  for (const entry of parseTriggers(root)) {
    if (candidates.has(entry.line) || entry.id === id) {
      removed = removeTriggerLine(root, entry.line) || removed;
    }
  }
  const indexWarning = removed ? rebuildAfterMutation(workingDir) : undefined;
  return success({
    id,
    installed: false,
    removed,
    ...(indexWarning ? { warning: indexWarning } : {}),
  });
}

/** Delete one saved snapshot, never the workspace state root itself. */
export function removeSkill(
  rawId: string,
  options: Partial<WorkspaceOptions> = {},
): RuntimeResult {
  const id = stateId(rawId);
  if (typeof id !== "string") return id;
  if (options.confirm !== true && options.yes !== true) {
    return failure("CONFIRMATION_REQUIRED", `removing '${id}' requires explicit confirmation`);
  }

  const workingDir = workingDirectory(options);
  const root = skillsRoot(workingDir);
  const dest = targetPath(id, workingDir);
  if (!isSafeWorkspacePath(root, dest)) {
    return failure("CONFLICT", `refusing unsafe saved-skill path for '${id}'`);
  }
  if (!existsSync(dest)) return failure("NOT_FOUND", `saved skill '${id}' does not exist`);
  if (lstatSync(dest).isSymbolicLink() || !statSync(dest).isDirectory()) {
    return failure("CONFLICT", `saved skill '${id}' is not a directory`);
  }
  const stamp = nearestSource(dest, root);
  if (!stamp) {
    return failure("CONFLICT", `refusing to remove '${id}': it is not marked as saved`);
  }

  try {
    rmSync(dest, { recursive: true, force: true });
    let parent = dirname(dest);
    while (parent !== root && parent.startsWith(`${root}${sep}`) && existsSync(parent)) {
      if (readdirSync(parent).length !== 0) break;
      rmSync(parent, { recursive: true, force: true });
      parent = dirname(parent);
    }
  } catch (error) {
    return failure("CONFLICT", `could not remove '${id}': ${errorMessage(error)}`);
  }

  const uninstall = uninstallSkill(id, { workingDir });
  const warning = [uninstall.warning, rebuildAfterMutation(workingDir)].filter(Boolean).join("; ");
  return success({
    id,
    removed: true,
    installed: false,
    ...(warning ? { warning } : {}),
  });
}

function skillMetadata(root: string, skill: FoundSkill): WorkspaceSkill {
  const dir = skill.dir;
  const id = normalizeId(skill.rel);
  if (!isSafeWorkspacePath(root, dir, true)) {
    throw new Error("skill path is symlinked or outside .atskills");
  }
  const skillFile = join(dir, "SKILL.md");
  const skillStat = lstatSync(skillFile);
  if (!skillStat.isFile()) throw new Error("SKILL.md is not a regular file");
  if (skillStat.size > MAX_SKILL_BYTES) {
    throw new Error(`SKILL.md is ${skillStat.size} bytes; maximum is ${MAX_SKILL_BYTES}`);
  }
  const stamp = nearestSource(dir, root);
  const meta = frontmatter(readFileSync(skillFile, "utf8"));
  let stats: SnapshotSummary;
  try {
    stats = snapshotStats(dir);
  } catch (error) {
    stats = { error: errorMessage(error) };
  }
  return {
    id,
    path: skillFile,
    name: meta.name,
    description: meta.description,
    saved: Boolean(stamp),
    provenance: stamp
      ? {
          id: stamp.id,
          taken: stamp.taken,
          revision: stamp.revision ?? "unknown",
          file: stamp.file,
        }
      : null,
    ...(stats.error ? { error: stats.error } : { bytes: stats.bytes, files: stats.files }),
  };
}

/** Rebuild the local-only derived index. This never resolves cloud entries. */
export function rebuildWorkspaceIndex(workingDir = process.cwd()): WorkspaceIndex {
  const paths = workspacePaths(workingDir);
  mkdirSync(paths.codex, { recursive: true });
  const skills: WorkspaceSkill[] = [];
  for (const skill of walkWorkspaceSkills(paths.root)) {
    try {
      skills.push(skillMetadata(paths.root, skill));
    } catch (error) {
      skills.push({ id: skill.rel, path: join(skill.dir, "SKILL.md"), error: errorMessage(error) });
    }
  }
  const index = {
    version: WORKSPACE_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    skills,
    provenance: skills
      .filter((skill): skill is WorkspaceSkill & { provenance: WorkspaceProvenance } => Boolean(skill.saved && skill.provenance))
      .map((skill) => ({ ...skill.provenance, id: skill.id, path: skill.path })),
    triggers: parseTriggers(paths.root),
    resident: expandLocalTriggers(paths.root)
      .filter((entry) => !entry.file || isSafeWorkspacePath(paths.root, entry.file, true))
      .map((entry) => ({ ...entry, ...(entry?.id ? { id: canonicalStateId(entry.id) } : {}) })),
  };
  writeFileAtomic(paths.index, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

export function readWorkspaceIndex(workingDir = process.cwd()): WorkspaceIndex | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(workspacePaths(workingDir).index, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as WorkspaceIndex : null;
  } catch {
    return null;
  }
}

/** Read saved metadata without invoking the resolver or the network. */
export function readWorkspaceState(workingDir = process.cwd()): WorkspaceState {
  const paths = workspacePaths(workingDir);
  const index = safeIndex(readWorkspaceIndex(workingDir), paths.root);
  return {
    paths,
    index,
    triggers: parseTriggers(paths.root),
    resident: expandLocalTriggers(paths.root)
      .filter((entry) => !entry.file || isSafeWorkspacePath(paths.root, entry.file, true))
      .map((entry) => ({ ...entry, ...(entry?.id ? { id: canonicalStateId(entry.id) } : {}) })),
    skills: index?.skills ?? [],
    provenance: index?.provenance ?? [],
  };
}

export function readProvenance(
  rawId: string,
  workingDir = process.cwd(),
): WorkspaceProvenance | null {
  const id = stateId(rawId);
  if (typeof id !== "string") return null;
  const root = skillsRoot(workingDir);
  const dest = targetPath(id, workingDir);
  if (!existsSync(dest)) return null;
  if (!isSafeWorkspacePath(root, dest, true)) return null;
  const stamp = nearestSource(dest, root);
  if (!stamp) return null;
  return {
    id: stamp.id,
    source: stamp.id.startsWith("gh:")
      ? "github"
      : stamp.id.startsWith("hub:")
        ? "hub"
        : "local",
    revision: stamp.revision ?? "unknown",
    taken: stamp.taken,
    path: dest,
    file: stamp.file,
  };
}

// Names used by the later management skill/CLI, kept as aliases so the
// shared adapter has one implementation and callers do not need wrappers.
export const saveWorkspaceSkill = saveSkill;
export const saveSkillToProject = saveSkill;
export const installWorkspaceSkill = installSkill;
export const uninstallWorkspaceSkill = uninstallSkill;
export const removeWorkspaceSkill = removeSkill;
export const provenance = readProvenance;
