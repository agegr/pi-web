"use client";

import { useSyncExternalStore } from "react";

export const MINIMAP_MAX_NODES_DEFAULT = 50;
export const MINIMAP_MAX_NODES_STORAGE_KEY = "pi-minimap-max-nodes";

interface MinimapSettings {
  maxNodes: number;
}

const DEFAULT_MINIMAP: MinimapSettings = {
  maxNodes: MINIMAP_MAX_NODES_DEFAULT,
};
let minimapSettings: MinimapSettings | null = null;
const listeners = new Set<() => void>();

function clampMaxNodes(value: unknown): number {
  const nodes = Number(value);
  if (!Number.isFinite(nodes) || nodes < 0) return MINIMAP_MAX_NODES_DEFAULT;
  return Math.min(1000, Math.round(nodes));
}

function readStoredPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function getSnapshot(): MinimapSettings {
  if (typeof window === "undefined") return DEFAULT_MINIMAP;
  if (!minimapSettings) {
    minimapSettings = {
      maxNodes: clampMaxNodes(readStoredPreference(MINIMAP_MAX_NODES_STORAGE_KEY) ?? MINIMAP_MAX_NODES_DEFAULT),
    };
  }
  return minimapSettings;
}

function setMaxNodes(value: number): void {
  if (typeof window === "undefined") return;
  const maxNodes = clampMaxNodes(value);
  const next = { ...getSnapshot(), maxNodes };
  minimapSettings = next;
  try {
    window.localStorage.setItem(MINIMAP_MAX_NODES_STORAGE_KEY, String(maxNodes));
  } catch {
    // Silent fail
  }
  listeners.forEach((listener) => listener());
}

export function useMinimapSettings() {
  const settings = useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    getSnapshot,
    () => DEFAULT_MINIMAP,
  );
  return {
    ...settings,
    setMaxNodes,
  };
}
