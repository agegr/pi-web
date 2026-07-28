import { enLocale } from "./messages/en.ts";
import { zhCNLocale } from "./messages/zh-CN.ts";
import type { Locale, LocalePlugin } from "./types";

const localePlugins = new Map<string, LocalePlugin>();

/** Registers a locale plugin; duplicate registration throws instead of silently overwriting translations. */
export function registerLocale(plugin: LocalePlugin): void {
  if (!plugin.id.trim()) throw new Error("Locale id must not be empty");
  if (localePlugins.has(plugin.id)) throw new Error(`Locale already registered: ${plugin.id}`);
  localePlugins.set(plugin.id, plugin);
}

/**
 * Gets a registered locale plugin by identifier.
 * @param id The locale identifier to query.
 * @returns The registered locale plugin, or undefined if it does not exist.
 */
export function getLocalePlugin(id: string): LocalePlugin | undefined {
  return localePlugins.get(id);
}

/** Returns the stable ordered list of currently registered locales. */
export function getSupportedLocales(): string[] {
  return [...localePlugins.keys()];
}

/**
 * Resolves a browser language list to a built-in Pi Web locale.
 * @param languages Browser languages ordered by preference.
 * @returns The matching built-in locale, or English when none matches.
 */
export function resolveBrowserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
    if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  }
  return "en";
}

registerLocale(enLocale);
registerLocale(zhCNLocale);
