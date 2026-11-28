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

/**
 * `.git` is never listed, so nothing the explorer shows is it or inside it.
 * Compared as a case-insensitive disk (macOS, Windows) and Windows' dropping
 * of trailing dots and spaces would: `.GIT` and `.git.` are the same folder there.
 */
export function isGitName(name: string): boolean {
  return name.replace(/[. ]+$/, "").toLowerCase() === ".git";
}

function invalidNameError(name: string): string | null {
  if (!name || name === "." || name === ".." || name.includes("\0")) {
    return `Invalid file name: ${name || "(empty)"}`;
  }
  return null;
}

export function validateUploadFileNames(fileNames: string[]): string | null {
  if (fileNames.length === 0) return "No files selected";

  const seen = new Set<string>();
  for (const fileName of fileNames) {
    const invalid = invalidNameError(fileName);
    if (invalid) return invalid;
    if (fileName.includes("/") || fileName.includes("\\") || path.basename(fileName) !== fileName) {
      return `File names must not contain a path: ${fileName}`;
    }
    if (seen.has(fileName)) return `Duplicate file name in upload: ${fileName}`;
    seen.add(fileName);
  }

  return null;
}

/**
 * Checks each file's path inside the upload folder: relative, `/`-separated,
 * no empty, `.` or `..` segment, no `.git`. A path that is also another one's
 * folder is refused, since one of the two could never be written.
 */
export function validateUploadPaths(paths: string[]): string | null {
  if (paths.length === 0) return "No files selected";

  const seen = new Set<string>();
  const folders = new Set<string>();
  for (const uploadPath of paths) {
    if (uploadPath.startsWith("/") || uploadPath.includes("\\") || path.win32.isAbsolute(uploadPath)) {
      return `Upload paths must be relative: ${uploadPath}`;
    }
    const segments = uploadPath.split("/");
    for (const segment of segments) {
      const invalid = invalidNameError(segment);
      if (invalid) return `${invalid} in ${uploadPath || "(empty)"}`;
      // A drive (`C:`) or anything else the platform reads as more than a name.
      if (path.basename(segment) !== segment) return `Invalid file name: ${segment} in ${uploadPath}`;
      if (isGitName(segment)) return `Cannot upload into .git: ${uploadPath}`;
    }
    if (seen.has(uploadPath)) return `Duplicate file name in upload: ${uploadPath}`;
    seen.add(uploadPath);
    for (let index = 1; index < segments.length; index += 1) folders.add(segments.slice(0, index).join("/"));
  }
  for (const uploadPath of paths) {
    if (folders.has(uploadPath)) return `${uploadPath} is both a file and a folder in the upload`;
  }

  return null;
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Where a file of the upload goes. Its folders are looked at one segment at
 * a time with `lstat`, so a link on the way is seen and never followed.
 * @returns The destination, or null when a folder on the way is missing (nothing there yet)
 *   or is not a real folder (the write will be refused)
 */
function existingDestination(directory: string, uploadPath: string): string | null {
  const segments = uploadPath.split("/");
  let current = directory;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return null;
  }
  return path.join(current, segments[segments.length - 1]);
}

export function inspectUploadTargets(directory: string, uploadPaths: string[]): UploadTargetInspection {
  const conflicts: string[] = [];
  const nonReplaceable: string[] = [];

  for (const uploadPath of uploadPaths) {
    const destination = existingDestination(directory, uploadPath);
    const stat = destination ? lstatOrNull(destination) : null;
    if (!stat) continue;

    conflicts.push(uploadPath);
    if (!stat.isFile() || stat.isSymbolicLink()) nonReplaceable.push(uploadPath);
  }

  return { conflicts, nonReplaceable };
}

/**
 * Creates the folders of one uploaded file's path inside the upload folder,
 * one segment at a time, and returns the file's destination. A segment that
 * is a file or a link is refused rather than followed, so a link inside the
 * project cannot send the write outside the allowed roots. Synchronous, so
 * nothing runs between a segment's check and the next one.
 */
export function prepareUploadDestination(directory: string, uploadPath: string): string {
  const segments = uploadPath.split("/");
  let current = directory;
  for (let index = 0; index < segments.length - 1; index += 1) {
    current = path.join(current, segments[index]);
    let stat = lstatOrNull(current);
    if (!stat) {
      try {
        fs.mkdirSync(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      stat = fs.lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${segments.slice(0, index + 1).join("/")} is not a folder`);
    }
  }
  return path.join(current, segments[segments.length - 1]);
}

/** Keep the old entry intact until its complete replacement can be renamed over it. */
export async function replaceUploadFile(destination: string, bytes: Buffer): Promise<void> {
  const stat = await fs.promises.lstat(destination);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Cannot replace a directory or symbolic link");
  }

  // A private directory beside the destination keeps the rename on the same
  // filesystem and gives us ownership of the staging file, even on write failure.
  const stagingDirectory = await fs.promises.mkdtemp(path.join(path.dirname(destination), ".pi-upload-"));
  const stagingFile = path.join(stagingDirectory, "upload");
  try {
    await fs.promises.writeFile(stagingFile, bytes, { flag: "wx", mode: stat.mode & 0o777 });
    await fs.promises.chmod(stagingFile, stat.mode & 0o777);
    // The destination may have changed since the multipart upload was inspected.
    // Check and rename synchronously so nothing runs between the two.
    const current = fs.lstatSync(destination);
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new Error("Cannot replace a directory or symbolic link");
    }
    fs.renameSync(stagingFile, destination);
  } finally {
    await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
  }
}
