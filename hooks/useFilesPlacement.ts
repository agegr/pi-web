import { useSyncExternalStore } from "react";

/** Where the desktop sidebar shows the file browser: under the sessions, or behind its own tab. Phones always use tabs. */
export type FilesPlacement = "below" | "tab";

export const FILES_PLACEMENT_STORAGE_KEY = "pi-web:sidebar-files-placement";
export const FILES_PLACEMENT_DEFAULT: FilesPlacement = "below";

export function parseFilesPlacement(raw: string | null): FilesPlacement {
  return raw === "tab" ? "tab" : FILES_PLACEMENT_DEFAULT;
}

function readStoredPlacement(): FilesPlacement {
  try {
    return parseFilesPlacement(window.localStorage.getItem(FILES_PLACEMENT_STORAGE_KEY));
  } catch {
    return FILES_PLACEMENT_DEFAULT;
  }
}

let placement: FilesPlacement | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): FilesPlacement {
  if (placement === null) placement = readStoredPlacement();
  return placement;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

// Another tab chose; `key` is null when that tab cleared its storage.
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== FILES_PLACEMENT_STORAGE_KEY) return;
  const next = readStoredPlacement();
  if (next === placement) return;
  placement = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    // Nobody listened for another tab's choice meanwhile.
    placement = readStoredPlacement();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setFilesPlacement(next: FilesPlacement): void {
  if (next === getSnapshot()) return;
  placement = next;
  try {
    window.localStorage.setItem(FILES_PLACEMENT_STORAGE_KEY, next);
  } catch {
    // Applies in memory even if the browser cannot save it.
  }
  notify();
}

export function useFilesPlacement(): FilesPlacement {
  return useSyncExternalStore(subscribe, getSnapshot, () => FILES_PLACEMENT_DEFAULT);
}
