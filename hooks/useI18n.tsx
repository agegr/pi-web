"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLocalePlugin, getSupportedLocales } from "@/lib/i18n/registry";
import { translateMessage } from "@/lib/i18n/format";
import type { Locale, LocalePlugin, TranslationParams } from "@/lib/i18n/types";
// 必须在客户端注入我们的补充翻译键（settings/inspector/prompts/plan/engine/todo 等）。
// 仅由 app/layout.tsx（服务端组件）引入时，注入只发生在服务端 bundle，
// 客户端渲染的右侧栏面板会因 zh-CN 缺失这些键而回退成英文。本模块是全局
// 客户端 Provider，在此副作用引入可保证客户端 bundle 也完成注入。
import "@/lib/i18n/ours-messages";

const LOCALE_STORAGE_KEY = "pi-locale";
const defaultLocale: Locale = "zh-CN";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  supportedLocales: LocalePlugin[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getMessages(): Record<string, Record<string, string>> {
  return Object.fromEntries(
    getSupportedLocales().flatMap((id) => {
      const plugin = getLocalePlugin(id);
      return plugin ? [[id, plugin.messages]] : [];
    }),
  );
}

function readInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "zh-CN") return stored;
  } catch {
    // 隐私模式或存储不可用时沿用默认语言。
  }
  // 未显式设置语言时遵循默认语言（中文），不随浏览器语言变化。
  return defaultLocale;
}

/**
 * 提供 Pi Web 的界面语言状态和翻译能力。
 * @param props React 子节点
 * @returns 包含语言上下文的 React 节点
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [hydrated, setHydrated] = useState(false);
  const supportedLocales = useMemo(
    () =>
      getSupportedLocales()
        .map((id) => getLocalePlugin(id))
        .filter((plugin): plugin is LocalePlugin => Boolean(plugin)),
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
      // 存储失败不影响当前页面内的语言切换。
    }
  }, []);

  const t = useCallback(
    (key: string, params?: TranslationParams) => translateMessage(locale, key, messages, params),
    [locale, messages],
  );
  const value = useMemo(
    () => ({ locale: hydrated ? locale : defaultLocale, setLocale, t, supportedLocales }),
    [hydrated, locale, setLocale, t, supportedLocales],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * 获取当前组件树中的国际化能力。
 * @returns 当前 locale、翻译函数、语言切换函数和支持的语言列表
 * @throws 当组件不在 I18nProvider 内时抛出异常
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
