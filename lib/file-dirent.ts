import fs from "fs";

type DirentType = Pick<fs.Dirent, "isDirectory" | "isFile">;

export function resolveDirentIsDirectory(
  dirent: DirentType,
  fullPath: string,
): boolean | null {
  if (dirent.isDirectory()) return true;
  if (dirent.isFile()) return false;

  try {
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return null;
  }
}
