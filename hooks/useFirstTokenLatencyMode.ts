import { useSyncExternalStore } from "react";

export type FirstTokenLatencyMode = "ttft" | "ttfa" | "off";

export const FIRST_TOKEN_LATENCY_STORAGE_KEY = "pi-web:first-token-latency";
export const FIRST_TOKEN_LATENCY_DEFAULT: FirstTokenLatencyMode = "ttft";

export function parseFirstTokenLatencyMode(raw: string | null): FirstTokenLatencyMode {
  return raw === "ttfa" || raw === "off" ? raw : FIRST_TOKEN_LATENCY_DEFAULT;
}

function readStoredMode(): FirstTokenLatencyMode {
  try {
    return parseFirstTokenLatencyMode(window.localStorage.getItem(FIRST_TOKEN_LATENCY_STORAGE_KEY));
  } catch {
    return FIRST_TOKEN_LATENCY_DEFAULT;
  }
}

let mode: FirstTokenLatencyMode | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): FirstTokenLatencyMode {
  if (mode === null) mode = readStoredMode();
  return mode;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

// Another tab chose; `key` is null when that tab cleared its storage.
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== FIRST_TOKEN_LATENCY_STORAGE_KEY) return;
  const next = readStoredMode();
  if (next === mode) return;
  mode = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    // Nobody listened for another tab's choice meanwhile.
    mode = readStoredMode();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function setFirstTokenLatencyMode(next: FirstTokenLatencyMode): void {
  if (next === getSnapshot()) return;
  mode = next;
  try {
    window.localStorage.setItem(FIRST_TOKEN_LATENCY_STORAGE_KEY, next);
  } catch {
    // Applies in memory even if the browser cannot save it.
  }
  notify();
}

export function resetFirstTokenLatencyModeForTests(): void {
  mode = null;
}

export function useFirstTokenLatencyMode(): FirstTokenLatencyMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => mode ?? FIRST_TOKEN_LATENCY_DEFAULT);
}
