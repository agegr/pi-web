"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { WebThemeConfig } from "@/lib/settings-api";

type Theme = "light" | "dark";

const THEME_MODE_KEY = "omp-theme";
const THEME_CONFIG_KEY = "omp-theme-config";
let themeConfig: WebThemeConfig | null = null;
let themeRequestId = 0;

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.ompThemeMode === "dark" ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

type ToggleOrigin = { x: number; y: number };

function applyTheme(mode: Theme, persist: boolean): void {
  const root = document.documentElement;
  const palette = themeConfig?.palettes[mode];
  root.dataset.ompThemeMode = mode;
  root.classList.toggle("dark", palette ? palette.colorScheme === "dark" : mode === "dark");
  if (palette) {
    for (const [name, value] of Object.entries(palette.variables)) {
      root.style.setProperty(name, value);
    }
    root.dataset.ompThemeName = palette.name;
    root.style.colorScheme = palette.colorScheme;
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_MODE_KEY, mode);
    } catch {
      // Ignore storage errors in private mode or at quota.
    }
  }
  listeners.forEach((callback) => callback());
}

export async function refreshOmpTheme(cwd?: string | null): Promise<void> {
  const requestId = ++themeRequestId;
  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  const response = await fetch(`/api/theme${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Theme request failed (${response.status})`);
  const nextConfig = await response.json() as WebThemeConfig;
  if (requestId !== themeRequestId) return;
  themeConfig = nextConfig;
  try {
    localStorage.setItem(THEME_CONFIG_KEY, JSON.stringify(themeConfig));
  } catch {
    // The in-memory configuration still applies when storage is unavailable.
  }
  applyTheme(getSnapshot(), false);
}

export function useTheme(options?: { cwd?: string | null; syncWithOmp?: boolean }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!options?.syncWithOmp) return;
    let cancelled = false;
    void refreshOmpTheme(options.cwd).catch(() => {
      if (cancelled) return;
      try {
        const cached = localStorage.getItem(THEME_CONFIG_KEY);
        if (cached) {
          themeConfig = JSON.parse(cached) as WebThemeConfig;
          applyTheme(getSnapshot(), false);
        }
      } catch {
        // Keep the built-in CSS fallback when neither endpoint nor cache works.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [options?.cwd, options?.syncWithOmp]);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";

    const apply = () => applyTheme(next, true);

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

  return { theme, toggleTheme, isDark: theme === "dark" };
}
