import { randomUUID } from "crypto";
import { chmodSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

/**
 * Replace a file atomically: the bytes land in a sibling temp file that is then
 * renamed onto the destination, so a process killed mid-write leaves the old
 * file whole. The caller must create the parent directory first.
 */
function writeFileAtomicSync(path: string, contents: string, mode: number): void {
  const dir = dirname(path);
  const tempPath = join(dir, `.${basename(path)}-${randomUUID()}.tmp`);
  let operationFailed = false;

  try {
    writeFileSync(tempPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode,
      flush: true,
    });
    renameSync(tempPath, path);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !operationFailed) {
        throw error;
      }
    }
  }
}

/**
 * Replace a file atomically without exposing credentials through default
 * process permissions. The caller must create the parent directory first.
 */
export function writePrivateFileAtomicSync(path: string, contents: string): void {
  writeFileAtomicSync(path, contents, 0o600);
}

/**
 * Replace an existing session file atomically, keeping the mode pi gave it
 * (a new file takes pi's 0644 default through the umask, never the private 0600).
 */
export function writeSessionFileAtomicSync(path: string, contents: string): void {
  const existingMode = statSync(path, { throwIfNoEntry: false })?.mode;
  writeFileAtomicSync(path, contents, existingMode === undefined ? 0o644 : existingMode & 0o777);
  // The temp file's mode was masked by the umask; restore the exact bits.
  if (existingMode !== undefined) chmodSync(path, existingMode & 0o777);
}
