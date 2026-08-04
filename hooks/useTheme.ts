"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

// ─── 主题名（pi theme JSON 集，如 gruvbox / solarized）──────────────────────
//
// localStorage "pi-theme" 同时承载历史明暗值，兼容映射：
//   "light" / "dark" → 默认主题（空字符串，globals.css 硬编码变量）
//   其他值（如 "gruvbox"）→ pi theme JSON 主题集名
// 主题名持久化后，明暗偏好不单独存储：切回默认主题前，明暗随系统偏好（bootstrap 处理）。

function readStoredTheme(): string {
  try {
    const v = localStorage.getItem("pi-theme");
    if (v && v !== "light" && v !== "dark") return v;
  } catch {
    // 忽略存储错误（隐私模式、配额等）
  }
  return "";
}

function getThemeSnapshot(): string {
  if (typeof document === "undefined") return "";
  const dt = document.documentElement.dataset.theme;
  if (dt !== undefined) return dt;
  return readStoredTheme();
}

// ─── CSS 变量应用 ────────────────────────────────────────────────────────────
//
// 与 lib/theme.ts mapToCssVars 输出严格一一对应（20 个），均为当前 UI
// 实际消费的变量。--composer-focus-bg 为 Kabochar 独有，由 mapToCssVars
// 从主题面板色派生（聚焦态与主题协调）。

const THEME_CSS_VARS = [
  "--bg", "--bg-panel", "--bg-hover", "--bg-selected", "--bg-sidebar", "--bg-subtle",
  "--border",
  "--text", "--text-muted", "--text-dim",
  "--accent", "--accent-hover", "--accent-blue", "--accent-red", "--accent-green", "--accent-orange",
  "--user-bg", "--assistant-bg", "--tool-bg",
  "--composer-focus-bg",
];

function applyCssVars(vars: Record<string, string>) {
  const el = document.documentElement;
  for (const k of THEME_CSS_VARS) {
    if (vars[k]) el.style.setProperty(k, vars[k]);
    else el.style.removeProperty(k);
  }
}

function clearCssVars() {
  const el = document.documentElement;
  for (const k of THEME_CSS_VARS) el.style.removeProperty(k);
}

/** 解析缓存按 `name::mode` 键控，避免重复 fetch 同一变体。 */
const themeCache = new Map<string, Record<string, string> | null>();

async function fetchThemeVars(name: string, mode: Theme): Promise<Record<string, string> | null> {
  const cacheKey = `${name}::${mode}`;
  if (themeCache.has(cacheKey)) return themeCache.get(cacheKey)!;
  try {
    const resp = await fetch(`/api/themes/${encodeURIComponent(name)}?mode=${mode}`);
    if (!resp.ok) return null;
    const data: { cssVars: Record<string, string> } = await resp.json();
    themeCache.set(cacheKey, data.cssVars);
    return data.cssVars;
  } catch {
    return null;
  }
}

/** 应用主题集指定变体的 CSS 变量；name 为空时清空回落到 globals.css 默认。 */
async function applyTheme(name: string, mode: Theme) {
  const el = document.documentElement;
  if (name) {
    el.dataset.theme = name;
    const vars = await fetchThemeVars(name, mode);
    if (vars) {
      applyCssVars(vars);
    } else {
      console.warn(`Theme "${name}" variant "${mode}" not found, using defaults`);
      clearCssVars();
    }
  } else {
    delete el.dataset.theme;
    clearCssVars();
  }
}

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback(async (name: string) => {
    await applyTheme(name, getSnapshot());
    try {
      localStorage.setItem("pi-theme", name);
    } catch {
      // 忽略存储错误
    }
    listeners.forEach((cb) => cb());
  }, []);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";

    const apply = () => {
      if (next === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      // 明暗切换后重新解析当前主题的对应变体（gruvbox → gruvbox-light 等）
      const tn = getThemeSnapshot();
      if (tn) {
        applyTheme(tn, next);
      }
      listeners.forEach((cb) => cb());
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // transition cancelled — ignore
      });
  }, []);

  // 挂载时应用持久化主题：bootstrap 脚本已同步设置 data-theme 与 dark class，
  // 此处补齐 CSS 变量（本地 API fetch，毫秒级）。
  useEffect(() => {
    const tn = getThemeSnapshot();
    if (tn) {
      applyTheme(tn, getSnapshot());
    }
  }, []);

  return {
    theme,
    /** 当前主题集名（"" = 默认主题）。 */
    themeName: getThemeSnapshot(),
    /** 切换主题集（如 "gruvbox"），传 "" 恢复默认。 */
    setTheme,
    toggleTheme,
    isDark: theme === "dark",
  };
}
