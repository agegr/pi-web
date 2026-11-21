import { randomUUID } from "crypto";
import { chmodSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

/**
 * Replace a file atomically: the bytes land in a sibling temp file that is then
 * renamed onto the destination, so a process killed mid-write leaves the old
 * file whole. The caller must create the parent directory first.
 */
function writeFileAtomicSync(path: string, contents: string, mode: number, exactMode = false): void {
  const dir = dirname(path);
  const tempPath = join(dir, `.${basename(path)}-${randomUUID()}.tmp`);
  let operationFailed = false;

  try {
    // `wx`: nothing already at the temporary path is written through. An exact mode is set
    // by chmod after the bytes are written at 0600, so text that may hold secrets is never
    // readable by others meanwhile; otherwise `mode` passes through the umask.
    writeFileSync(tempPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: exactMode ? 0o600 : mode,
      flush: true,
    });
    if (exactMode) chmodSync(tempPath, mode);
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
  // A symlinked session file keeps its link: the bytes replace the file it points at.
  let target = path;
  try { target = realpathSync(path); } catch { /* a new file */ }
  const existingMode = statSync(target, { throwIfNoEntry: false })?.mode;
  if (existingMode === undefined) writeFileAtomicSync(target, contents, 0o644);
  else writeFileAtomicSync(target, contents, existingMode & 0o777, true);
}

/**
 * Replace a file atomically and give it exactly `mode`, whatever the umask.
 * The caller must create the parent directory first.
 */
export function writeFileExactModeAtomicSync(path: string, contents: string, mode: number): void {
  writeFileAtomicSync(path, contents, mode, true);
}
