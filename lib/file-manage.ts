import fs from "fs";
import path from "path";
import { hasParentDirectorySegment, isPathWithinRoots, resolveRealRoots } from "./path-security";
import { isGitName, validateUploadFileNames } from "./file-upload";

/**
 * The explorer's three writes besides uploads: create a folder, move or rename
 * an entry, delete one. Every path is resolved through the allow-list the way
 * uploads are, and an entry is always handled by name inside its real parent,
 * so a link is moved or deleted itself, never what it points to.
 */
export class FileManageError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Refuses a path that is `.git` or inside one, below the project root holding
 * it. Checked on the path as asked, before anything is looked up (`.GIT` on a
 * case-sensitive disk is refused, not "not found"), and again once links are
 * resolved.
 */
function refuseGitPath(target: string, roots: Iterable<string>): void {
  // The deepest root: a project opened inside another keeps its own view.
  let root = "";
  for (const candidate of roots) {
    if (candidate.length > root.length && isPathWithinRoots(target, new Set([candidate]))) root = candidate;
  }
  if (path.relative(root, target).split(path.sep).some(isGitName)) {
    throw new FileManageError(403, "Cannot change .git");
  }
}

function validateEntryName(name: unknown): string {
  if (typeof name !== "string") throw new FileManageError(400, "name must be a string");
  const error = validateUploadFileNames([name]);
  if (error) throw new FileManageError(400, error);
  if (isGitName(name)) throw new FileManageError(400, `Cannot use the name ${name}`);
  return name;
}

/** A directory inside the allowed roots, after resolving links on both sides. */
export function resolveManagedDirectory(directory: string, allowedRoots: Set<string>): string {
  // A body path reaches here verbatim: `..` is collapsed before links are followed (#748).
  if (hasParentDirectorySegment(directory) || !isPathWithinRoots(directory, allowedRoots)) {
    throw new FileManageError(403, "Access denied");
  }
  refuseGitPath(path.resolve(directory), allowedRoots);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(directory);
  } catch {
    throw new FileManageError(404, "Folder not found");
  }
  if (!stat.isDirectory()) throw new FileManageError(400, "Not a folder");
  const realDirectory = fs.realpathSync(directory);
  if (!isPathWithinRoots(realDirectory, resolveRealRoots(allowedRoots))) {
    throw new FileManageError(403, "Access denied");
  }
  refuseGitPath(realDirectory, resolveRealRoots(allowedRoots));
  return realDirectory;
}

interface ManagedEntry {
  path: string;
  stat: fs.Stats;
}

function resolveManagedEntry(entryPath: string, allowedRoots: Set<string>): ManagedEntry {
  const name = path.basename(entryPath);
  if (isGitName(name)) throw new FileManageError(403, "Cannot change .git");
  const parent = resolveManagedDirectory(path.dirname(entryPath), allowedRoots);
  const resolved = path.join(parent, name);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new FileManageError(404, "Not found");
  }
  // A project folder, or a folder holding one (a worktree under the project),
  // belongs to the sidebar, not the file tree.
  if (stat.isDirectory()) {
    for (const root of resolveRealRoots(allowedRoots)) {
      if (isPathWithinRoots(root, new Set([resolved]))) {
        throw new FileManageError(403, "Cannot change a folder that holds a project");
      }
    }
  }
  return { path: resolved, stat };
}

function foldName(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

export async function createDirectory(parent: string, name: unknown, allowedRoots: Set<string>): Promise<string> {
  const directory = resolveManagedDirectory(parent, allowedRoots);
  const target = path.join(directory, validateEntryName(name));
  try {
    await fs.promises.mkdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new FileManageError(409, `${path.basename(target)} already exists`);
    }
    throw error;
  }
  return target;
}

/** Moves an entry into `destination` under `name`; a rename keeps the destination. */
export async function moveEntry(
  source: string,
  destination: string,
  name: unknown,
  allowedRoots: Set<string>,
): Promise<string> {
  const entry = resolveManagedEntry(source, allowedRoots);
  const directory = resolveManagedDirectory(destination, allowedRoots);
  const target = path.join(directory, validateEntryName(name));
  if (target === entry.path) return target;
  if (entry.stat.isDirectory() && isPathWithinRoots(directory, new Set([entry.path]))) {
    throw new FileManageError(400, "Cannot move a folder into itself");
  }
  let existing: fs.Stats | null = null;
  try {
    existing = fs.lstatSync(target);
  } catch {
    existing = null;
  }
  // On a case-insensitive disk `a` → `A` finds the entry itself: that rename
  // is allowed. Only a name that differs in case (or Unicode form) can be the
  // entry itself; another name on the same inode is a hard link, and
  // rename() onto it would do nothing and report success.
  const sameEntry = existing !== null
    && existing.ino === entry.stat.ino
    && existing.dev === entry.stat.dev
    && foldName(target) === foldName(entry.path);
  if (existing && !sameEntry) {
    throw new FileManageError(409, `${path.basename(target)} already exists there`);
  }
  // rename() replaces an existing file, so the check above and the rename run
  // with nothing awaited between them.
  try {
    fs.renameSync(entry.path, target);
  } catch (error) {
    // Two project folders on different disks: a move there is a copy and a
    // delete, which the explorer does not do.
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      throw new FileManageError(400, "Cannot move between disks");
    }
    throw error;
  }
  return target;
}

export async function deleteEntry(source: string, allowedRoots: Set<string>): Promise<void> {
  const entry = resolveManagedEntry(source, allowedRoots);
  await fs.promises.rm(entry.path, { recursive: entry.stat.isDirectory() });
}
