import { useSyncExternalStore } from "react";

export type EnterSendMode = "enter" | "ctrlEnter";

export const ENTER_SEND_MODE_STORAGE_KEY = "pi-enter-send-mode";
export const ENTER_SEND_MODE_DEFAULT: EnterSendMode = "enter";

function readStoredMode(): EnterSendMode {
  try {
    const raw = window.localStorage.getItem(ENTER_SEND_MODE_STORAGE_KEY);
    return raw === "ctrlEnter" ? "ctrlEnter" : "enter";
  } catch {
    return ENTER_SEND_MODE_DEFAULT;
  }
}

let mode: EnterSendMode | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): EnterSendMode {
  if (mode === null) mode = readStoredMode();
  return mode;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setEnterSendMode(next: EnterSendMode): void {
  mode = next;
  try {
    window.localStorage.setItem(ENTER_SEND_MODE_STORAGE_KEY, next);
  } catch {}
  listeners.forEach((listener) => listener());
}

export function useEnterSendMode(): EnterSendMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => ENTER_SEND_MODE_DEFAULT);
}
