import { useSyncExternalStore } from "react";

/**
 * A choice kept per browser in localStorage under `key`, which every
 * component and every tab shares: a change is saved and announced, another
 * tab's change (or its cleared storage) is followed, and the server renders
 * `fallback`. Blocked storage leaves `fallback`, and a choice still applies
 * for the page.
 */
export function createStoredChoice<T extends string>(key: string, parse: (raw: string | null) => T, fallback: T) {
  let value: T | null = null;
  // The browser refused the last choice: storage holds an older one, so it must not replace the page's.
  let unsaved = false;
  const listeners = new Set<() => void>();

  function readStored(): T {
    try {
      return parse(window.localStorage.getItem(key));
    } catch {
      return fallback;
    }
  }

  function getSnapshot(): T {
    if (value === null) value = readStored();
    return value;
  }

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  // Another tab chose; `key` is null when that tab cleared its storage.
  function onStorage(event: StorageEvent): void {
    if (event.key !== null && event.key !== key) return;
    unsaved = false;
    const next = readStored();
    if (next === value) return;
    value = next;
    notify();
  }

  function subscribe(listener: () => void): () => void {
    if (listeners.size === 0) {
      window.addEventListener("storage", onStorage);
      // Nobody listened for another tab's choice meanwhile.
      if (!unsaved) value = readStored();
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
  }

  function set(next: T): void {
    if (next === getSnapshot()) return;
    value = next;
    try {
      window.localStorage.setItem(key, next);
      unsaved = false;
    } catch {
      // Applies in memory even if the browser cannot save it.
      unsaved = true;
    }
    notify();
  }

  function use(): T {
    return useSyncExternalStore(subscribe, getSnapshot, () => fallback);
  }

  return { use, set };
}
