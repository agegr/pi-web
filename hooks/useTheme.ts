"use client";

import { useSyncExternalStore } from "react";

/**
 * The user's theme preference, following the system or fixed to light or dark.
 */
export type ThemePreference = "system" | "light" | "dark";

/**
 * The effective theme currently applied to the interface.
 */
export type Theme = "light" | "dark";

/**
 * The origin coordinates for the theme transition animation.
 */
export interface ThemeTransitionOrigin {
  /** Horizontal coordinate within the viewport. */
  x: number;
  /** Vertical coordinate within the viewport. */
  y: number;
}

const listeners = new Set<() => void>();
let state: { preference: ThemePreference; theme: Theme } = {
  preference: "system",
  theme: "light",
};
let mediaQuery: MediaQueryList | null = null;

/**
 * Normalizes a stored value to a supported theme preference.
 *
 * @param value - The theme value read from localStorage.
 * @returns A valid theme preference; returns `"system"` for missing or invalid values.
 */
export function readThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

/**
 * Resolves the effective theme from the user preference and system dark mode state.
 *
 * @param preference - The user's theme preference.
 * @param systemIsDark - Whether the system is using dark mode.
 * @returns The light or dark theme to apply to the interface.
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
    // Still attempt the browser-supported View Transition when the motion preference cannot be detected.
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
    // No additional handling is needed when the View Transition is cancelled.
  });
}

/**
 * Sets the theme preference, synchronizes page styles, and persists the user's choice.
 *
 * @param nextPreference - The theme preference to apply.
 * @param origin - Optional origin coordinates for the View Transition animation.
 * @returns No return value.
 */
export function setThemePreference(nextPreference: ThemePreference, origin?: ThemeTransitionOrigin): void {
  const apply = () => {
    applyThemePreference(nextPreference);
    try {
      localStorage.setItem("pi-theme", nextPreference);
    } catch {
      // localStorage may be unavailable in private mode or when the quota is exhausted.
    }
  };

  applyWithViewTransition(apply, origin);
}

/**
 * Subscribes to global theme state and maintains the media-query listener for the system preference.
 *
 * @param listener - The subscription function called when the theme state changes.
 * @returns A function that unsubscribes and cleans up the listener when the last subscriber leaves.
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
 * Subscribes to global theme state and provides an operation to change the theme preference.
 *
 * @returns The current preference, effective theme, dark-mode state, and preference setter.
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
