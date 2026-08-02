import path from "node:path";

export function sessionPathKey(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized =
    platform === "win32" ? path.win32.normalize(filePath) : path.posix.normalize(filePath);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}
