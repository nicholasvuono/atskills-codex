import type {
  LoadResponse,
  Logger,
  ResidentSkill,
  SkillMenuEntry,
  SkillReference,
  SkillResolverOpts,
  TriggerEntry,
} from "./atskills.js";

export type ResolverOptions = SkillResolverOpts & { log?: Logger };

export type ResultCode =
  | "INVALID_REF"
  | "TOO_LARGE"
  | "CONFLICT"
  | "NOT_FOUND"
  | "NETWORK"
  | "CONFIRMATION_REQUIRED"
  | "USAGE";

export type RuntimeResult = Omit<Partial<LoadResponse>, "kind" | "entries" | "files" | "source"> & {
  kind?: "skill" | "menu" | "collection";
  entries?: SkillMenuEntry[];
  ok?: boolean;
  code?: ResultCode;
  source?: string;
  provenance?: { revision?: string };
  saved?: boolean;
  installed?: boolean;
  added?: boolean;
  removed?: boolean;
  bytes?: number;
  files?: string[] | number;
  revision?: string;
  taken?: string | null;
  file?: string | null;
};

export interface WorkspaceOptions extends ResolverOptions {
  force?: boolean;
  install?: boolean;
  confirm?: boolean;
  yes?: boolean;
}

export interface WorkspacePaths {
  root: string;
  autotrigger: string;
  codex: string;
  index: string;
}

export interface WorkspaceSkill {
  id: string;
  path: string;
  name?: string | null;
  description?: string | null;
  saved?: boolean;
  provenance?: WorkspaceProvenance | null;
  bytes?: number;
  files?: number;
  error?: string;
}

export interface WorkspaceProvenance {
  id: string;
  source?: string;
  revision: string;
  taken: string | null;
  path?: string;
  file: string | null;
}

export interface WorkspaceIndex {
  version: number;
  generatedAt: string;
  skills: WorkspaceSkill[];
  provenance: WorkspaceProvenance[];
  triggers: TriggerEntry[];
  resident: ResidentSkill[];
}

export interface WorkspaceState {
  paths: WorkspacePaths;
  index: WorkspaceIndex | null;
  triggers: TriggerEntry[];
  resident: ResidentSkill[];
  skills: WorkspaceSkill[];
  provenance: WorkspaceProvenance[];
}

export interface ParsedReference extends SkillReference {
  raw: string;
  start: number;
  end: number;
  error?: string;
}

export interface InvalidParsedReference {
  raw: string;
  start: number;
  end: number;
  error: string;
}

export type ParsedSkillReference = ParsedReference | InvalidParsedReference;

export interface ResolvedReference {
  raw: string;
  start: number;
  end: number;
  id?: string;
  save?: boolean;
  install?: boolean;
  error?: string;
  result: RuntimeResult;
}

export interface HookInput {
  hook_event_name?: string;
  source?: string;
  cwd?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit" | "SessionStart";
    additionalContext: string;
  };
}
