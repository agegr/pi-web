import { spawn } from "child_process";
import { isIP } from "net";
import { posix } from "path";

const FILE_MANAGER_BY_PLATFORM = new Map<string, string>([
  ["win32", "explorer.exe"],
  ["darwin", "open"],
  ["linux", "xdg-open"],
]);

/** Whether the platform has a file manager command. */
export function isFileManagerSupported(platform: string): boolean {
  return FILE_MANAGER_BY_PLATFORM.has(platform);
}

/** The distro name WSL puts in the environment of every process it starts; "" off WSL. */
export function wslDistroName(env: NodeJS.ProcessEnv = process.env): string {
  return env.WSL_DISTRO_NAME?.trim() ?? "";
}

/**
 * Whose file manager answers on this platform. Inside WSL `process.platform` is
 * "linux", but `xdg-open` is usually not installed there; Windows' Explorer is,
 * through WSL's interop PATH.
 */
export function fileManagerPlatform(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return platform === "linux" && wslDistroName(env) ? "win32" : platform;
}

/**
 * The Windows name of a path inside WSL: `/mnt/c/dev` is `C:\dev`, and the
 * rest of the distro is reached through `\\wsl$\<distro>`, which Windows 10
 * and 11 both serve.
 */
export function windowsPathForWsl(posixPath: string, distro: string): string {
  const trimmed = posixPath.replace(/\/+$/, "") || "/";
  const mount = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(trimmed);
  if (mount) return `${mount[1].toUpperCase()}:\\${(mount[2] ?? "").replaceAll("/", "\\")}`;
  return `\\\\wsl$\\${distro}${trimmed === "/" ? "\\" : trimmed.replaceAll("/", "\\")}`;
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
 * Builds the command that shows an entry selected in its folder: a file
 * tree's "Show in Finder". Finder and Explorer select it; xdg-open has no
 * selection, so Linux opens the folder that holds it. Never opens the entry
 * itself, so a folder that is an `.app` bundle is shown, not launched.
 * @param platform A Node `process.platform` value
 * @param target The file or folder to show
 * @returns The command and its arguments, or null on an unsupported platform
 */
export function fileManagerRevealCommand(
  platform: string,
  target: string,
): { command: string; args: string[] } | null {
  switch (platform) {
    case "darwin":
      return { command: "open", args: ["-R", target] };
    case "win32":
      // `/select,` then the path as its own argument: quoted when it has
      // spaces, which Explorer reads there (not inside `/select,"…"` as one).
      return { command: "explorer.exe", args: ["/select,", target] };
    case "linux":
      return { command: "xdg-open", args: [posix.dirname(target)] };
    default:
      return null;
  }
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
 * Opens a directory in the OS file manager, or with `reveal` shows an entry
 * selected in its folder (fileManagerRevealCommand).
 *
 * On macOS, `open` launches an `.app` bundle instead of showing it, so callers
 * opening a directory should only pass project directories such as the
 * explorer root; anything else is revealed.
 * @param target The directory to open, or the entry to reveal (the caller checks access)
 * @param platform A Node `process.platform` value
 * @param env The environment that tells WSL apart from other Linux
 * @param reveal Show `target` selected in its folder instead of opening it
 * @returns Resolves once the command has started
 */
export function launchFileManager(
  target: string,
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  reveal = false,
): Promise<void> {
  const distro = platform === "linux" ? wslDistroName(env) : "";
  const build = reveal ? fileManagerRevealCommand : fileManagerCommand;
  const spec = distro
    ? build("win32", windowsPathForWsl(target, distro))
    : build(platform, target);
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
