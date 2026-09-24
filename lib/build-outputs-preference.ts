/**
 * Global "Show build outputs" preference for the file explorer.
 *
 * The explorer tree (GET /api/files/[...path]?type=list) hides directories
 * named `build`/`dist` unless the request opts in via ?showBuildOutputs=1.
 * Whether the explorer opts in is a single global, browser-local
 * preference shared by every mounted root tree: default off, persisted in
 * localStorage under one fixed key (the same best-effort,
 * corrupt-tolerant, storage-injectable pattern as lib/explorer-roots.ts —
 * unavailable, quota-limited, or corrupt storage degrades to the default
 * and never throws).
 *
 * MultiRootFileExplorer renders the single toggle and mounts one
 * FileExplorer per root, so every setter also broadcasts a change event
 * on `window`. All mounted explorers follow the change without any prop
 * drilling. Legacy per-root keys (with a root-suffixed storage key) are
 * neither read nor migrated: after this change there is exactly one key
 * and a user who previously toggled per root re-toggles once.
 */

const STORAGE_KEY = "pi-web:file-explorer:show-build-outputs";

export const BUILD_OUTPUTS_CHANGE_EVENT = "pi-web:build-outputs-change";

export interface BuildOutputsChange {
  value: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface EventTargetLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  dispatchEvent(event: unknown): unknown;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getBrowserWindow(): EventTargetLike | null {
  return typeof window === "undefined" ? null : (window as unknown as EventTargetLike);
}

/**
 * Current global preference. Absent/unavailable/corrupt storage reads as
 * false (build outputs hidden). Every accessor re-reads storage, so a
 * reload or hot-reload sees fresh state.
 */
export function getShowBuildOutputs(
  storage: StorageLike | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Persist the global preference and broadcast the change so every mounted
 * explorer re-reads it. Best-effort: quota or privacy-mode failures are
 * silently ignored.
 */
export function setShowBuildOutputs(
  value: boolean,
  storage: StorageLike | null = getBrowserStorage(),
  eventTarget: EventTargetLike | null = getBrowserWindow(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Browser storage is best-effort.
  }
  // Broadcast the EFFECTIVE value (read back from the SAME storage the
  // write targeted), never the optimistic request: when storage is
  // unavailable or the write throws, the preference stays false, and every
  // surface must agree on that instead of half-applying the requested
  // value (review B1, pi#50).
  emitBuildOutputsChange({ value: getShowBuildOutputs(storage) }, eventTarget);
}

/** Broadcast a preference change; package-private, exported for tests. */
export function emitBuildOutputsChange(
  change: BuildOutputsChange,
  eventTarget: EventTargetLike | null = getBrowserWindow(),
): void {
  if (!eventTarget) return;
  try {
    eventTarget.dispatchEvent(new CustomEvent(BUILD_OUTPUTS_CHANGE_EVENT, { detail: change }));
  } catch {
    // Environments without CustomEvent (SSR) simply do not broadcast.
  }
}

/**
 * Subscribe to preference changes. Returns an unsubscribe function, the
 * standard shape for React effect cleanup.
 */
export function subscribeShowBuildOutputs(
  listener: (change: BuildOutputsChange) => void,
  eventTarget: EventTargetLike | null = getBrowserWindow(),
): () => void {
  if (!eventTarget) return () => {};
  const handler = (event: unknown) => {
    const detail = (event as { detail?: BuildOutputsChange }).detail;
    if (detail) listener(detail);
  };
  eventTarget.addEventListener(BUILD_OUTPUTS_CHANGE_EVENT, handler);
  return () => eventTarget.removeEventListener(BUILD_OUTPUTS_CHANGE_EVENT, handler);
}
