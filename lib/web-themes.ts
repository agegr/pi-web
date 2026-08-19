/**
 * Palette definitions for the multi-palette theme system.
 * Each palette defines a name, label, and color preview swatches.
 */

export type PaletteId =
  | "pi"
  | "midnight"
  | "tokyo-night"
  | "catppuccin"
  | "dracula"
  | "nord"
  | "gruvbox"
  | "solarized-dark"
  | "solarized-light";

export interface PaletteMeta {
  id: PaletteId;
  label: string;
  /** Colors for the preview swatch: [bg, accent, text, border] */
  swatch: [string, string, string, string];
  /** Whether this is a light palette (used for appearance defaults) */
  isLight: boolean;
}

export const PALETTES: PaletteMeta[] = [
  {
    id: "pi",
    label: "Pi",
    swatch: ["#ffffff", "#2563eb", "#1a1a1a", "#e0e0e0"],
    isLight: true,
  },
  {
    id: "midnight",
    label: "Midnight",
    swatch: ["#0f1117", "#7aa2f7", "#c8cad8", "#2a2d3e"],
    isLight: false,
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    swatch: ["#1a1b26", "#7aa2f7", "#c0caf5", "#3b4261"],
    isLight: false,
  },
  {
    id: "catppuccin",
    label: "Catppuccin Mocha",
    swatch: ["#1e1e2e", "#89b4fa", "#cdd6f4", "#585b70"],
    isLight: false,
  },
  {
    id: "dracula",
    label: "Dracula",
    swatch: ["#282a36", "#bd93f9", "#f8f8f2", "#44475a"],
    isLight: false,
  },
  {
    id: "nord",
    label: "Nord",
    swatch: ["#2e3440", "#88c0d0", "#eceff4", "#4c566a"],
    isLight: false,
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    swatch: ["#282828", "#d79921", "#ebdbb2", "#665c54"],
    isLight: false,
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    swatch: ["#002b36", "#268bd2", "#93a1a1", "#0b5060"],
    isLight: false,
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    swatch: ["#fdf6e3", "#268bd2", "#002b36", "#c4bda5"],
    isLight: true,
  },
];

export const PALETTE_STORAGE_KEY = "pi-web-palette";

export const VALID_PALETTE_IDS = new Set<string>(
  PALETTES.map((p) => p.id),
);

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
    if (value && VALID_PALETTE_IDS.has(value)) return value as PaletteId;
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
export function applyPaletteToDom(palette: PaletteId, doc?: { documentElement: { setAttribute: (n: string, v: string) => void; removeAttribute: (n: string) => void } }): void {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) return;
  if (palette === "pi") {
    d.documentElement.removeAttribute("data-palette");
  } else {
    d.documentElement.setAttribute("data-palette", palette);
  }
}
