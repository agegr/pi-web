import { dirname } from "path";

/** Platform command that opens a folder in the OS file manager. */
export interface OpenFolderCommand {
  command: string;
  args: string[];
}

/**
 * Build the launch command for opening `target` in the platform's file
 * manager (Windows Explorer / macOS Finder / xdg-open). The target is passed
 * through untouched as a single argument — callers hand in an already
 * `resolve()`d absolute path, and spawning without a shell keeps spaces and
 * metacharacters inert.
 */
export function openFolderCommand(
  target: string,
  platform: NodeJS.Platform = process.platform,
): OpenFolderCommand {
  if (platform === "win32") return { command: "explorer.exe", args: [target] };
  if (platform === "darwin") return { command: "open", args: [target] };
  return { command: "xdg-open", args: [target] };
}

/**
 * Build the launch command that reveals a file inside its parent folder in the
 * platform's file manager. Windows Explorer selects the entry with
 * `/select,<path>` (a single argument — Explorer splits on the first comma),
 * Finder uses `open -R`. xdg-open has no portable "select this entry" flag, so
 * the containing folder is opened instead.
 */
export function revealFileCommand(
  target: string,
  platform: NodeJS.Platform = process.platform,
): OpenFolderCommand {
  if (platform === "win32") return { command: "explorer.exe", args: [`/select,${target}`] };
  if (platform === "darwin") return { command: "open", args: ["-R", target] };
  return { command: "xdg-open", args: [dirname(target)] };
}

/**
 * True when a request's host points at this machine's loopback interface.
 *
 * Opening a window is a desktop action, so a phone or another computer on the
 * LAN must not raise windows on the host. `Host` is client-controlled, which
 * makes this a usability guard rather than access control — the real
 * boundaries stay the loopback bind and the file-access allow-list.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let hostname = host.trim().toLowerCase();

  // An IPv6 literal keeps its brackets while a port is present: [::1]:30141.
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    if (end === -1) return false;
    hostname = hostname.slice(1, end);
  } else if ((hostname.match(/:/g) ?? []).length === 1) {
    // One colon means host:port. An unbracketed IPv6 literal has more, and its
    // last group must not be mistaken for a port.
    hostname = hostname.replace(/:\d+$/, "");
  }

  return hostname === "localhost"
    || hostname === "::1"
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}
