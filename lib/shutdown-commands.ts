import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Windows-only: arm the OS shutdown timer so the machine powers off `seconds`
 * from now. Arguments are passed as an array so nothing ever reaches a shell.
 */
export async function runShutdownStart(seconds: number): Promise<void> {
  await execFileAsync("shutdown", ["/s", "/t", String(seconds)]);
}

/**
 * Windows-only: abort a shutdown timer that is still pending in the OS.
 * `shutdown /a` exits non-zero when no shutdown is pending, so callers must
 * treat a rejection as "unknown", not as "already cancelled".
 */
export async function runShutdownCancel(): Promise<void> {
  await execFileAsync("shutdown", ["/a"]);
}
