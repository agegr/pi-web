"use client";

import { useCallback, useSyncExternalStore } from "react";

export type BgKind = "image" | "video";
export type BgCoverage = "full" | "chat";

export interface BgMetaItem {
  id: string;
  kind: BgKind;
  name: string;
  mime: string;
}

export interface BgItem extends BgMetaItem {
  blob: Blob;
  url: string;
}

interface BgState {
  enabled: boolean;
  coverage: BgCoverage;
  sound: boolean;
  dim: number; // 0..0.8 dark overlay
  intervalSec: number; // image switch interval
  order: BgMetaItem[];
  items: BgItem[]; // loaded items with object URLs
  currentIndex: number;
}

const LS_KEY = "pi-bg";
const IDB_NAME = "pi-bg";
const IDB_STORE = "media";
const IDB_RECORD = "items";
const DEFAULT_DIM = 0.55;
const DEFAULT_INTERVAL_SEC = 10;
// Preset image switch intervals (seconds). 0 = never auto-switch (no rotation).
// Long intervals are why the UI is a select, not a slider.
export const INTERVAL_OPTIONS_SEC = [
  10, 20, 30, 60, 120, 300, 600, 1800, 3600, 7200, 0,
];
export function formatIntervalSec(sec: number, neverLabel: string): string {
  if (sec <= 0) return neverLabel;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${sec / 3600}h`;
}

const SERVER_SNAPSHOT: BgState = {
  enabled: false,
  coverage: "full",
  sound: false,
  dim: DEFAULT_DIM,
  intervalSec: DEFAULT_INTERVAL_SEC,
  order: [],
  items: [],
  currentIndex: 0,
};

const listeners = new Set<() => void>();
let state: BgState = SERVER_SNAPSHOT;
let hydrated = false;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function persistMeta(next: BgState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      enabled: next.enabled,
      coverage: next.coverage,
      sound: next.sound,
      dim: next.dim,
      intervalSec: next.intervalSec,
      order: next.order,
      currentIndex: next.currentIndex,
    }));
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

function readMeta(): Pick<BgState, "enabled" | "coverage" | "sound" | "dim" | "intervalSec" | "order" | "currentIndex"> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BgState> & { order?: unknown };
    if (!Array.isArray(parsed.order)) return null;
    const order = parsed.order
      .filter((item): item is BgMetaItem => Boolean(item) && typeof (item as BgMetaItem).id === "string")
      .map((item) => ({
        id: item.id,
        kind: item.kind === "video" ? "video" as const : "image" as const,
        name: String(item.name ?? item.id),
        mime: String(item.mime ?? ""),
      }));
    return {
      enabled: parsed.enabled === true,
      coverage: parsed.coverage === "chat" ? "chat" as const : "full" as const,
      sound: parsed.sound === true,
      dim: typeof parsed.dim === "number" && parsed.dim >= 0 && parsed.dim <= 0.9 ? parsed.dim : DEFAULT_DIM,
      intervalSec: typeof parsed.intervalSec === "number" && parsed.intervalSec >= 0 ? parsed.intervalSec : DEFAULT_INTERVAL_SEC,
      order,
      currentIndex: typeof parsed.currentIndex === "number" && parsed.currentIndex >= 0 ? parsed.currentIndex : 0,
    };
  } catch {
    return null;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

async function idbRead(): Promise<Array<{ id: string; kind: BgKind; name: string; mime: string; blob?: Blob }>> {
  try {
    const db = await getDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const request = tx.objectStore(IDB_STORE).get(IDB_RECORD);
      request.onsuccess = () => resolve((request.result as Array<{ id: string; kind: BgKind; name: string; mime: string; blob?: Blob }>) ?? []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

async function idbWrite(rows: BgItem[]): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(rows.map(({ id, kind, name, mime, blob }) => ({ id, kind, name, mime, blob })), IDB_RECORD);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function revokeItems(items: BgItem[]): void {
  for (const item of items) {
    try {
      URL.revokeObjectURL(item.url);
    } catch {
      // ignore
    }
  }
}

function rebuildItems(rows: Array<{ id: string; kind: BgKind; name: string; mime: string; blob?: Blob }>): BgItem[] {
  return rows
    .filter((row) => row && row.id && row.blob)
    .map((row) => ({
      id: row.id,
      kind: row.kind === "video" ? "video" as const : "image" as const,
      name: String(row.name ?? row.id),
      mime: String(row.mime ?? ""),
      blob: row.blob as Blob,
      url: URL.createObjectURL(row.blob as Blob),
    }));
}

function ensureHydrated(): void {
  if (typeof window === "undefined" || hydrated) return;
  hydrated = true;

  const meta = readMeta();
  if (meta) {
    state = { ...state, ...meta, items: [], currentIndex: meta.currentIndex ?? 0 };
  }

  // Load blobs from IndexedDB asynchronously.
  void idbRead().then((rows) => {
    const items = rebuildItems(rows);
    const current = state;
    if (current.items.length > 0) revokeItems(current.items);
    const next: BgState = {
      ...current,
      items,
      currentIndex: items.length > 0 && current.currentIndex >= items.length ? items.length - 1 : current.currentIndex,
    };
    state = next;
    emit();
  }).catch(() => {
    // storage unavailable — background simply won't restore
  });
}

// 跨窗口实时同步：主窗口与「移出到桌面」的设置窗口是两个独立的 JS 环境，
// 各自有内存状态；一方增删/切换背景后，通过 BroadcastChannel 通知另一方从
// localStorage + IndexedDB 重新加载，立即生效（不用重启）。
const syncChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pi-bg-sync") : null;

function broadcastSync(): void {
  try { syncChannel?.postMessage("sync"); } catch { /* ignore */ }
}

function rehydrate(): void {
  const meta = readMeta();
  void idbRead().then((rows) => {
    const items = rebuildItems(rows);
    const current = state;
    if (current.items.length > 0) revokeItems(current.items);
    state = {
      ...current,
      ...(meta ?? {}),
      items,
      currentIndex: items.length === 0
        ? 0
        : Math.min(meta?.currentIndex ?? 0, items.length - 1),
    };
    emit();
  }).catch(() => {
    // storage unavailable — nothing to sync
  });
}

if (syncChannel) {
  syncChannel.addEventListener("message", () => rehydrate());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureHydrated();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): BgState {
  ensureHydrated();
  return state;
}

function getServerSnapshot(): BgState {
  return SERVER_SNAPSHOT;
}

function update(mutator: (current: BgState) => BgState): void {
  const next = mutator(state);
  if (next === state) return;
  state = next;
  persistMeta(state);
  emit();
  broadcastSync();
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `bg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useBackground() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted = Array.from(files).filter((file) =>
      file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    if (accepted.length === 0) return;

    const added: BgItem[] = accepted.map((file) => ({
      id: makeId(),
      kind: file.type.startsWith("video/") ? "video" as const : "image" as const,
      name: file.name || file.type,
      mime: file.type,
      blob: file,
      url: URL.createObjectURL(file),
    }));

    const current = state;
    const order = [...current.order, ...added.map(({ id, kind, name, mime }) => ({ id, kind, name, mime }))];
    const items = [...current.items, ...added];
    update(() => ({
      ...current,
      order,
      items,
      currentIndex: current.items.length === 0 ? 0 : current.currentIndex,
      enabled: true,
    }));
    void idbWrite(items).then(() => broadcastSync());
  }, []);

  const removeItem = useCallback((id: string) => {
    const current = state;
    const removed = current.items.find((item) => item.id === id);
    if (removed) revokeItems([removed]);
    const order = current.order.filter((item) => item.id !== id);
    const items = current.items.filter((item) => item.id !== id);
    const currentIndex = current.items.length === 0
      ? 0
      : Math.min(current.currentIndex, Math.max(0, items.length - 1));
    update(() => ({ ...current, order, items, currentIndex }));
    void idbWrite(items).then(() => broadcastSync());
  }, []);

  const removeAll = useCallback(() => {
    const current = state;
    revokeItems(current.items);
    update(() => ({ ...current, order: [], items: [], currentIndex: 0, enabled: false }));
    void idbWrite([]).then(() => broadcastSync());
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    update((current) => ({ ...current, enabled }));
  }, []);

  const setCoverage = useCallback((coverage: BgCoverage) => {
    update((current) => ({ ...current, coverage }));
  }, []);

  const setSound = useCallback((sound: boolean) => {
    update((current) => ({ ...current, sound }));
  }, []);

  const setDim = useCallback((dim: number) => {
    update((current) => ({ ...current, dim: Math.min(0.9, Math.max(0, dim)) }));
  }, []);

  const setIntervalSec = useCallback((intervalSec: number) => {
    update((current) => ({ ...current, intervalSec: Math.min(7200, Math.max(0, Math.round(intervalSec))) }));
  }, []);

  const setCurrentIndex = useCallback((index: number) => {
    update((current) => {
      if (current.items.length === 0) return current;
      return { ...current, currentIndex: ((index % current.items.length) + current.items.length) % current.items.length };
    });
  }, []);

  const next = useCallback(() => {
    update((current) => {
      if (current.items.length <= 1) return current;
      return { ...current, currentIndex: (current.currentIndex + 1) % current.items.length };
    });
  }, []);

  return {
    enabled: snapshot.enabled,
    coverage: snapshot.coverage,
    sound: snapshot.sound,
    dim: snapshot.dim,
    intervalSec: snapshot.intervalSec,
    order: snapshot.order,
    items: snapshot.items,
    currentIndex: snapshot.currentIndex,
    currentItem: snapshot.items.length > 0
      ? snapshot.items[Math.min(snapshot.currentIndex, snapshot.items.length - 1)]
      : null,
    addFiles,
    removeItem,
    removeAll,
    setEnabled,
    setCoverage,
    setSound,
    setDim,
    setIntervalSec,
    setCurrentIndex,
    next,
  };
}
