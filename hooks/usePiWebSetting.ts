"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  ensurePiWebSettingsLoaded,
  getPiWebSettingsError,
  getPiWebSettingsServerSnapshot,
  getPiWebSettingsSnapshot,
  refreshPiWebSettings,
  subscribePiWebSettings,
} from "@/lib/pi-web-settings-store";
import type { PiWebSettings, PiWebSettingsKey } from "@/lib/pi-web-settings-shared";

/**
 * One server-held preference (`pi-web-settings.json`), loaded on the first use
 * and again whenever the page comes back into view. Before the read lands it is
 * the server's default, which is what a server render shows too.
 */
export function usePiWebSetting<K extends PiWebSettingsKey>(key: K): PiWebSettings[K] {
  usePiWebSettingsLoading();
  return useSyncExternalStore(
    subscribePiWebSettings,
    () => getPiWebSettingsSnapshot()[key],
    () => getPiWebSettingsServerSnapshot()[key],
  );
}

/** Every setting at once (the settings panel's switches). */
export function usePiWebSettings(): PiWebSettings {
  usePiWebSettingsLoading();
  return useSyncExternalStore(subscribePiWebSettings, getPiWebSettingsSnapshot, getPiWebSettingsServerSnapshot);
}

/** The last failed read or write, shown beside the switches. */
export function usePiWebSettingsError(): string | null {
  usePiWebSettingsLoading();
  return useSyncExternalStore(subscribePiWebSettings, getPiWebSettingsError, () => null);
}

/** Loads the settings (once) and re-reads them when the page is shown again. */
function usePiWebSettingsLoading(): void {
  useEffect(() => {
    void ensurePiWebSettingsLoaded();
    // Another tab, browser or device may have changed one meanwhile: a tab
    // brought back into view reads again. Same-document visibility only; the
    // read is one small GET.
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshPiWebSettings();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}
