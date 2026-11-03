import { useSyncExternalStore } from "react";

/** Which side of the layout hosts the sidebar. */
export type SidebarPosition = "left" | "right";

export const SIDEBAR_POSITION_STORAGE_KEY = "pi-web:sidebar-position";
export const SIDEBAR_POSITION_DEFAULT: SidebarPosition = "left";

export function parseSidebarPosition(raw: string | null): SidebarPosition {
  return raw === "right" ? "right" : SIDEBAR_POSITION_DEFAULT;
}

function readStoredPosition(): SidebarPosition {
  try {
    return parseSidebarPosition(window.localStorage.getItem(SIDEBAR_POSITION_STORAGE_KEY));
  } catch {
    return SIDEBAR_POSITION_DEFAULT;
  }
}

let position: SidebarPosition | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): SidebarPosition {
  if (position === null) position = readStoredPosition();
  return position;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

// Another tab chose; `key` is null when that tab cleared its storage.
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== SIDEBAR_POSITION_STORAGE_KEY) return;
  const next = readStoredPosition();
  if (next === position) return;
  position = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    // Nobody listened for another tab's choice meanwhile.
    position = readStoredPosition();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setSidebarPosition(next: SidebarPosition): void {
  if (next === getSnapshot()) return;
  position = next;
  try {
    window.localStorage.setItem(SIDEBAR_POSITION_STORAGE_KEY, next);
  } catch {
    // Applies in memory even if the browser cannot save it.
  }
  notify();
}

export function useSidebarPosition(): SidebarPosition {
  return useSyncExternalStore(subscribe, getSnapshot, () => SIDEBAR_POSITION_DEFAULT);
}
