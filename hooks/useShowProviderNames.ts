import { useSyncExternalStore } from "react";

/** Whether chat messages prefix the model name with its provider's display name. Per browser. */
export const SHOW_PROVIDER_NAMES_STORAGE_KEY = "pi-web:show-provider-names";
export const SHOW_PROVIDER_NAMES_DEFAULT = false;

export function parseShowProviderNames(raw: string | null): boolean {
  return raw === "true";
}

function readStoredChoice(): boolean {
  try {
    return parseShowProviderNames(window.localStorage.getItem(SHOW_PROVIDER_NAMES_STORAGE_KEY));
  } catch {
    return SHOW_PROVIDER_NAMES_DEFAULT;
  }
}

let showProviderNames: boolean | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): boolean {
  if (showProviderNames === null) showProviderNames = readStoredChoice();
  return showProviderNames;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

// Another tab chose; `key` is null when that tab cleared its storage.
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== SHOW_PROVIDER_NAMES_STORAGE_KEY) return;
  const next = readStoredChoice();
  if (next === showProviderNames) return;
  showProviderNames = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    // Nobody listened for another tab's choice meanwhile.
    showProviderNames = readStoredChoice();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setShowProviderNames(next: boolean): void {
  if (next === getSnapshot()) return;
  showProviderNames = next;
  try {
    window.localStorage.setItem(SHOW_PROVIDER_NAMES_STORAGE_KEY, String(next));
  } catch {
    // Applies in memory even if the browser cannot save it.
  }
  notify();
}

export function useShowProviderNames(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => SHOW_PROVIDER_NAMES_DEFAULT);
}
