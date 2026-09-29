/**
 * Demo content follows the UI language: Chinese for zh-CN / zh-TW, English
 * otherwise. Mirrors hooks/useI18n.tsx so the tutorial matches the chrome.
 */
import { resolveBrowserLocale } from "@/lib/i18n/registry";

export type DemoLocale = "en" | "zh";

export function currentDemoLocale(): DemoLocale {
  if (typeof window === "undefined") return "en";
  let locale: string | null = null;
  try {
    locale = window.localStorage.getItem("pi-locale");
  } catch {
    // Storage unavailable: fall back to the browser language.
  }
  if (locale !== "en" && locale !== "zh-CN" && locale !== "zh-TW") {
    locale = resolveBrowserLocale(window.navigator.languages.length ? window.navigator.languages : [window.navigator.language]);
  }
  return locale === "en" ? "en" : "zh";
}

/** A piece of demo copy in both supported languages. */
export type Localized = { en: string; zh: string };

export function pick(text: Localized | string, locale: DemoLocale): string {
  return typeof text === "string" ? text : text[locale];
}
