import { spawn } from "child_process";
import { isIP } from "net";
import { pathToFileURL } from "url";

const FILE_MANAGER_BY_PLATFORM = new Map<string, string>([
  ["win32", "explorer.exe"],
  ["darwin", "open"],
  ["linux", "xdg-open"],
]);

/** How many times the Windows helper looks for the folder window before giving up. */
const FOCUS_POLL_ATTEMPTS = 25;
/** Wait between those attempts, so the helper lasts about three seconds. */
const FOCUS_POLL_INTERVAL_MS = 120;
/**
 * How long the folder window stays topmost before the topmost flag is dropped.
 *
 * Windows keeps the active window above the rest of its band, so the window has
 * to pass through the topmost band to land in front of the other applications.
 * Measured on Windows 11: every gap from 0 ms to 200 ms leaves the window above
 * all normal windows, so this is only slack for a slower machine, and keeping it
 * short keeps the one way this can misbehave harmless. If the helper is killed
 * inside this window the window stays pinned until it is closed or unticked in
 * the Explorer's context menu.
 */
const FOCUS_TOPMOST_MS = 30;

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
 * Folds a location the way the Windows helper compares it.
 *
 * Explorer's `LocationURL` and `pathToFileURL()` disagree on escaping and on the
 * trailing slash, so both sides are percent-decoded, case-folded, and stripped
 * of trailing separators before they are compared.
 * @param url A `file:` URL
 * @returns The comparable form
 */
export function normalizeExplorerLocationUrl(url: string): string {
  let decoded = url.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // A path that is not valid percent-encoding can only be compared as-is.
  }
  return decoded.replace(/\/+$/, "").toLowerCase();
}

/**
 * Builds the PowerShell helper that raises the Explorer window for a directory.
 *
 * `explorer.exe` reuses an existing window when one already shows the folder and
 * otherwise opens one, but it does not bring that window in front of the other
 * applications the user already has open, so the folder lands behind them. The
 * helper walks the shell's own window list until the folder shows up (Explorer
 * creates it asynchronously, after this command would have returned) and then
 * restores and raises it.
 * @param target The directory whose window should come forward
 * @returns The PowerShell script to run
 */
