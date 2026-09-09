"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "pi-display-name";
const DEFAULT_DISPLAY_NAME = "Seb";
const SERVER_SNAPSHOT = DEFAULT_DISPLAY_NAME;
const listeners = new Set<() => void>();

function readStoredDisplayName(): string {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)?.trim();
    return value || DEFAULT_DISPLAY_NAME;
  } catch {
    return DEFAULT_DISPLAY_NAME;
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useDisplayName(): [string, (name: string) => void] {
  const displayName = useSyncExternalStore(subscribe, readStoredDisplayName, () => SERVER_SNAPSHOT);
  const setDisplayName = useCallback((name: string) => {
    const next = name.trim() || DEFAULT_DISPLAY_NAME;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep the current UI usable when browser storage is unavailable.
    }
    emit();
  }, []);
  return [displayName, setDisplayName];
}

export { DEFAULT_DISPLAY_NAME };
