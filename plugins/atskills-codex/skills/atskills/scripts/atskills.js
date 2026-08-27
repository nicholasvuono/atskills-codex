#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { diskPath, normalizeId } from "../../../runtime/atskills.js";
import { resolveSkill } from "../../../runtime/core.js";
import { installSkill, readProvenance, rebuildWorkspaceIndex, removeSkill, saveSkill, uninstallSkill, } from "../../../runtime/state.js";
const COMMANDS = [
    "get",
    "save",
    "install",
    "uninstall",
    "remove",
    "list",
    "triggers",
    "provenance",
];
const ID_COMMANDS = new Set(["get", "save", "install", "uninstall", "remove", "provenance"]);
class CliError extends Error {
    code;
    constructor(message, code = "USAGE") {
        super(message);
        this.code = code;
    }
}
function writeOut(value) {
    process.stdout.write(`${String(value)}\n`);
}
function writeErr(value) {
    process.stderr.write(`${String(value)}\n`);
}
function parseArgs(argv) {
    const options = {
        cwd: process.cwd(),
        force: false,
        json: false,
        yes: false,
    };
    const positionals = [];
    let command = null;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === "--json") {
            options.json = true;
            continue;
        }
        if (token === "--force") {
            options.force = true;
            continue;
        }
        if (token === "--yes") {
            options.yes = true;
            continue;
        }
        if (token === "--cwd") {
            const value = argv[++index];
            if (!value || value.startsWith("-"))
                throw new CliError("--cwd requires an absolute path");
            options.cwd = value;
            continue;
        }
        if (token.startsWith("-")) {
            throw new CliError(`unknown option: ${token}`);
        }
        if (!command) {
            command = COMMANDS.find((candidate) => candidate === token) ?? null;
            if (!command)
                throw new CliError(`unknown command: ${token}`);
        }
        else
            positionals.push(token);
    }
    if (!command)
        throw new CliError("a command is required");
    if (!isAbsolute(options.cwd))
        throw new CliError("--cwd must be an absolute path");
    if (!existsSync(options.cwd) || !statSync(options.cwd).isDirectory()) {
        throw new CliError(`--cwd is not an existing directory: ${options.cwd}`);
    }
    if (options.force && command !== "save") {
        throw new CliError("--force is only valid with save");
    }
    if (options.yes && command !== "remove") {
        throw new CliError("--yes is only valid with remove");
    }
    if (ID_COMMANDS.has(command) && positionals.length !== 1) {
        throw new CliError(`${command} requires exactly one <id>`);
    }
    if (!ID_COMMANDS.has(command) && positionals.length !== 0) {
        throw new CliError(`${command} does not accept an <id>`);
    }
    return { command, options, positionals };
}
function errorCode(message) {
    const text = String(message);
    if (/invalid|empty skill path|path escapes/i.test(text))
        return "INVALID_REF";
    if (/too large|over the \d+|exceed/i.test(text))
        return "TOO_LARGE";
    if (/conflict|already exists|edited|project's own work/i.test(text))
        return "CONFLICT";
    if (/no skill|nothing at|not found|no skills under/i.test(text))
        return "NOT_FOUND";
    return "NETWORK";
}
function payload(command, result = {}) {
    const ok = result.ok !== false && result.success !== false;
    return { command, ...result, ok };
}
function failure(command, code, error, extra = {}) {
    return payload(command, {
        ...extra,
        ok: false,
        success: false,
        code,
        error: String(error),
    });
}
function resultPayload(command, result) {
    if (!result || typeof result !== "object") {
        return failure(command, "NETWORK", "the shared runtime returned no result");
    }
    if (result.ok === false || result.success === false) {
        return payload(command, {
            ...result,
            code: result.code ?? errorCode(result.error),
        });
    }
    return payload(command, result);
}
function resolverOptions(workingDir) {
    const log = {
        info: (message) => writeErr(`[atskills] ${message}`),
        warn: (message) => writeErr(`[atskills] ${message}`),
    };
    return {
        workingDir,
        cacheDir: process.env.ATSKILLS_CACHE || undefined,
        githubBaseUrl: process.env.ATSKILLS_GITHUB_BASE_URL || undefined,
        log,
    };
}
function canonicalId(command, rawId) {
    try {
        return { id: normalizeId(rawId ?? "") };
    }
    catch (error) {
        return {
            error: failure(command, "INVALID_REF", error instanceof Error ? error.message : error, {
                id: rawId,
            }),
        };
    }
}
function installed(id, triggers, resident) {
    const candidates = new Set([id, `@${id}`, diskPath(id)]);
    return (triggers.some((entry) => candidates.has(entry.line) || entry.id === id) ||
        resident.some((entry) => !entry.error && entry.id === id));
}
function workspaceView(workingDir) {
    const index = rebuildWorkspaceIndex(workingDir);
    const { skills, triggers, resident } = index;
    const listed = skills.map((skill) => ({
        ...skill,
        installed: typeof skill.id === "string" && installed(skill.id, triggers, resident),
    }));
    return {
        skills: listed,
        resident,
        triggers,
    };
}
async function execute(args) {
    const { command, options } = args;
    const workingDir = options.cwd;
    const opts = resolverOptions(workingDir);
    if (command === "list") {
        const view = workspaceView(workingDir);
        return payload(command, { skills: view.skills });
    }
    if (command === "triggers") {
        const view = workspaceView(workingDir);
        return payload(command, {
            triggers: view.triggers,
            resident: view.resident,
        });
    }
    const rawId = args.positionals[0];
    const canonical = canonicalId(command, rawId);
    if ("error" in canonical)
        return canonical.error;
    const { id } = canonical;
    if (command === "get") {
        return resultPayload(command, await resolveSkill(id, false, opts));
    }
    if (command === "save") {
        return resultPayload(command, await saveSkill(id, { ...opts, force: options.force }));
    }
    if (command === "install") {
        return resultPayload(command, await installSkill(id, opts));
    }
    if (command === "uninstall") {
        return resultPayload(command, uninstallSkill(id, opts));
    }
    if (command === "remove") {
        if (!options.yes) {
            return failure(command, "CONFIRMATION_REQUIRED", `removing '${id}' requires --yes; no files were changed`, { id });
        }
        return resultPayload(command, removeSkill(id, { ...opts, yes: true }));
    }
    if (command === "provenance") {
        const view = workspaceView(workingDir);
        const record = readProvenance(id, workingDir);
        if (!record)
            return failure(command, "NOT_FOUND", `no saved provenance for '${id}'`, { id });
        return payload(command, {
            ...record,
            installed: installed(id, view.triggers, view.resident),
            saved: true,
        });
    }
    throw new CliError(`unsupported command: ${command}`);
}
function renderHuman(result) {
    if (!result.ok) {
        writeErr(`atskills ${result.command ?? ""}: ${result.error}`.trim());
        return;
    }
    switch (result.command) {
        case "get":
            if (result.kind === "skill") {
                process.stdout.write(result.content ?? "");
                if (result.content && !result.content.endsWith("\n"))
                    process.stdout.write("\n");
            }
            else {
                for (const entry of result.entries ?? []) {
                    writeOut(`${entry.id}: ${entry.name}${entry.description ? ` — ${entry.description}` : ""}`);
                }
            }
            return;
        case "list":
            if (!result.skills?.length)
                writeOut("no local skills");
            for (const skill of result.skills ?? []) {
                const flags = [skill.saved && "saved", skill.installed && "installed"].filter(Boolean);
                writeOut(`${skill.id}: ${skill.name ?? "(unnamed)"}${flags.length ? ` [${flags.join(", ")}]` : ""}`);
            }
            return;
        case "triggers":
            if (!result.triggers?.length)
                writeOut("no .atskills/.autotrigger entries");
            for (const entry of result.triggers ?? []) {
                writeOut(entry.error ? `✗ ${entry.line} — ${entry.error}` : `● ${entry.line}`);
            }
            return;
        case "provenance":
            for (const key of ["id", "source", "revision", "path", "installed"]) {
                if (result[key] !== undefined)
                    writeOut(`${key}: ${result[key]}`);
            }
            return;
        default:
            writeOut(`${result.command}: ${result.id ?? "ok"}`);
            if (result.warning)
                writeErr(`warning: ${result.warning}`);
    }
}
function emit(result, json) {
    if (json)
        writeOut(JSON.stringify(result));
    else
        renderHuman(result);
}
async function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseArgs(argv);
    }
    catch (error) {
        const json = argv.includes("--json");
        const result = failure(null, error instanceof CliError ? error.code : "USAGE", error instanceof Error ? error.message : error);
        emit(result, json);
        return 2;
    }
    try {
        const result = await execute(args);
        emit(result, args.options.json);
        return result.ok ? 0 : 1;
    }
    catch (error) {
        const result = failure(args.command, error instanceof CliError ? error.code : "NETWORK", error instanceof Error ? error.message : error);
        emit(result, args.options.json);
        return 1;
    }
}
process.exitCode = await main();
