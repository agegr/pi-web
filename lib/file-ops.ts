import fs from "fs";
import path from "path";
import { getAllowedFileRoots } from "./file-access";
import { isExistingPathWithinRoots } from "./path-security";

/**
 * Error thrown by file-operation helpers. Carries an HTTP status and optional
 * JSON-serializable extras so route handlers can map it directly to a response.
 */
export class FileOpError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;

  constructor(message: string, status: number, extra?: Record<string, unknown>) {
    super(message);
    this.name = "FileOpError";
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Validate a single path component (a file or folder name). Mirrors the rules
 * in {@link validateUploadFileNames} but for one name and without the
 * duplicate check. Returns an error message string, or null when the name is
 * acceptable. Rejects empty, ".", "..", NUL bytes, path separators, and names
 * whose basename differs (guards against traversal like "a/b" or trailing
 * slashes).
 */
export function validateSingleFileName(name: string): string | null {
  if (!name || name === "." || name === ".." || name.includes("\0")) {
    return "Invalid file name";
  }
  if (name.includes("/") || name.includes("\\") || path.basename(name) !== name) {
    return "File names must not contain a path";
  }
  return null;
}

/**
 * True when {@link maybeAncestor} is {@link target} itself or a parent
 * directory of it. Both paths should be normalized absolute paths. Used to
 * block moving a folder into itself or one of its descendants. Handles both
 * POSIX and Windows separators.
 */
export function isAncestorOrSelf(maybeAncestor: string, target: string): boolean {
  const ancestor = maybeAncestor.replace(/[\\/]+$/, "");
  const descendant = target.replace(/[\\/]+$/, "");
  if (!ancestor || !descendant) return false;
  if (ancestor === descendant) return true;
  const sep = ancestor.includes("\\") && !ancestor.includes("/") ? "\\" : "/";
  return descendant.startsWith(ancestor + sep);
}

/**
 * Authorize an existing path for a mutating operation. Resolves symbolic links
 * (via {@link isExistingPathWithinRoots}, which realpaths both the target and
 * the allowed roots) and confirms the real path is still inside an allowed
 * root, then returns the real path for the caller to operate on. Operating on
 * the real path matches the existing upload behavior and prevents a symlink
 * inside an allowed root from redirecting a write outside it.
 *
 * Throws {@link FileOpError} with status 404 (missing) or 403 (forbidden).
 *
 * @param roots Optional pre-resolved allowed roots. Production callers omit it
 *   (the real roots are read from disk); tests inject a temp-dir set.
 */
export async function authorizeExistingPath(
  fsPath: string,
  roots?: Set<string>,
): Promise<string> {
  let realPath: string;
  try {
    realPath = fs.realpathSync(fsPath);
  } catch {
    throw new FileOpError("Not found", 404);
  }

  const resolvedRoots = roots ?? await getAllowedFileRoots();
  if (!isExistingPathWithinRoots(fsPath, resolvedRoots)) {
    throw new FileOpError("Access denied", 403);
  }
  return realPath;
}
