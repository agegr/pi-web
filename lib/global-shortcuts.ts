/** The subset of KeyboardEvent the global shortcut matcher reads. */
export interface ShortcutEventLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
}

export type GlobalShortcut =
  | "abort"
  | "newSession"
  | "toggleSessionSearch"
  | "openWorkspaceSelector"
  | null;

export interface MatchGlobalShortcutOptions {
  /** Whether an abort handler is registered (Esc). */
  hasAbortHandler: boolean;
  /** Whether a session search toggle is registered (Cmd/Ctrl+K). */
  hasSessionSearchHandler: boolean;
  /** Whether a workspace selector handler is registered (Cmd/Ctrl+Shift+P). */
  hasWorkspaceSelectorHandler: boolean;
  /** The active project directory. Cmd/Ctrl+J needs one to start a session. */
  activeCwd?: string | null;
}

/** True when the event originated inside the built-in terminal. */
function isTerminalTarget(target: EventTarget | null): boolean {
  const element = target as Partial<Element> | null;
  return typeof element?.closest === "function" && element.closest(".xterm") !== null;
}

/**
 * Format a shortcut for display, e.g. "⌘K" on Apple platforms and "Ctrl+K"
 * elsewhere. `platform` is any string that identifies the user's platform,
 * such as `navigator.platform` or `navigator.userAgent`.
 */
export function formatShortcutHint(
  key: string,
  platform: string,
  options: { shift?: boolean } = {},
): string {
  const apple = /mac|iphone|ipad|ipod/i.test(platform);
  const letter = key.toUpperCase();
  if (apple) return `⌘${options.shift ? "⇧" : ""}${letter}`;
  return `Ctrl+${options.shift ? "Shift+" : ""}${letter}`;
}

/**
 * Decide which global shortcut, if any, an event maps to.
 *
 *   Esc                – stop the running agent
 *   Cmd/Ctrl+J         – new session in the active project directory
 *   Cmd/Ctrl+Shift+P   – open the workspace selector
 *   Cmd/Ctrl+K         – toggle the sidebar session search
 *   Ctrl+Alt+N         – new session (kept for compatibility)
 *
 * The Cmd/Ctrl chords are ignored while the built-in terminal owns the
 * keyboard: Ctrl+J (LF) and Ctrl+K (kill line) are real readline bindings and
 * have to reach the shell.
 */
export function matchGlobalShortcut(
  event: ShortcutEventLike,
  options: MatchGlobalShortcutOptions,
): GlobalShortcut {
  const { hasAbortHandler, hasSessionSearchHandler, hasWorkspaceSelectorHandler, activeCwd } = options;

  // ---- Esc: stop agent ----
  if (event.key === "Escape") {
    if (!hasAbortHandler) return null;

    const tag = (event.target as HTMLElement | null)?.tagName;
    // Let textarea/input handle Esc internally (ChatInput menus / stop).
    if (tag === "TEXTAREA" || tag === "INPUT") return null;

    return "abort";
  }

  // ---- Ctrl+Alt+N: new session ----
  if (event.key === "n" && event.ctrlKey && event.altKey) {
    if (!activeCwd) return null;
    return "newSession";
  }

  // ---- Cmd/Ctrl+J, Cmd/Ctrl+Shift+P, Cmd/Ctrl+K ----
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (isTerminalTarget(event.target)) return null;

  const key = event.key.toLowerCase();

  // Checked before the plain chords, which reject any shifted event.
  //
  // The key is P, not J: Chrome owns Cmd+Shift+J (macOS "Open the Downloads
  // page") and Ctrl+Shift+J (DevTools console), while no Chrome shortcut takes
  // Cmd/Ctrl+Shift+P on either platform. See
  // https://support.google.com/chrome/answer/157179
  if (key === "p" && event.shiftKey) {
    // Ignore key repeats so holding the chord does not reopen the selector.
    if (!hasWorkspaceSelectorHandler || event.repeat) return null;
    return "openWorkspaceSelector";
  }

  if (event.shiftKey) return null;

  if (key === "j") {
    // Ignore key repeats so holding the chord does not spawn sessions.
    if (!activeCwd || event.repeat) return null;
    return "newSession";
  }

  if (key === "k") {
    if (!hasSessionSearchHandler) return null;
    return "toggleSessionSearch";
  }

  return null;
}
