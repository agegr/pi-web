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

/** Bounded folder-name length for the mkdir route (single path segment). */
const MAX_FOLDER_NAME_BYTES = 255;

/**
 * Validate one folder name for POST /api/files/<parent>?type=mkdir. The
 * name must be exactly one path segment: non-empty, no separators, no
 * traversal (".."), no NUL, and within the byte budget — anything else is a
 * 400. Returns null when the name is usable.
 */
export function validateMkdirFolderName(name: string | null): string | null {
  if (name == null || name.length === 0) return "Folder name is required";
  if (name.includes("\0")) return "Invalid folder name";
  if (name === "." || name === "..") return `Invalid folder name: ${name}`;
  if (name.includes("/") || name.includes("\\") || path.basename(name) !== name) {
    return `Folder names must not contain a path: ${name}`;
  }
  if (Buffer.byteLength(name, "utf8") > MAX_FOLDER_NAME_BYTES) {
    return "Folder name is too long";
  }
  return null;
}

/**
 * Validate one file name for POST /api/files/<parent>?type=create-file.
 * The same single-segment rule set as validateMkdirFolderName with
 * file-appropriate messages: non-empty, no separators, no traversal
 * ("."/".."), no NUL, within the byte budget — ordinary dots inside names
 * (e.g. "notes.md") stay allowed. Returns null when the name is usable.
 * The route MUST run this before any path.join/write so an unsafe name can
 * never reach the filesystem.
 */
export function validateNewFileName(name: string | null): string | null {
  if (name == null || name.length === 0) return "File name is required";
  if (name.includes("\0")) return "Invalid file name";
  if (name === "." || name === "..") return `Invalid file name: ${name}`;
  if (name.includes("/") || name.includes("\\") || path.basename(name) !== name) {
    return `File names must not contain a path: ${name}`;
  }
  if (Buffer.byteLength(name, "utf8") > MAX_FOLDER_NAME_BYTES) {
    return "File name is too long";
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
