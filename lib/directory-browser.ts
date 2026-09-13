import { lstat, mkdir, readdir, realpath, rename, rmdir, stat } from "fs/promises";
import { homedir } from "os";
import path from "path";

export interface BrowsableDirectory {
  name: string;
  path: string;
}

export function shouldShowWindowsDrivePicker(
  directory?: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && !directory;
}

export function getBrowseStartDirectory(directory?: string): string {
  return directory || homedir();
}

export function getWindowsDriveCandidates(): BrowsableDirectory[] {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => ({
    name: `${letter}:`,
    path: `${letter}:\\`,
  }));
}

export async function listWindowsDrives(): Promise<BrowsableDirectory[]> {
  const candidates = await Promise.all(getWindowsDriveCandidates().map(async (drive) => {
    try {
      const driveStat = await stat(drive.path);
      return driveStat.isDirectory() ? drive : null;
    } catch {
      return null;
    }
  }));

  return candidates.filter((drive): drive is BrowsableDirectory => drive !== null);
}

export function normalizeDirectory(directory: string): string {
  if (directory === "~") return homedir();
  if (directory.startsWith("~/")) return path.resolve(homedir(), directory.slice(2));
  return path.resolve(directory);
}

export function getParentDirectory(directory: string): string | null {
  const pathApi = /^[a-zA-Z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
    ? path.win32
    : path.posix;
  const normalized = pathApi.normalize(directory);
  const parent = pathApi.dirname(normalized);
  return parent === normalized ? null : parent;
}

export async function resolveDirectory(directory: string): Promise<string> {
  return realpath(normalizeDirectory(directory));
}

/** Returns a user-facing validation error, or null when the name is safe. */
export function validateDirectoryName(
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!name) return "Directory name is required";
  if (name === "." || name === "..") return "Directory name is invalid";
  if (name.length > 255) return "Directory name is too long";
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return "Directory name must not contain a path separator";
  }
  if ([...name].some((character) => character.charCodeAt(0) < 32)) {
    return "Directory name contains an invalid character";
  }

  if (platform === "win32") {
    if (/[<>:\"|?*]/.test(name) || /[. ]$/.test(name)) {
      return "Directory name contains an invalid Windows character";
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
      return "Directory name is reserved by Windows";
    }
  }

  return null;
}

function normalizedDirectoryName(name: string): string {
  return name.trim();
}

export async function createDirectory(
  parentDirectory: string,
  name: string,
): Promise<BrowsableDirectory> {
  const directoryName = normalizedDirectoryName(name);
  const validationError = validateDirectoryName(directoryName);
  if (validationError) throw new Error(validationError);

  const parentPath = await resolveDirectory(parentDirectory);
  const directoryPath = path.join(parentPath, directoryName);
  await mkdir(directoryPath);
  return { name: directoryName, path: directoryPath };
}

export async function renameDirectory(
  directory: string,
  name: string,
): Promise<BrowsableDirectory> {
  const directoryName = normalizedDirectoryName(name);
  const validationError = validateDirectoryName(directoryName);
  if (validationError) throw new Error(validationError);

  const sourceInput = normalizeDirectory(directory);
  const sourceStat = await lstat(sourceInput);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error("Path is not a directory");
  }

  const sourcePath = await realpath(sourceInput);
  const parentPath = path.dirname(sourcePath);
  const targetPath = path.join(parentPath, directoryName);
  if (path.normalize(sourcePath) === path.normalize(targetPath)) {
    throw new Error("Directory name is unchanged");
  }

  try {
    await lstat(targetPath);
    throw new Error("A directory with that name already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await rename(sourcePath, targetPath);
  return { name: directoryName, path: targetPath };
}

export async function deleteDirectory(directory: string): Promise<void> {
  const sourceInput = normalizeDirectory(directory);
  const sourceStat = await lstat(sourceInput);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error("Path is not a directory");
  }

  const sourcePath = await realpath(sourceInput);
  if (getParentDirectory(sourcePath) === null) {
    throw new Error("Cannot delete a root directory");
  }

  // Deliberately do not use recursive deletion: a confirmation should never
  // turn into deleting a whole project tree by accident.
  await rmdir(sourcePath);
}

export async function listDirectories(directory: string): Promise<BrowsableDirectory[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  // 忽略损坏、不可访问或不指向目录的符号链接。
  const candidates = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) {
      return { name: entry.name, path: path.join(directory, entry.name) };
    }
    if (!entry.isSymbolicLink()) return null;

    try {
      const entryPath = path.join(directory, entry.name);
      const realEntryPath = await realpath(entryPath);
      const entryStat = await stat(realEntryPath);
      if (!entryStat.isDirectory()) return null;
      return { name: entry.name, path: entryPath };
    } catch {
      return null;
    }
  }));

  return candidates
    .filter((entry): entry is BrowsableDirectory => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
