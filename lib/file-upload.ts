import fs from "fs";
import path from "path";

export const UPLOAD_CONFLICT_STRATEGIES = ["error", "overwrite", "skip"] as const;
export type UploadConflictStrategy = typeof UPLOAD_CONFLICT_STRATEGIES[number];

const UPLOAD_CONFLICT_STRATEGY_SET = new Set<string>(UPLOAD_CONFLICT_STRATEGIES);

export interface UploadTargetInspection {
  conflicts: string[];
  nonReplaceable: string[];
}

export function parseUploadConflictStrategy(value: string | null): UploadConflictStrategy | null {
  const candidate = value ?? "error";
  return UPLOAD_CONFLICT_STRATEGY_SET.has(candidate)
    ? candidate as UploadConflictStrategy
    : null;
}

export function validateUploadFileNames(fileNames: string[]): string | null {
  if (fileNames.length === 0) return "No files selected";

  const seen = new Set<string>();
  for (const fileName of fileNames) {
    if (!fileName || fileName === "." || fileName === ".." || fileName.includes("\0")) {
      return `Invalid file name: ${fileName || "(empty)"}`;
    }
    if (fileName.includes("/") || fileName.includes("\\") || path.basename(fileName) !== fileName) {
      return `File names must not contain a path: ${fileName}`;
    }
    if (seen.has(fileName)) return `Duplicate file name in upload: ${fileName}`;
    seen.add(fileName);
  }

  return null;
}

export function inspectUploadTargets(directory: string, fileNames: string[]): UploadTargetInspection {
  const conflicts: string[] = [];
  const nonReplaceable: string[] = [];

  for (const fileName of fileNames) {
    const destination = path.join(directory, fileName);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw error;
    }

    conflicts.push(fileName);
    if (!stat.isFile() || stat.isSymbolicLink()) nonReplaceable.push(fileName);
  }

  return { conflicts, nonReplaceable };
}

export interface DropRootSpec {
  name: string;
  isDir: boolean;
}

/**
 * Validate a drop-relative path and return its normalized POSIX form, or null
 * when the path is absolute, uses a backslash, or escapes its root via `..`.
 */
export function normalizeDropRelativePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw || raw.includes("\0") || raw.includes("\\")) return null;
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) return null;
  const parts = raw.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === "." || part === "..") return null;
    out.push(part);
  }
  return out.join("/");
}

/** Parse the JSON `paths` form field (parallel to the `files` field). */
export function parseDropPaths(value: unknown): string[] | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

/** Parse the JSON `roots` form field (the top-level dropped items). */
export function parseDropRoots(value: unknown): DropRootSpec[] | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const roots: DropRootSpec[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) return null;
      const { name, isDir } = entry as { name?: unknown; isDir?: unknown };
      if (typeof name !== "string" || typeof isDir !== "boolean") return null;
      if (!normalizeDropRelativePath(name)) return null;
      roots.push({ name, isDir });
    }
    return roots;
  } catch {
    return null;
  }
}

/** Every dropped path must be valid and live under one of the declared roots. */
export function validateDropPaths(paths: string[], roots: DropRootSpec[]): string | null {
  const rootNames = new Set(roots.map((root) => root.name));
  for (const raw of paths) {
    const normalized = normalizeDropRelativePath(raw);
    if (!normalized) return `Invalid path: ${raw}`;
    if (!rootNames.has(normalized.split("/")[0])) {
      return `Path is not under a dropped item: ${raw}`;
    }
  }
  return null;
}

/**
 * Finder-style unique names for the dropped roots so a drop never clobbers an
 * existing entry: `notes.txt` becomes `notes (1).txt`, `src` becomes `src (1)`.
 */
export function resolveDropRootNames(directory: string, roots: DropRootSpec[]): Map<string, string> {
  const used = new Set<string>();
  const mapping = new Map<string, string>();
  const candidateName = (root: DropRootSpec, counter: number): string => {
    if (counter === 0) return root.name;
    if (root.isDir) return `${root.name} (${counter})`;
    const dot = root.name.lastIndexOf(".");
    if (dot > 0) return `${root.name.slice(0, dot)} (${counter})${root.name.slice(dot)}`;
    return `${root.name} (${counter})`;
  };
  for (const root of roots) {
    if (mapping.has(root.name)) continue;
    let counter = 0;
    let candidate = candidateName(root, counter);
    while (used.has(candidate) || fs.existsSync(path.join(directory, candidate))) {
      counter += 1;
      candidate = candidateName(root, counter);
    }
    used.add(candidate);
    mapping.set(root.name, candidate);
  }
  return mapping;
}
