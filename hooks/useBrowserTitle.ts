"use client";

import { useCallback, useSyncExternalStore } from "react";

export type BrowserTitleMode = "session" | "workspace";

const STORAGE_KEY = "pi-browser-title";
const SERVER_SNAPSHOT: BrowserTitleMode = "session";

const listeners = new Set<() => void>();
let state: BrowserTitleMode | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readStoredMode(): BrowserTitleMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "session" || value === "workspace") return value;
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  return "session";
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useBrowserTitleMode() {
  const mode = useSyncExternalStore(
    subscribe,
    () => {
      if (!isBrowser()) return SERVER_SNAPSHOT;
      if (!state) state = readStoredMode();
      return state;
    },
    () => SERVER_SNAPSHOT,
  );

  const setBrowserTitleMode = useCallback((nextMode: BrowserTitleMode) => {
    if (state === nextMode) return;
    state = nextMode;
    try {
      localStorage.setItem(STORAGE_KEY, nextMode);
    } catch {
      // Browser storage is best-effort.
    }
    emit();
  }, []);

  return { browserTitleMode: mode, setBrowserTitleMode };
}
