export type FontKind = "ui" | "mono";
/**
 * Base weights stop at Semi Bold (600): headings and labels use 600, bold text,
 * syntax-highlighted bold and the terminal's bold use 700. A heavier base would
 * make ordinary text heavier than the text meant to stand out.
 */
export const FONT_WEIGHT_OPTIONS = [
  { value: 100, label: "settings.fontWeightThin" },
  { value: 200, label: "settings.fontWeightExtraLight" },
  { value: 300, label: "settings.fontWeightLight" },
  { value: 400, label: "settings.fontWeightRegular" },
  { value: 500, label: "settings.fontWeightMedium" },
  { value: 600, label: "settings.fontWeightSemiBold" },
] as const;
export type FontWeight = (typeof FONT_WEIGHT_OPTIONS)[number]["value"];
export type FontPreferences = Record<FontKind, string> & Record<`${FontKind}Weight`, FontWeight>;

export const FONT_FAMILY_MAX_LENGTH = 500;
export const FONT_WEIGHT_DEFAULT: FontWeight = 400;
export const FONT_STORAGE_KEYS: Record<keyof FontPreferences, string> = {
  ui: "pi-ui-font-family",
  mono: "pi-mono-font-family",
  uiWeight: "pi-ui-font-weight",
  monoWeight: "pi-mono-font-weight",
};
export const DEFAULT_FONT_PREFERENCES: FontPreferences = {
  ui: "", mono: "", uiWeight: FONT_WEIGHT_DEFAULT, monoWeight: FONT_WEIGHT_DEFAULT,
};

/** Missing, malformed or unsupported weights keep the original Regular (400). */
export function readFontWeight(value: unknown): FontWeight {
  const weight = typeof value === "string" ? Number(value) : value;
  return FONT_WEIGHT_OPTIONS.find((option) => option.value === weight)?.value ?? FONT_WEIGHT_DEFAULT;
}

/** Keep the input's whitespace while typing; malformed stored values use the default. */
export function readFontPreference(value: unknown): string {
  return typeof value === "string" && value.length <= FONT_FAMILY_MAX_LENGTH ? value : "";
}

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
]);

/**
 * A comma-separated list of font names, not arbitrary CSS. Quote each name so
 * punctuation, CSS keywords and pasted declarations can never alter styles.
 * Optional enclosing quotes are accepted; commas always separate names.
 */
export function fontFamilyCss(value: unknown): string {
  return readFontPreference(value).split(",").flatMap((part) => {
    let name = part.trim().replace(/\s+/g, " ");
    const quoted = name.length >= 2 && (name[0] === '"' || name[0] === "'") && name.endsWith(name[0]);
    if (quoted) name = name.slice(1, -1).trim();
    if (!name) return [];
    return [!quoted && GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : JSON.stringify(name)];
  }).join(", ");
}

/** Custom names come first, but unavailable fonts retain the original fallback stack. */
export function fontFamilyOverride(kind: FontKind, value: unknown): string {
  const family = fontFamilyCss(value);
  return family ? `${family}, var(--font-${kind}-default)` : "";
}
