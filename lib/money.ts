// Client-safe money display. Amounts are always stored in US dollars (pi's
// `usage.cost` and the models.dev / models.json unit prices are USD); only the
// display converts. Simplified Chinese shows yuan, Traditional Chinese and
// English keep dollars. Nothing that is written back to a config file goes
// through here: models.json keeps its USD prices.

import type { Locale } from "./i18n/types";

/**
 * Hardcoded rate: 1 USD = 6.69 CNY.
 * Taken on 2026-10-23 (exchangerate-api 6.689327, frankfurter 6.6743); this
 * is the only place to edit when the rate moves.
 */
export const USD_TO_CNY = 6.69;

/** The smallest currency unit: one cent (¥0.01 and $0.01). */
export const SMALLEST_UNIT = 0.01;

/** The one locale that converts dollars into yuan; every other keeps dollars. */
const CNY_LOCALES: readonly string[] = ["zh-CN"];

/** Whether this UI language shows dollar amounts converted into yuan. */
export function displaysCny(locale: Locale | string | undefined): boolean {
  return locale !== undefined && CNY_LOCALES.includes(locale);
}

/** A USD amount in the unit the locale displays. */
export function localAmount(usd: number, locale: Locale | string | undefined): number {
  return displaysCny(locale) ? usd * USD_TO_CNY : usd;
}

/** The locale's currency symbol. */
export function currencySymbol(locale: Locale | string | undefined): "¥" | "$" {
  return displaysCny(locale) ? "¥" : "$";
}

/** An amount with a fixed number of decimals, such as ¥12.34 or $0.1234. */
export function formatMoney(usd: number, locale: Locale | string | undefined, digits: number): string {
  return `${currencySymbol(locale)}${localAmount(usd, locale).toFixed(digits)}`;
}

/**
 * An amount shown from one cent up: two decimals once it reaches a cent,
 * `<¥0.01` below that, and null when nothing was billed.
 */
export function formatMoneyFromCent(usd: number, locale: Locale | string | undefined): string | null {
  const amount = localAmount(usd, locale);
  if (!(amount > 0)) return null;
  return amount >= SMALLEST_UNIT
    ? formatMoney(usd, locale, 2)
    : `<${currencySymbol(locale)}${SMALLEST_UNIT.toFixed(2)}`;
}
