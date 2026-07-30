import { readdir, realpath, stat } from "fs/promises";
import { homedir } from "os";
import path from "path";

export interface BrowsableDirectory {
  name: string;
  path: string;
}

export function getBrowseStartDirectory(directory?: string): string {
  return directory || homedir();
}

export function normalizeDirectory(directory: string): string {
  if (directory === "~") return homedir();
  if (directory.startsWith("~/")) return path.resolve(homedir(), directory.slice(2));
  return path.resolve(directory);
}

export function getParentDirectory(directory: string): string | null {
  const pathApi = /^[a-zA-Z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
    ? path.win32
    : path;
  const normalized = pathApi.normalize(directory);
  const parent = pathApi.dirname(normalized);
  return parent === normalized ? null : parent;
}

export async function resolveDirectory(directory: string): Promise<string> {
  return realpath(normalizeDirectory(directory));
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

/**
 * 列出可供浏览的顶层文件系统入口，作为目录选择器的起始视图，
 * 让用户从「选择磁盘」开始，而不是直接落入用户主目录。
 *
 * Windows 上返回可访问的盘符（C:、D:…）；其他平台返回根目录 `/`
 * （macOS 额外返回 `/Volumes` 以便访问已挂载的卷）。
 */
export async function listDrives(): Promise<BrowsableDirectory[]> {
  if (process.platform === "win32") {
    const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const found = await Promise.all(letters.map(async (letter) => {
      const root = `${letter}:\\`;
      try {
        const info = await stat(root);
        if (info.isDirectory()) return { name: `${letter}:`, path: root };
      } catch {
        // 盘符不存在或不可访问 —— 跳过。
      }
      return null;
    }));
    return found
      .filter((entry): entry is BrowsableDirectory => entry !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  // POSIX：暴露文件系统根目录（macOS 额外暴露 /Volumes 以访问挂载卷）。
  const entries: BrowsableDirectory[] = [{ name: "/", path: "/" }];
  if (process.platform === "darwin") {
    try {
      const info = await stat("/Volumes");
      if (info.isDirectory()) entries.push({ name: "Volumes", path: "/Volumes" });
    } catch {
      // 没有 /Volumes —— 仅保留根目录。
    }
  }
  return entries;
}
