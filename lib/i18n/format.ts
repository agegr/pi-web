import type { Locale, TranslationParams } from "./types";

type MessagesByLocale = Record<string, Record<string, string>>;

/**
 * Replaces simple interpolation placeholders in a translated message.
 * @param message The original translated message.
 * @param params Interpolation parameters.
 * @returns The message after replacing parameters.
 */
export function interpolateMessage(message: string, params: TranslationParams = {}): string {
  return message.replace(/\{([\w.-]+)\}/g, (token, name: string) => {
    const value = params[name];
    return value === undefined ? token : String(value);
  });
}

/**
 * Resolves a message from the current locale and the English locale.
 * @param locale The current locale.
 * @param key The translation key.
 * @param messages Message dictionaries grouped by locale.
 * @param params Optional interpolation parameters.
 * @returns The translated message, or the key when it is missing.
 */
export function translateMessage(
  locale: Locale,
  key: string,
  messages: MessagesByLocale,
  params: TranslationParams = {},
): string {
  const message = messages[locale]?.[key] ?? messages.en?.[key];
  if (message === undefined) {
    if (process.env.NODE_ENV !== "production") console.warn(`[i18n] Missing translation: ${key}`);
    return key;
  }
  return interpolateMessage(message, params);
}

/**
 * Formats relative time using the current locale.
 * @param date The time to format.
 * @param locale The current locale.
 * @param now The current time for tests or special cases.
 * @returns Locale-aware relative time text.
 */
export function formatRelativeTime(date: Date | string, locale: Locale, now = new Date()): string {
  const target = date instanceof Date ? date : new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const [unit, divisor] = absMs < 60_000
    ? ["second", 1_000]
    : absMs < 3_600_000
      ? ["minute", 60_000]
      : absMs < 86_400_000
        ? ["hour", 3_600_000]
        : ["day", 86_400_000];
  const value = Math.round(diffMs / divisor);
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(value, unit as Intl.RelativeTimeFormatUnit);
}
