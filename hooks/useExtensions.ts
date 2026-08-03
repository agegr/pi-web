"use client";

// 浏览器侧扩展通过 window.React 创建元素（见 lib/extensions/types.ts 注释）。
// 本模块是扩展加载的唯一入口——模块顶层在 loadExtensions()（useEffect 内）
// 之前执行，故在此挂载时机正确，保证扩展 import 时 window.React 已就绪。
// 历史缺陷：此前 window.React 从未被挂载，导致 git-status 等扩展 activate()
// 内 React.createElement 抛 TypeError、被 loadExtensions 的 catch 吞掉、
// console.warn 后不注册——整个浏览器侧扩展加载链路全断。
import * as React from "react";
if (typeof window !== "undefined") {
  (window as unknown as { React: typeof React }).React = React;
}

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getExtensionRegistry } from "@/lib/extensions/registry";
import type {
  ExtensionManifest,
  ExtensionRuntimeContext,
  LoadedExtensionInfo,
  PiWebExtension,
  QualifiedAction,
  QualifiedPanel,
  WorkspaceLabelContext,
} from "@/lib/extensions/types";

// Track whether extensions have been loaded (once per page lifecycle).
let extensionsLoaded = false;

/**
 * Load all extensions from the manifest. Called once on mount.
 * Uses /* webpackIgnore: true *\/ so Turbopack leaves the dynamic import alone —
 * these are runtime-only external modules, not build-time chunks.
 */
async function loadExtensions(): Promise<void> {
  if (extensionsLoaded) return;
  extensionsLoaded = true;

  const registry = getExtensionRegistry();
  let manifest: ExtensionManifest;

  try {
    const res = await fetch("/api/extensions/manifest", { cache: "no-store" });
    if (!res.ok) return;
    manifest = (await res.json()) as ExtensionManifest;
  } catch {
    return;
  }

  for (const entry of manifest.extensions) {
    try {
      // webpackIgnore tells Turbopack/Webpack not to analyze this import —
      // it's a runtime URL to an external module served by our API route.
      const mod = await import(/* webpackIgnore: true */ entry.module);
      const ext = mod.default as unknown;
      if (!isValidExtension(ext)) {
        console.warn(
          `[extensions] Skipping "${entry.id}": invalid module (missing apiVersion/activate)`,
        );
        continue;
      }
      registry.register(ext as PiWebExtension, { id: entry.id, source: entry.source });
    } catch (e) {
      console.warn(`[extensions] Failed to load "${entry.id}":`, e);
    }
  }
}

function isValidExtension(value: unknown): value is PiWebExtension {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as PiWebExtension).apiVersion === 1 &&
    typeof (value as PiWebExtension).name === "string" &&
    typeof (value as PiWebExtension).activate === "function"
  );
}

/**
 * React hook for accessing browser-side extensions.
 *
 * const { getActions, getWorkspacePanels, getWorkspaceLabelItems, extensions } = useExtensions();
 *
 * Triggers one-time loading on first mount. Subsequent mounts share the same
 * registry (globalThis-backed singleton).
 */
export function useExtensions() {
  const registry = getExtensionRegistry();
  // Subscribe to registry changes so consumers re-render when extensions load.
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);

  // Load extensions once on mount.
  useEffect(() => {
    void loadExtensions();
  }, []);

  const getActions = useCallback(
    (ctx: ExtensionRuntimeContext): QualifiedAction[] => registry.getActions(ctx),
    [registry],
  );

  const getActionDisabledReason = useCallback(
    (action: QualifiedAction, ctx: ExtensionRuntimeContext): string | undefined =>
      registry.getActionDisabledReason(action, ctx),
    [registry],
  );

  const getWorkspacePanels = useCallback(
    (): QualifiedPanel[] => registry.getWorkspacePanels(),
    [registry],
  );

  const getWorkspaceLabelItems = useCallback(
    (ctx: WorkspaceLabelContext) => registry.getWorkspaceLabelItems(ctx),
    [registry],
  );

  const extensions: LoadedExtensionInfo[] = registry.list();

  return {
    getActions,
    getActionDisabledReason,
    getWorkspacePanels,
    getWorkspaceLabelItems,
    extensions,
  };
}

export type { ExtensionManifestEntry } from "@/lib/extensions/types";
