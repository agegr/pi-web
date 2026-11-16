"use client";

import { useEffect, useState } from "react";
import type { InstalledFontInfo, InstalledFontsResponse } from "@/lib/api-types";

/**
 * The host's font families, fetched once per page load and shared by both
 * typography fields. Only requested when a picker opens: settings the user
 * never touches cost no request.
 */

let cache: InstalledFontInfo[] | null = null;
let pending: Promise<InstalledFontInfo[]> | null = null;

function isInstalledFont(value: unknown): value is InstalledFontInfo {
  if (!value || typeof value !== "object") return false;
  const font = value as Partial<InstalledFontInfo>;
  return typeof font.family === "string" && font.family.length > 0;
}

export function loadInstalledFonts(): Promise<InstalledFontInfo[]> {
  if (cache) return Promise.resolve(cache);
  pending ??= fetch("/api/fonts")
    .then(async (response) => {
      if (!response.ok) throw new Error(`fonts ${response.status}`);
      const body = await response.json() as Partial<InstalledFontsResponse>;
      const fonts = (Array.isArray(body.fonts) ? body.fonts : []).filter(isInstalledFont).map((font) => ({
        family: font.family,
        aliases: Array.isArray(font.aliases) ? font.aliases.filter((alias) => typeof alias === "string") : [],
        monospace: font.monospace === true,
      }));
      cache = fonts;
      return fonts;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Drops the shared list so the next picker retries after a failed read. */
export function resetInstalledFonts(): void {
  cache = null;
  pending = null;
}

export function useInstalledFonts(enabled: boolean): { fonts: InstalledFontInfo[] | null; failed: boolean } {
  const [state, setState] = useState<{ fonts: InstalledFontInfo[] | null; failed: boolean }>(() => ({ fonts: cache, failed: false }));

  useEffect(() => {
    // A cache that arrived after this field mounted is picked up by the click
    // that opens the picker, which renders from the shared list.
    if (!enabled || state.fonts) return;
    let cancelled = false;
    loadInstalledFonts()
      .then((fonts) => {
        if (!cancelled) setState({ fonts, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ fonts: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, state.fonts]);

  return state;
}
