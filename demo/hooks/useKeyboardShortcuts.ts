"use client";

import { useEffect } from "react";
import { matchesKeyId } from "@/lib/key-id";
import { bindingKeysFor, keybindingsSignature, keysFromSignature } from "@/lib/keybindings-config";
import { loadKeybindings, useKeybindings, WEB_KEYBINDINGS } from "./useKeybindings";
import { handleGlobalEscape, registerAbortHandler } from "@/lib/global-escape";

export { handleGlobalEscape, registerAbortHandler };

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the running agent (via module-level abort handler)
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
  // AppShell mounts this once per page, so it is where the file is read.
  useEffect(() => { void loadKeybindings(); }, []);
  const keybindings = useKeybindings();
  const newSessionKeys = bindingKeysFor(keybindings.config, WEB_KEYBINDINGS.newSession);
  const newSessionKeysId = keybindingsSignature(newSessionKeys);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        handleGlobalEscape(e);
        return;
      }
      if (matchesKeyId(e, keysFromSignature(newSessionKeysId))) {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, newSessionKeysId, onNewSession]);
}
