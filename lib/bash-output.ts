import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export const MAX_INLINE_BASH_OUTPUT_BYTES = 5 * 1024 * 1024;

export function resolveBashOutputPath(filePath: string, tempRoot: string): string | null {
  const resolvedPath = resolve(filePath);
  if (dirname(resolvedPath) !== resolve(tempRoot)) return null;
  if (!/^pi-bash-[A-Za-z0-9_-]+\.log$/.test(basename(resolvedPath))) return null;
  return resolvedPath;
}

export async function openRegularFileNoFollow(filePath: string) {
  const pathInfo = await lstat(filePath);
  if (!pathInfo.isFile()) throw new Error("Bash output path is not a regular file");

  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(filePath, constants.O_RDONLY | noFollow);
  try {
    const fileInfo = await handle.stat();
    if (!fileInfo.isFile()) throw new Error("Bash output path is not a regular file");
    return { handle, fileInfo };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readUtf8FileWithinLimit(
  filePath: string,
  maxBytes = MAX_INLINE_BASH_OUTPUT_BYTES,
): Promise<{ tooLarge: true; size: number } | { tooLarge: false; content: string; size: number }> {
  const { handle, fileInfo } = await openRegularFileNoFollow(filePath);
  try {
    if (fileInfo.size > maxBytes) return { tooLarge: true, size: fileInfo.size };

    const buffer = Buffer.alloc(fileInfo.size);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    return {
      tooLarge: false,
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      size: bytesRead,
    };
  } finally {
    await handle.close();
  }
}
