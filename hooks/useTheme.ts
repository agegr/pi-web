"use client";

import { useSyncExternalStore } from "react";

/**
 * 用户选择的主题偏好，可跟随系统或固定为浅色、深色。
 */
export type ThemePreference = "system" | "light" | "dark";

/**
 * 当前实际应用到界面的有效主题。
 */
export type Theme = "light" | "dark";

/**
 * 主题切换动画的起始坐标。
 */
export interface ThemeTransitionOrigin {
  /** 视口内的横向坐标。 */
  x: number;
  /** 视口内的纵向坐标。 */
  y: number;
}

const listeners = new Set<() => void>();
let state: { preference: ThemePreference; theme: Theme } = {
  preference: "system",
  theme: "light",
};
let mediaQuery: MediaQueryList | null = null;

/**
 * 将存储值规范化为受支持的主题偏好。
 *
 * @param value - localStorage 中读取到的主题值。
 * @returns 有效主题偏好；缺失或无效值返回 `"system"`。
 */
export function readThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

/**
 * 根据用户偏好和系统深色模式状态计算有效主题。
 *
 * @param preference - 用户选择的主题偏好。
 * @param systemIsDark - 系统是否处于深色模式。
 * @returns 应实际应用到界面的浅色或深色主题。
 */
export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): Theme {
  if (preference === "system") return systemIsDark ? "dark" : "light";
  return preference;
}

function notify(): void {
  listeners.forEach(listener => listener());
}

function applyTheme(nextTheme: Theme): void {
  state = { ...state, theme: nextTheme };
  document.documentElement.classList.toggle("dark", nextTheme === "dark");
  notify();
}

function getSystemMediaQuery(): MediaQueryList | null {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  } catch {
    return null;
  }
}

function stopSystemThemeListener(): void {
  if (!mediaQuery) return;
  mediaQuery.removeEventListener("change", handleSystemThemeChange);
  mediaQuery = null;
}

function handleSystemThemeChange(event: MediaQueryListEvent): void {
  if (state.preference === "system") applyTheme(resolveTheme(state.preference, event.matches));
}

function syncSystemThemeListener(): void {
  stopSystemThemeListener();
  if (state.preference !== "system" || listeners.size === 0) return;

  mediaQuery = getSystemMediaQuery();
  mediaQuery?.addEventListener("change", handleSystemThemeChange);
}

function currentSystemIsDark(): boolean {
  return getSystemMediaQuery()?.matches ?? false;
}

function applyThemePreference(nextPreference: ThemePreference): void {
  state = { ...state, preference: nextPreference };
  syncSystemThemeListener();
  applyTheme(resolveTheme(state.preference, currentSystemIsDark()));
}

function applyWithViewTransition(callback: () => void, origin?: ThemeTransitionOrigin): void {
  let reduceMotion = false;
  try {
    reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    // 无法检测动画偏好时仍尝试使用浏览器支持的 View Transition。
  }
  const supportsViewTransition = typeof document.startViewTransition === "function";
  if (!supportsViewTransition || reduceMotion) {
    callback();
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(callback);
  } catch {
    callback();
    return;
  }
  transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
      { duration: 450, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
    );
  }).catch(() => {
    // View Transition 被取消时无需额外处理。
  });
}

/**
 * 设置主题偏好、同步页面样式并持久化用户选择。
 *
 * @param nextPreference - 要应用的主题偏好。
 * @param origin - 可选的 View Transition 动画起始坐标。
 * @returns 无返回值。
 */
export function setThemePreference(nextPreference: ThemePreference, origin?: ThemeTransitionOrigin): void {
  const apply = () => {
    applyThemePreference(nextPreference);
    try {
      localStorage.setItem("pi-theme", nextPreference);
    } catch {
      // localStorage 在隐私模式或配额耗尽时可能不可用。
    }
  };

  applyWithViewTransition(apply, origin);
}

/**
 * 订阅全局主题状态，并在需要时维护 system 偏好的媒体查询监听。
 *
 * @param listener - 主题状态变化时调用的订阅函数。
 * @returns 取消订阅并在最后一个订阅者离开时清理监听的函数。
 */
export function subscribeTheme(listener: () => void): () => void {
  const isFirstSubscriber = listeners.size === 0;
  listeners.add(listener);
  syncSystemThemeListener();
  if (isFirstSubscriber && state.preference === "system") {
    const nextTheme = resolveTheme(state.preference, mediaQuery?.matches ?? false);
    if (state.theme !== nextTheme) applyTheme(nextTheme);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopSystemThemeListener();
  };
}

function getSnapshot(): { preference: ThemePreference; theme: Theme } {
  return state;
}

const serverSnapshot = { preference: "system" as ThemePreference, theme: "light" as Theme };

if (typeof window !== "undefined" && typeof document !== "undefined") {
  try {
    state = { ...state, preference: readThemePreference(localStorage.getItem("pi-theme")) };
  } catch {
    state = { ...state, preference: "system" };
  }
  applyThemePreference(state.preference);
}

/**
 * 订阅全局主题状态，并提供修改主题偏好的操作。
 *
 * @returns 当前偏好、有效主题、深色状态和设置偏好的函数。
 */
export function useTheme(): {
  preference: ThemePreference;
  theme: Theme;
  isDark: boolean;
  setThemePreference: typeof setThemePreference;
} {
  const snapshot = useSyncExternalStore(subscribeTheme, getSnapshot, () => serverSnapshot);
  return {
    preference: snapshot.preference,
    theme: snapshot.theme,
    isDark: snapshot.theme === "dark",
    setThemePreference,
  };
}
