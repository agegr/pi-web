import { spawn } from "child_process";
import { isIP } from "net";

const FILE_MANAGER_BY_PLATFORM = new Map<string, string>([
  ["win32", "explorer.exe"],
  ["darwin", "open"],
  ["linux", "xdg-open"],
]);

/** Whether the platform has a file manager command. */
export function isFileManagerSupported(platform: string): boolean {
  return FILE_MANAGER_BY_PLATFORM.has(platform);
}

/**
 * Builds the command that opens a directory in the OS file manager.
 * @param platform A Node `process.platform` value
 * @param target The directory to open
 * @returns The command and its arguments, or null on an unsupported platform
 */
export function fileManagerCommand(
  platform: string,
  target: string,
): { command: string; args: string[] } | null {
  const command = FILE_MANAGER_BY_PLATFORM.get(platform);
  return command ? { command, args: [target] } : null;
}

/**
 * Whether the request's Host header points at this machine.
 *
 * `Host` is client-controlled, so this is a usability guard rather than access
 * control: it keeps a phone or another computer on the LAN from raising a
 * window on the server. The real boundaries are the default 127.0.0.1 bind
 * (only `dev:lan` / `start:lan` listen publicly) and the caller's path
 * allow-list. A missing Host header is treated as remote.
 * @param host The Host header
 * @returns Whether it names a loopback address
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  const closingBracket = normalized.indexOf("]");
  const name = normalized.startsWith("[") && closingBracket !== -1
    ? normalized.slice(1, closingBracket)
    : normalized.split(":")[0];
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (name === "::1") return true;
  return isIP(name) === 4 && name.startsWith("127.");
}

/**
 * Opens a directory in the OS file manager.
 *
 * On macOS, `open` launches an `.app` bundle instead of showing it, so callers
 * should only pass project directories such as the explorer root.
 * @param target The directory to open (the caller checks access)
 * @param platform A Node `process.platform` value
 * @returns Resolves once the command has started
 */
export function launchFileManager(
  target: string,
  platform: string = process.platform,
): Promise<void> {
  const spec = fileManagerCommand(platform, target);
  if (!spec) return Promise.reject(new Error(`Unsupported platform: ${platform}`));
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { detached: true, stdio: "ignore" });
    // explorer.exe can exit with code 1 even on success, so only a failed spawn counts.
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
