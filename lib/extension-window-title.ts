"use client";

import { useSyncExternalStore } from "react";

/**
 * The window title an extension set with `ctx.ui.setTitle()`, for the session
 * it ran in. pi's TUI keeps it until its next own title (a session switch), so
 * the page shows it while that session is the one selected.
 */
type ExtensionWindowTitle = { sessionId: string; title: string } | null;

let current: ExtensionWindowTitle = null;
const listeners = new Set<() => void>();

export function setExtensionWindowTitle(sessionId: string, title: string): void {
  if (current?.sessionId === sessionId && current.title === title) return;
  current = { sessionId, title };
  listeners.forEach((listener) => listener());
}

/** Forgets the title unless it is `sessionId`'s: another session took the page. */
export function clearExtensionWindowTitle(keepSessionId: string | null): void {
  if (!current || current.sessionId === keepSessionId) return;
  current = null;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useExtensionWindowTitle(sessionId: string | null): string | null {
  const title = useSyncExternalStore(subscribe, () => current, () => null);
  return title && title.sessionId === sessionId ? title.title : null;
}
