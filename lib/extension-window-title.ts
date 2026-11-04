"use client";

import { useSyncExternalStore } from "react";

/**
 * The window title an extension set with `ctx.ui.setTitle()`, per session: the
 * page shows the selected session's. The wrapper keeps the last one too
 * (`extensionTitle` in the live state), so one set before the page subscribed
 * (`session_start`) or before a reload comes back.
 */
const titles = new Map<string, string>();
const listeners = new Set<() => void>();

export function setExtensionWindowTitle(sessionId: string, title: string | null): void {
  if ((titles.get(sessionId) ?? null) === title) return;
  if (title === null) titles.delete(sessionId);
  else titles.set(sessionId, title);
  listeners.forEach((listener) => listener());
}

export function getExtensionWindowTitle(sessionId: string | null): string | null {
  return sessionId ? titles.get(sessionId) ?? null : null;
}

export function subscribeExtensionWindowTitles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getServerSnapshot = () => null;

/**
 * One session's title. The snapshot is that string, not the map, so another
 * session's title or the same one set again renders nothing: an extension may
 * set it several times a second (pi's titlebar-spinner, every 80 ms).
 */
export function useExtensionWindowTitle(sessionId: string | null): string | null {
  return useSyncExternalStore(
    subscribeExtensionWindowTitles,
    () => getExtensionWindowTitle(sessionId),
    getServerSnapshot,
  );
}
