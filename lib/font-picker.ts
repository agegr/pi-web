import type { InstalledFontInfo } from "./api-types";
import type { FontKind } from "./font-preferences";

/** The names in a font-family value: comma-separated, with optional quotes around each. */
export function parseFontFamilies(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .map((part) => (part.length >= 2 && (part[0] === '"' || part[0] === "'") && part.endsWith(part[0]) ? part.slice(1, -1).trim() : part))
    .filter(Boolean);
}

/** Whether the field already names this family, so the picker can mark it. */
export function isFontFamilySelected(value: string, family: string): boolean {
  const target = family.toLocaleLowerCase();
  return parseFontFamilies(value).some((name) => name.toLocaleLowerCase() === target);
}

/**
 * Families matching `query` by their own name or a localized alias. The mono
 * field lists fixed-pitch families first, since a proportional one cannot
 * align code.
 */
export function filterInstalledFonts(fonts: InstalledFontInfo[], query: string, kind: FontKind): InstalledFontInfo[] {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = normalized
    ? fonts.filter((font) => [font.family, ...font.aliases].some((name) => name.toLocaleLowerCase().includes(normalized)))
    : fonts;
  if (kind !== "mono") return matches;
  return [...matches.filter((font) => font.monospace), ...matches.filter((font) => !font.monospace)];
}
