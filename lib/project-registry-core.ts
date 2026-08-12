import { isAbsolute } from "node:path";

export interface ProjectPreference {
  path: string;
  name?: string;
  pinned: boolean;
  archived: boolean;
  removed: boolean;
  order: number;
}

const MAX_PROJECTS = 1000;
const MAX_NAME_LENGTH = 120;

export function normalizeProjectPreferences(value: unknown): ProjectPreference[] {
  if (!Array.isArray(value) || value.length > MAX_PROJECTS) {
    throw new Error("projects must be an array with at most 1000 entries");
  }

  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`projects[${index}] must be an object`);
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.path !== "string" || !isAbsolute(candidate.path)) {
      throw new Error(`projects[${index}].path must be an absolute path`);
    }
    const path = candidate.path.trim();
    if (!path || seen.has(path)) throw new Error(`duplicate or empty project path: ${path}`);
    seen.add(path);

    const rawName = candidate.name;
    if (rawName !== undefined && typeof rawName !== "string") {
      throw new Error(`projects[${index}].name must be a string`);
    }
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(`projects[${index}].name is too long`);
    }

    return {
      path,
      ...(name ? { name } : {}),
      pinned: candidate.pinned === true,
      archived: candidate.archived === true,
      removed: candidate.removed === true,
      order: Number.isInteger(candidate.order) ? candidate.order as number : index,
    };
  });
}
