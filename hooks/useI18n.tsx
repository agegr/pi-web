"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLocalePlugin, getSupportedLocales, resolveBrowserLocale } from "@/lib/i18n/registry";
import { translateMessage } from "@/lib/i18n/format";
import type { Locale, LocalePlugin, TranslationParams } from "@/lib/i18n/types";

const LOCALE_STORAGE_KEY = "pi-locale";
const defaultLocale: Locale = "en";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  supportedLocales: LocalePlugin[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getMessages(): Record<string, Record<string, string>> {
  return Object.fromEntries(getSupportedLocales().flatMap((id) => {
    const plugin = getLocalePlugin(id);
    return plugin ? [[id, plugin.messages]] : [];
  }));
}

function readInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && getLocalePlugin(stored)) return stored;
  } catch {
    // Continue with the browser language when private mode or storage is unavailable.
  }
  return resolveBrowserLocale(window.navigator.languages.length ? window.navigator.languages : [window.navigator.language]);
}

/**
 * Provides Pi Web UI locale state and translation capabilities.
 * @param props React child nodes.
 * @returns A React node containing the locale context.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [hydrated, setHydrated] = useState(false);
  const supportedLocales = useMemo(
    () => getSupportedLocales().map((id) => getLocalePlugin(id)).filter((plugin): plugin is LocalePlugin => Boolean(plugin)),
    [],
  );
  const messages = useMemo(() => getMessages(), []);

  useEffect(() => {
    const next = readInitialLocale();
    setLocaleState(next);
    document.documentElement.lang = next;
    setHydrated(true);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    if (!getLocalePlugin(next)) return;
    setLocaleState(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // A storage failure must not prevent switching languages on the current page.
    }
  }, []);

  const t = useCallback((key: string, params?: TranslationParams) => translateMessage(locale, key, messages, params), [locale, messages]);
  const value = useMemo(() => ({ locale: hydrated ? locale : defaultLocale, setLocale, t, supportedLocales }), [hydrated, locale, setLocale, t, supportedLocales]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Gets internationalization capabilities from the current component tree.
 * @returns The current locale, translation function, locale setter, and supported locales.
 * @throws If the component is not rendered inside I18nProvider.
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
