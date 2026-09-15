import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * The feature relies on Windows' `shutdown /s /t <seconds>` timer, which has no
 * direct equivalent on other platforms. Gate it so non-Windows servers never
 * surface a button that cannot work.
 */
export function isShutdownSupported(): boolean {
  return process.platform === "win32";
}

function assertSupported(): void {
  if (!isShutdownSupported()) {
    throw new Error(`shutdown is only supported on Windows (current platform: ${process.platform})`);
  }
}

/**
 * Windows-only: arm the OS shutdown timer so the machine powers off `seconds`
 * from now. Arguments are passed as an array so nothing ever reaches a shell.
 */
export async function runShutdownStart(seconds: number): Promise<void> {
  assertSupported();
  await execFileAsync("shutdown", ["/s", "/t", String(seconds)]);
}

/**
 * Windows-only: abort a shutdown timer that is still pending in the OS.
 * `shutdown /a` exits non-zero when no shutdown is pending, so callers must
 * treat a rejection as "unknown", not as "already cancelled".
 */
export async function runShutdownCancel(): Promise<void> {
  assertSupported();
  await execFileAsync("shutdown", ["/a"]);
}
