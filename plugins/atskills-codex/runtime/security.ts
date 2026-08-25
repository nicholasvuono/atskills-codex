import { lstatSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DEFAULT_CACHE_DIR, skillsRoot } from "./atskills.js";
import type { LoadResponse, SkillResolverOpts } from "./atskills.js";
import type { ResolverOptions, ResultCode, RuntimeResult } from "./types.js";

export const MAX_SKILL_BYTES = 256 * 1024;

function within(root: string, target: string, mustExist = false): boolean {
  const base = resolve(root);
  const absolute = resolve(target);
  const rel = relative(base, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;

  let current = absolute;
  for (;;) {
    try {
      if (lstatSync(current).isSymbolicLink()) return false;
    } catch {
      if (mustExist) return false;
    }
    if (current === base) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function allowedRoots(options: Partial<ResolverOptions>): string[] {
  return [
    skillsRoot(resolve(options.workingDir ?? process.cwd())),
    options.cacheDir ?? DEFAULT_CACHE_DIR,
  ];
}

export function isSafeWorkspacePath(root: string, target: string, mustExist = false): boolean {
  return within(root, target, mustExist);
}

function safeSkillPath(path: unknown, options: Partial<ResolverOptions>): path is string {
  return (
    typeof path === "string" &&
    isAbsolute(path) &&
    basename(path) === "SKILL.md" &&
    allowedRoots(options).some((root) => within(root, path, true))
  );
}

function refusal(code: ResultCode, message: string): RuntimeResult {
  return { ok: false, success: false, code, error: message };
}

export function guardResolved(
  result: LoadResponse | RuntimeResult,
  options: Partial<ResolverOptions> = {},
): RuntimeResult {
  if (!result?.success) return result;

  if (result.kind === "skill") {
    const skillPath = result.path;
    if (!safeSkillPath(skillPath, options)) {
      return refusal("INVALID_REF", "refusing a skill path outside the trusted workspace/cache or through a symlink");
    }
    try {
      const stat = lstatSync(skillPath);
      if (!stat.isFile()) return refusal("INVALID_REF", "resolved SKILL.md is not a regular file");
      if (stat.size > MAX_SKILL_BYTES) {
        return refusal(
          "TOO_LARGE",
          `SKILL.md is ${stat.size} bytes; maximum is ${MAX_SKILL_BYTES} bytes`,
        );
      }
    } catch {
      return refusal("NOT_FOUND", "resolved SKILL.md is no longer available");
    }
  }

  if (result.kind === "menu" || result.kind === "collection") {
    for (const entry of result.entries ?? []) {
      if (entry.path && !safeSkillPath(entry.path, options)) {
        return refusal("INVALID_REF", "refusing a collection entry outside the trusted workspace/cache or through a symlink");
      }
    }
  }

  return result;
}

export async function resolveSafely(
  resolver: (id: string, save: boolean, options: SkillResolverOpts, install?: boolean) => Promise<LoadResponse>,
  id: string,
  save: boolean,
  options: ResolverOptions,
  install = false,
): Promise<RuntimeResult> {
  return guardResolved(await resolver(id, save, options, install), options);
}
