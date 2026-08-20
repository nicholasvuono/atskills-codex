import {
  parseReference,
  resolveMany,
  resolveSkill,
} from "./atskills.mjs";
import {
  installSkill,
  removeSkill,
  saveSkill,
  uninstallSkill,
} from "./state.mjs";

const skillReference = /(?<![\p{L}\p{N}_@])@(?:skills|workflow):[^\s]*/gu;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Find @skills: references without making a bad reference abort the prompt. */
export function parseSkillReferences(message) {
  const text = String(message);
  const references = [];

  for (const match of text.matchAll(skillReference)) {
    const raw = match[0];
    const start = match.index ?? 0;
    try {
      references.push({
        raw,
        start,
        end: start + raw.length,
        ...parseReference(raw),
      });
    } catch (error) {
      references.push({
        raw,
        start,
        end: start + raw.length,
        error: errorMessage(error),
      });
    }
  }

  return references;
}

/** Parse and resolve every reference in message, preserving message order. */
export async function resolveSkillReferences(message, opts) {
  const references = parseSkillReferences(message);
  const valid = references.filter((reference) => !reference.error);
  const results = await resolveMany(
    valid.map((reference) => reference.id),
    valid.map(({ save, install }) => ({ save, install })),
    (id, save, install) =>
      save
        ? saveSkill(id, { ...opts, install })
        : install
          ? installSkill(id, opts)
          : resolveSkill(id, false, opts),
    (_id, error) => ({ success: false, error: errorMessage(error) }),
  );

  let resultIndex = 0;
  return references.map((reference) =>
    reference.error
      ? {
          ...reference,
          result: { success: false, error: reference.error },
        }
      : { ...reference, result: results[resultIndex++] },
  );
}

export * from "./state.mjs";