export function windowsFocusScript(target: string): string {
  // Single-quoted PowerShell strings only end at a doubled quote, and never
  // interpolate, so any character a path can contain survives this.
  const expected = normalizeExplorerLocationUrl(pathToFileURL(target).href).replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$expected = '${expected}'`,
    "$member = @'",
    '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    "'@",
    "if (-not ('PiWeb.WindowFocus' -as [type])) {",
    "  Add-Type -Namespace 'PiWeb' -Name 'WindowFocus' -MemberDefinition $member | Out-Null",
    "}",
    "$shell = New-Object -ComObject Shell.Application",
    `for ($attempt = 0; $attempt -lt ${FOCUS_POLL_ATTEMPTS}; $attempt++) {`,
    "  $window = $null",
    "  foreach ($candidate in $shell.Windows()) {",
    "    $url = $candidate.LocationURL",
    "    if (-not $url) { continue }",
    "    try { $url = [Uri]::UnescapeDataString($url) } catch { }",
    "    if ($url.TrimEnd('/').ToLowerInvariant() -eq $expected) { $window = $candidate; break }",
    "  }",
    "  if ($window) {",
    "    $window.Visible = $true",
    "    $hwnd = $window.HWND",
    "    if ($hwnd -ne [IntPtr]::Zero) {",
    // Explorer is still finishing with the window it just opened, and a minimized
    // window has to come back before anything can be done to its z-order.
    "      [PiWeb.WindowFocus]::ShowWindow($hwnd, 9) | Out-Null",
    "      Start-Sleep -Milliseconds 100",
    // Moving a window in the z-order is something Windows lets any process do,
    // unlike taking the foreground, so the window goes in front for good instead
    // of only flashing up behind whatever else the user has open. HWND_TOP on
    // its own does not get there: Windows draws the active window above the
    // other windows in its band, so an inactive Explorer window stays hidden
    // behind the app the user clicked in. The momentary topmost state is what
    // carries it past that, and dropping it right afterwards keeps the folder
    // from being pinned above everything for the rest of the session.
    "      [PiWeb.WindowFocus]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x43) | Out-Null",
    `      Start-Sleep -Milliseconds ${FOCUS_TOPMOST_MS}`,
    "      [PiWeb.WindowFocus]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, 0x53) | Out-Null",
    // Keyboard focus follows only when this process is allowed to claim it,
    // which for a server started from a browser usually it is not. The raised
    // window above is the part the user can rely on either way.
    "      [PiWeb.WindowFocus]::SetForegroundWindow($hwnd) | Out-Null",
    "    }",
    "    exit 0",
    "  }",
    `  Start-Sleep -Milliseconds ${FOCUS_POLL_INTERVAL_MS}`,
    "}",
    "exit 1",
  ].join("\n");
}

/**
 * Builds the command that raises an already-opened file-manager window.
 * @param platform A Node `process.platform` value
 * @param target The directory whose window should come forward
 * @returns The command and its arguments, or null where the launcher already
 *   activates the window itself
 */
export function fileManagerFocusCommand(
  platform: string,
  target: string,
): { command: string; args: string[] } | null {
  // `open` activates Finder and desktop file managers activate their own
  // windows, so only Explorer needs the extra step.
  if (platform !== "win32") return null;
  // -EncodedCommand keeps the script out of the argument quoting rules, and
  // -WindowStyle Hidden avoids a console flash for a background raise.
  // -ExecutionPolicy Bypass overrides a stricter execution preference set on
  // the box itself (CurrentUser/LocalMachine), e.g. a machine left on
  // Restricted or AllSigned: measured, the helper also runs without it on a
  // default box, because Restricted only stops script files. It is not a
  // skeleton key: a Group Policy lockdown (MachinePolicy/UserPolicy) or
  // ConstrainedLanguage still wins, and then the helper dies quietly with the
  // window merely opened, which the SilentlyContinue at the top guarantees.
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(windowsFocusScript(target), "utf16le").toString("base64"),
    ],
  };
}

/**
 * Whether an opened file-manager window should be brought to the front.
 *
 * The user asked for this by clicking the button, but it is still the one part
 * of the flow that reaches past the app they clicked in, so
 * `PI_WEB_FILE_MANAGER_FOCUS=0` turns it off.
 * @param platform A Node `process.platform` value
 * @param env The environment to read the switch from
 * @returns Whether to raise the window
 */
export function shouldFocusFileManager(
  platform: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.PI_WEB_FILE_MANAGER_FOCUS?.trim().toLowerCase();
  if (override === "0" || override === "false" || override === "no") return false;
  return FILE_MANAGER_BY_PLATFORM.get(platform) === "explorer.exe";
}

/**
 * Starts the helper that raises the file-manager window, if that needs help.
 *
 * Best effort by design: the folder is already open by the time this runs, so a
 * missing PowerShell or a window that never appears must not fail the request
 * the folder was opened for.
 * @param target The directory whose window should come forward
 * @param platform A Node `process.platform` value
 */
export function focusFileManagerWindow(
  target: string,
  platform: string = process.platform,
): void {
  const spec = fileManagerFocusCommand(platform, target);
  if (!spec) return;
  try {
    // Not `detached`: a PowerShell started with DETACHED_PROCESS has no console
    // and leaves immediately, which is how this helper used to die before it
    // found the window. `unref` is what keeps the request from waiting on it.
    const child = spawn(spec.command, spec.args, { stdio: "ignore", windowsHide: true });
    child.once("error", () => {});
    child.once("spawn", () => child.unref());
  } catch {
    // Raising the window is an extra, never a requirement.
  }
}

/**
 * Opens a directory in the OS file manager.
 *
 * On macOS, `open` launches an `.app` bundle instead of showing it, so callers
 * should only pass project directories such as the explorer root. The window is
 * raised in the background, so this still resolves as soon as the file manager
 * has started rather than waiting for the raise to finish.
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
      if (shouldFocusFileManager(platform)) focusFileManagerWindow(target, platform);
      resolve();
    });
  });
}