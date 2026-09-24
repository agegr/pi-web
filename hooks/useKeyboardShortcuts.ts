"use client";

import { useEffect } from "react";
import { matchGlobalShortcut } from "@/lib/global-shortcuts";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Module-level registry — SessionSidebar owns the search panel state, so it
// registers the toggle here for the global Cmd/Ctrl+K shortcut.
// ---------------------------------------------------------------------------
let globalSessionSearchHandler: (() => void) | null = null;

/**
 * Register (or clear) the session search toggle for the global Cmd/Ctrl+K
 * shortcut. Call this from SessionSidebar whenever the toggle changes.
 */
export function registerSessionSearchHandler(handler: (() => void) | null): void {
  globalSessionSearchHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N or Cmd/Ctrl+J is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the running agent (via module-level abort handler)
 *   Cmd/Ctrl+J   – create a new session in the active project directory
 *   Cmd/Ctrl+K   – toggle the sidebar session search
 *   Ctrl+Alt+N   – create a new session in the active project directory
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component.
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const shortcut = matchGlobalShortcut(e, {
        hasAbortHandler: globalAbortHandler !== null,
        hasSessionSearchHandler: globalSessionSearchHandler !== null,
        activeCwd,
      });

      if (shortcut === "abort") {
        e.preventDefault();
        globalAbortHandler?.();
        return;
      }

      if (shortcut === "newSession") {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
        return;
      }

      if (shortcut === "toggleSessionSearch") {
        e.preventDefault();
        globalSessionSearchHandler?.();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, onNewSession]);
}
