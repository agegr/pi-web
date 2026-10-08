"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_FONT_PREFERENCES,
  FONT_STORAGE_KEYS,
  FONT_WEIGHT_DEFAULT,
  fontFamilyOverride,
  readFontPreference,
  readFontWeight,
  type FontKind,
  type FontPreferences,
} from "@/lib/font-preferences";

const FONT_KINDS: FontKind[] = ["ui", "mono"];
const PREFERENCE_KEYS = Object.keys(FONT_STORAGE_KEYS) as (keyof FontPreferences)[];
let preferences: FontPreferences | null = null;
const listeners = new Set<() => void>();

function readStoredPreferences(): FontPreferences {
  const next = { ...DEFAULT_FONT_PREFERENCES };
  for (const kind of FONT_KINDS) {
    try {
      next[kind] = readFontPreference(window.localStorage.getItem(FONT_STORAGE_KEYS[kind]));
      const weightKey = `${kind}Weight` as const;
      next[weightKey] = readFontWeight(window.localStorage.getItem(FONT_STORAGE_KEYS[weightKey]));
    } catch {
      // Browser preferences remain usable when storage is blocked.
    }
  }
  return next;
}

function applyPreferences(next: FontPreferences): void {
  for (const kind of FONT_KINDS) {
    const property = `--font-${kind}`;
    const value = fontFamilyOverride(kind, next[kind]);
    if (value) document.documentElement.style.setProperty(property, value);
    else document.documentElement.style.removeProperty(property);
    const weight = next[`${kind}Weight`];
    if (weight === FONT_WEIGHT_DEFAULT) document.documentElement.style.removeProperty(`${property}-weight`);
    else document.documentElement.style.setProperty(`${property}-weight`, String(weight));
  }
}

function getSnapshot(): FontPreferences {
  if (typeof window === "undefined") return DEFAULT_FONT_PREFERENCES;
  if (!preferences) {
    preferences = readStoredPreferences();
    applyPreferences(preferences);
  }
  return preferences;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && !Object.values(FONT_STORAGE_KEYS).includes(event.key)) return;
  const next = readStoredPreferences();
  const current = getSnapshot();
  if (PREFERENCE_KEYS.every((key) => next[key] === current[key])) return;
  preferences = next;
  applyPreferences(next);
  notify();
}

/** Also used by the terminal: changing a font must not recreate its shell or stream. */
export function subscribeFontPreferences(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  getSnapshot();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function setPreferences(next: FontPreferences): void {
  const current = getSnapshot();
  const changedKeys = PREFERENCE_KEYS.filter((key) => current[key] !== next[key]);
  if (!changedKeys.length) return;
  preferences = next;
  applyPreferences(next);
  for (const key of changedKeys) {
    try {
      if (next[key] === DEFAULT_FONT_PREFERENCES[key]) window.localStorage.removeItem(FONT_STORAGE_KEYS[key]);
      else window.localStorage.setItem(FONT_STORAGE_KEYS[key], String(next[key]));
    } catch {
      // Apply in memory even if the browser cannot save the preference.
    }
  }
  notify();
}

export function setFontPreference(kind: FontKind, value: string): void {
  setPreferences({ ...getSnapshot(), [kind]: readFontPreference(value) });
}

export function setFontWeight(kind: FontKind, value: number): void {
  setPreferences({ ...getSnapshot(), [`${kind}Weight`]: readFontWeight(value) });
}

/** Reset this font's family and weight together, leaving the other font unchanged. */
export function resetFontPreference(kind: FontKind): void {
  setPreferences({ ...getSnapshot(), [kind]: "", [`${kind}Weight`]: FONT_WEIGHT_DEFAULT });
}

export function useFontPreferences() {
  const snapshot = useSyncExternalStore(subscribeFontPreferences, getSnapshot, () => DEFAULT_FONT_PREFERENCES);
  return { ...snapshot, setFontPreference, setFontWeight, resetFontPreference };
}
