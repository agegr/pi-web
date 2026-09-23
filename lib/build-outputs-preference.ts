/**
 * Per-workspace "Show build outputs" preference for the file explorer.
 *
 * The explorer tree (GET /api/files/[...path]?type=list) hides directories
 * named `build`/`dist` unless the request opts in via ?showBuildOutputs=1.
 * Whether a given explorer opts in is a per-workspace-root, browser-local
 * preference: default off, persisted in localStorage under a key derived
 * from the workspace root path (the same best-effort, corrupt-tolerant,
 * storage-injectable pattern as lib/explorer-roots.ts — unavailable storage
 * degrades to the default and never throws).
 *
 * MultiRootFileExplorer mounts one FileExplorer per root, so every setter
 * also broadcasts a change event on `window`. Explorer instances of the
 * same root that are mounted simultaneously follow each other without any
 * prop drilling; instances of other roots ignore the change (they check the
 * event's root before applying it).
 */

const STORAGE_PREFIX = "pi-web:file-explorer:show-build-outputs";

export const BUILD_OUTPUTS_CHANGE_EVENT = "pi-web:build-outputs-change";

export interface BuildOutputsChange {
  /** Workspace root the change applies to (the explorer's `cwd`). */
  root: string;
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

function storageKeyFor(root: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(root)}`;
}

/**
 * Current preference for a workspace root. Absent/unavailable/corrupt
 * storage reads as false (build outputs hidden). Every accessor re-reads
 * storage, so a reload or hot-reload sees fresh state.
 */
export function getShowBuildOutputs(
  root: string,
  storage: StorageLike | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(storageKeyFor(root)) === "1";
  } catch {
    return false;
  }
}

/**
 * Persist the preference for a workspace root and broadcast the change so
 * every mounted explorer of the same root re-reads it. Best-effort: quota
 * or privacy-mode failures are silently ignored.
 */
export function setShowBuildOutputs(
  root: string,
  value: boolean,
  storage: StorageLike | null = getBrowserStorage(),
  eventTarget: EventTargetLike | null = getBrowserWindow(),
): void {
  try {
    storage?.setItem(storageKeyFor(root), value ? "1" : "0");
  } catch {
    // Browser storage is best-effort.
  }
  emitBuildOutputsChange({ root, value }, eventTarget);
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
