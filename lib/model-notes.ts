import { readFileSync } from "fs";
import { join } from "path";

/**
 * Curated one-line notes shown next to a model in the picker.
 *
 * Pi's `models.json` describes what a model *is* (endpoint, limits, cost) but
 * has no field for "why you would pick it". That judgement does not belong in
 * a schema Pi validates, so it lives in a separate file the harness owns:
 *
 *   ~/.pi/agent/model-notes.json
 *
 * Shape — a map from `provider/modelId` to a note:
 *
 *   {
 *     "ark/glm-5.3": "综合强，日常首选",
 *     "ark/glm-5.3-flash": "快，适合小改动"
 *   }
 *
 * A bare `modelId` matches any provider as a fallback. Unknown keys and a
 * missing or malformed file are ignored: notes are decoration, and a typo in
 * this file must never stop the picker from loading.
 */

export const MODEL_NOTES_FILENAME = "model-notes.json";

/** Key used to look a model up in the notes map. */
export function modelNoteKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

/**
 * Parse the notes file into a lookup map. Accepts a string note or an object
 * with `note`/`text`; anything else is dropped.
 */
export function parseModelNotes(raw: unknown): Map<string, string> {
  const notes = new Map<string, string>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return notes;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || key.trim() === "") continue;
    const text =
      typeof value === "string"
        ? value
        : value && typeof value === "object" && !Array.isArray(value)
          ? (value as { note?: unknown; text?: unknown }).note ?? (value as { text?: unknown }).text
          : undefined;
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    if (trimmed) notes.set(key, trimmed);
  }
  return notes;
}

/** Look up a note, preferring `provider/model` and falling back to `model`. */
export function resolveModelNote(
  notes: Map<string, string>,
  provider: string,
  modelId: string,
): string | undefined {
  return notes.get(modelNoteKey(provider, modelId)) ?? notes.get(modelId);
}

/** Read the notes file from an agent directory. Never throws. */
export function loadModelNotes(agentDir: string): Map<string, string> {
  try {
    const raw = readFileSync(join(agentDir, MODEL_NOTES_FILENAME), "utf8");
    return parseModelNotes(JSON.parse(raw));
  } catch {
    return new Map();
  }
}
