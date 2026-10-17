"use client";

import { useSyncExternalStore } from "react";
import {
  bindingKeysFor,
  keybindingsSignature,
  keysFromSignature,
  sanitizeKeybindingsConfig,
  WEB_KEYBINDINGS,
  type KeybindingsConfig,
  type WebKeybinding,
} from "../lib/keybindings-config";

// The user's pi keybindings, read once per page and shared by every consumer.
// The file is pi's (`~/.pi/agent/keybindings.json`), so a shortcut rebound for
// the terminal is rebound here too; Pi Web adds no shortcut file of its own.

export { bindingKeysFor, keybindingsSignature, keysFromSignature, WEB_KEYBINDINGS };
export type { KeybindingsConfig, WebKeybinding };

interface Snapshot {
  /** The file's entries; empty until it answers, and when it is missing. */
  config: KeybindingsConfig;
  /** True once the file has answered, successfully or not. */
  loaded: boolean;
}

let snapshot: Snapshot = { config: {}, loaded: false };
const listeners = new Set<() => void>();
let request: Promise<void> | null = null;

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Reads the file once; a later call reuses the same request. */
export function loadKeybindings(): Promise<void> {
  if (request) return request;
  request = fetch("/api/keybindings", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { bindings?: unknown };
      snapshot = { config: sanitizeKeybindingsConfig(data.bindings), loaded: true };
    })
    .catch(() => {
      // A missing or unreadable file leaves the defaults in place.
      snapshot = { config: {}, loaded: true };
    })
    .finally(() => { emit(); });
  return request;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

const EMPTY: Snapshot = { config: {}, loaded: true };

/** The keybindings file, for reading one binding's keys. */
export function useKeybindings(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
