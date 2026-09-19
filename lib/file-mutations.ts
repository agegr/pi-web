import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { isPathWithinRoots } from "./path-security";

/** Upper bound for content accepted by the write action, matching the viewer's edit cap. */
export const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;

export interface MutationResult {
  ok: true;
}

export interface MutationError {
  ok: false;
  error: string;
  status: number;
}

export type MutationOutcome = MutationResult | MutationError;

function failure(error: string, status: number): MutationError {
  return { ok: false, error, status };
}

function toOutcome(error: unknown): MutationError {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return failure("Entry not found", 404);
  if (code === "EEXIST") return failure("An entry with this name already exists", 409);
  if (code === "ENOTDIR") return failure("Parent path is not a directory", 400);
  if (code === "ENOTEMPTY") return failure("Directory is not empty", 400);
  if (code === "EPERM" || code === "EACCES") return failure("Permission denied", 403);
  if (code === "EBUSY") return failure("Resource busy", 409);
  return failure(error instanceof Error ? error.message : String(error), 500);
}

/**
 * Validate a single path entry name supplied by the client (new file/folder
 * names, rename targets). Names must be plain entries: no separators, traversal
 * segments, control characters, or NUL bytes.
 */
export function validateEntryName(name: unknown): string | null {
  if (typeof name !== "string" || !name || name === "." || name === ".." || name.includes("\0")) {
    return "Invalid entry name";
  }
  if (name.includes("/") || name.includes("\\") || path.basename(name) !== name) {
    return "Entry name must not contain a path";
  }
  if (/[\u0000-\u001f]/.test(name)) {
    return "Entry name contains control characters";
  }
  return null;
}

/**
 * Resolve the parent directory of a target path and authorize it by realpath
 * against the allowed roots. Mutations must never follow a symlinked ancestor
 * outside the browsable roots, so every check below runs against realpathed
 * parents rather than the lexical path alone.
 */
export function resolveRealParent(
  target: string,
  allowedRoots: Set<string>,
): { ok: true; directory: string; realRoots: Set<string> } | MutationError {
  const parent = path.dirname(target);
  if (!isPathWithinRoots(parent, allowedRoots)) {
    return failure("Access denied", 403);
  }

  let realParent: string;
  try {
    realParent = fs.realpathSync(parent);
  } catch {
    return failure("Parent directory not found", 404);
  }

  const realRoots = new Set<string>();
  for (const root of allowedRoots) {
    try {
      realRoots.add(fs.realpathSync(root));
    } catch {
      // Ignore stale session roots that no longer exist.
    }
  }
  if (!isPathWithinRoots(realParent, realRoots)) {
    return failure("Access denied", 403);
  }

  return { ok: true, directory: realParent, realRoots };
}

/** Create an empty file or a directory inside an authorized real parent. */
export function createEntry(
  realParent: string,
  name: string,
  kind: "file" | "directory",
): MutationOutcome {
  const destination = path.join(realParent, name);
  try {
    if (kind === "file") {
      fs.writeFileSync(destination, "", { flag: "wx" });
    } else {
      fs.mkdirSync(destination);
    }
    return { ok: true };
  } catch (error) {
    return toOutcome(error);
  }
}

/** Rename an entry within its current directory. Cross-directory moves are refused. */
export function renameEntry(
  target: string,
  nextName: string,
  allowedRoots: Set<string>,
): MutationOutcome {
  const parent = resolveRealParent(target, allowedRoots);
  if (!parent.ok) return parent;

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    return toOutcome(error);
  }

  // Renaming a symlink only relinks the entry inside the same directory and
  // cannot escape the roots, so links are allowed here unlike delete/write.
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    const realTarget = fs.realpathSync(target);
    if (!isPathWithinRoots(realTarget, parent.realRoots)) {
      return failure("Access denied", 403);
    }
  }

  const destination = path.join(parent.directory, nextName);
  try {
    fs.lstatSync(destination);
    return failure("An entry with this name already exists", 409);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return toOutcome(error);
  }

  try {
    fs.renameSync(target, destination);
    return { ok: true };
  } catch (error) {
    return toOutcome(error);
  }
}

/**
 * Delete a file, symlink, or directory. Symlinks are unlinked without following
 * them; real files and directories must realpath inside the allowed roots.
 */
export function deleteEntry(
  target: string,
  recursive: boolean,
  allowedRoots: Set<string>,
): MutationOutcome {
  const parent = resolveRealParent(target, allowedRoots);
  if (!parent.ok) return parent;

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    return toOutcome(error);
  }

  if (stat.isSymbolicLink()) {
    try {
      fs.unlinkSync(target);
      return { ok: true };
    } catch (error) {
      return toOutcome(error);
    }
  }

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(target);
  } catch {
    return failure("Entry not found", 404);
  }
  if (!isPathWithinRoots(realTarget, parent.realRoots)) {
    return failure("Access denied", 403);
  }

  try {
    if (stat.isDirectory()) {
      if (!recursive) return failure("Directory deletion requires recursive confirmation", 400);
      fs.rmSync(target, { recursive: true, force: false });
    } else if (stat.isFile()) {
      fs.unlinkSync(target);
    } else {
      return failure("Unsupported entry type", 400);
    }
    return { ok: true };
  } catch (error) {
    return toOutcome(error);
  }
}

function containsNullBytes(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, BINARY_SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } catch {
    // Unreadable files fail on the actual write; treat as text here.
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/**
 * Replace the contents of an existing text file atomically, preserving its
 * permissions. Unlike writePrivateFileAtomicSync (credentials-focused, mode
 * 0600), editing a workspace file must keep the file's original mode and be
 * readable by the tools that own it.
 */
export function writeTextFile(
  target: string,
  content: string,
  allowedRoots: Set<string>,
): MutationOutcome {
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    return failure("File content must be 2MB or smaller", 413);
  }

  const parent = resolveRealParent(target, allowedRoots);
  if (!parent.ok) return parent;

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    return toOutcome(error);
  }
  if (stat.isSymbolicLink()) {
    return failure("Refusing to write through a symbolic link", 400);
  }
  if (!stat.isFile()) {
    return failure("Not a file", 400);
  }

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(target);
  } catch {
    return failure("Entry not found", 404);
  }
  if (!isPathWithinRoots(realTarget, parent.realRoots)) {
    return failure("Access denied", 403);
  }
  if (containsNullBytes(realTarget)) {
    return failure("Binary files cannot be edited as text", 415);
  }

  const tempPath = path.join(
    path.dirname(realTarget),
    `.${path.basename(realTarget)}-${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: stat.mode & 0o7777,
      flush: true,
    });
    fs.renameSync(tempPath, realTarget);
    return { ok: true };
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    return toOutcome(error);
  }
}
