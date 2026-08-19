/**
 * Palette metadata + storage for the multi-palette theme system.
 *
 * The authoritative palette data (full semantic token maps) lives in
 * lib/theme-palettes.ts. This module derives the picker-side metadata
 * (label / group / descriptor / preview swatch) from it, and owns the
 * localStorage persistence + DOM application for the active palette.
 *
 * Persistence contract (backward compatible):
 *   - `pi-theme`      -> "light" | "dark" | "auto"   (appearance, useTheme.ts)
 *   - `pi-web-palette`-> palette id (this module)
 */

import {
  PALETTE_DEFS,
  type PaletteId,
} from "./theme-palettes.ts";

export type { PaletteId } from "./theme-palettes";

export type PaletteGroup = "signature" | "dark" | "light" | "special";

export interface PaletteMeta {
  id: PaletteId;
  label: string;
  group: PaletteGroup;
  descriptor: string;
  /** Preview swatches: [bg, surface, accent, text] from the real theme. */
  swatch: [string, string, string, string];
  /** Whether the palette's default appearance is light. */
  isLight: boolean;
}

export const PALETTE_STORAGE_KEY = "pi-web-palette";

/** Legacy ids that collapsed into newer palettes. */
const LEGACY_ALIASES: Record<string, PaletteId> = {
  "solarized-dark": "solarized",
  "solarized-light": "solarized",
};

function paletteSwatch(id: PaletteId): [string, string, string, string] {
  const def = PALETTE_DEFS[id];
  const mode = def.defaultMode;
  const t = def.tokens[mode];
  return [t.bg, t["bg-panel"], t.accent, t.text] as [string, string, string, string];
}

function defaultGroup(id: PaletteId): PaletteGroup {
  const def = PALETTE_DEFS[id];
  if (id === "pi") return "signature";
  if (def.defaultMode === "light") return "light";
  return "dark";
}

export const PALETTES: PaletteMeta[] = (Object.keys(PALETTE_DEFS) as PaletteId[]).map((id) => {
  const def = PALETTE_DEFS[id];
  return {
    id,
    label: def.label,
    group: def.group ?? defaultGroup(id),
    descriptor: def.descriptor,
    swatch: paletteSwatch(id),
    isLight: def.defaultMode === "light",
  };
});

export const VALID_PALETTE_IDS = new Set<string>(
  PALETTES.map((p) => p.id),
);

/** Normalize a raw stored value to a valid palette id (legacy aliases ok). */
function normalizePaletteId(raw: string): PaletteId | null {
  const legacy = LEGACY_ALIASES[raw];
  if (legacy) return legacy;
  if (VALID_PALETTE_IDS.has(raw)) return raw as PaletteId;
  return null;
}

/** Read the stored palette id from localStorage. Falls back to "pi". */
export type MinimalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readStoredPalette(storage?: MinimalStorage): PaletteId {
  const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  if (!s) return "pi";
  try {
    const value = s.getItem(PALETTE_STORAGE_KEY);
    if (value) {
      const norm = normalizePaletteId(value);
      if (norm) return norm;
    }
  } catch {
    // ignore storage errors
  }
  return "pi";
}

/** Persist the palette selection to localStorage. */
export function persistPalette(palette: PaletteId, storage?: MinimalStorage): void {
  const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  if (!s) return;
  try {
    s.setItem(PALETTE_STORAGE_KEY, palette);
  } catch {
    // ignore storage errors
  }
}

/** Apply the palette data attribute to the document root. */
export function applyPaletteToDom(
  palette: PaletteId,
  doc?: {
    documentElement: {
      setAttribute: (n: string, v: string) => void;
      removeAttribute: (n: string) => void;
    };
  },
): void {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) return;
  if (palette === "pi") {
    d.documentElement.removeAttribute("data-palette");
  } else {
    d.documentElement.setAttribute("data-palette", palette);
  }
}
