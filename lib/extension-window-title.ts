"use client";

import { useSyncExternalStore } from "react";

/**
 * The window title an extension set with `ctx.ui.setTitle()`, per session: the
 * page shows the selected session's. The wrapper keeps the last one too
 * (`extensionTitle` in the live state), so one set before the page subscribed
 * (`session_start`) or before a reload comes back.
 */
let titles: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

export function setExtensionWindowTitle(sessionId: string, title: string | null): void {
  if ((titles.get(sessionId) ?? null) === title) return;
  const next = new Map(titles);
  if (title === null) next.delete(sessionId);
  else next.set(sessionId, title);
  titles = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const NO_TITLES: ReadonlyMap<string, string> = new Map();

export function useExtensionWindowTitle(sessionId: string | null): string | null {
  const current = useSyncExternalStore(subscribe, () => titles, () => NO_TITLES);
  return sessionId ? current.get(sessionId) ?? null : null;
}
