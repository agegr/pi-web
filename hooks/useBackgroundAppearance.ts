"use client";

import { useSyncExternalStore } from "react";

export const BACKGROUND_HISTORY_LIMIT = 20;
export const BACKGROUND_OPACITY_DEFAULT = 30;
export const BACKGROUND_OPACITY_MIN = 0;
export const BACKGROUND_OPACITY_MAX = 100;
export const BACKGROUND_ACTIVE_STORAGE_KEY = "pi-background-active";
export const BACKGROUND_OPACITY_STORAGE_KEY = "pi-background-opacity";

const DATABASE_NAME = "pi-web-backgrounds";
const STORE_NAME = "images";
const DATABASE_VERSION = 1;

type StoredBackground = {
  id: string;
  name: string;
  createdAt: number;
  blob: Blob;
};

export type BackgroundHistoryItem = {
  id: string;
  name: string;
  createdAt: number;
  url: string;
};

type BackgroundAppearance = {
  activeId: string | null;
  opacity: number;
  history: readonly BackgroundHistoryItem[];
  loading: boolean;
  error: string | null;
};

const SERVER_SNAPSHOT: BackgroundAppearance = {
  activeId: null,
  opacity: BACKGROUND_OPACITY_DEFAULT,
  history: [],
  loading: true,
  error: null,
};

let snapshot: BackgroundAppearance = SERVER_SNAPSHOT;
let initialization: Promise<void> | null = null;
let database: Promise<IDBDatabase> | null = null;
const listeners = new Set<() => void>();

export function clampBackgroundOpacity(value: unknown): number {
  const number = Number(value ?? BACKGROUND_OPACITY_DEFAULT);
  if (!Number.isFinite(number)) return BACKGROUND_OPACITY_DEFAULT;
  return Math.max(BACKGROUND_OPACITY_MIN, Math.min(BACKGROUND_OPACITY_MAX, Math.round(number)));
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Browser preferences remain usable for the current page when storage is blocked.
  }
}

function applyAppearance(next: BackgroundAppearance): void {
  if (typeof document === "undefined") return;
  const active = next.history.find((item) => item.id === next.activeId);
  const root = document.documentElement;
  if (active) {
    root.style.setProperty("--app-background-image", `url(${JSON.stringify(active.url)})`);
    root.style.setProperty("--app-background-opacity", String(next.opacity / 100));
    root.dataset.appBackground = "true";
  } else {
    root.style.removeProperty("--app-background-image");
    root.style.removeProperty("--app-background-opacity");
    delete root.dataset.appBackground;
  }
}

function update(next: BackgroundAppearance): void {
  snapshot = next;
  applyAppearance(next);
  listeners.forEach((listener) => listener());
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open background storage"));
  });
  return database;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Background storage request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Background storage transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Background storage transaction aborted"));
  });
}

async function readAllRecords(): Promise<StoredBackground[]> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readonly");
  return requestResult(transaction.objectStore(STORE_NAME).getAll()) as Promise<StoredBackground[]>;
}

function revokeHistory(history: readonly BackgroundHistoryItem[], keepIds: ReadonlySet<string> = new Set()): void {
  for (const item of history) {
    if (!keepIds.has(item.id)) URL.revokeObjectURL(item.url);
  }
}

function historyFromRecords(records: StoredBackground[], previous: readonly BackgroundHistoryItem[]): BackgroundHistoryItem[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const history = records
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, BACKGROUND_HISTORY_LIMIT)
    .map((record) => {
      const existing = previousById.get(record.id);
      return existing ?? {
        id: record.id,
        name: record.name,
        createdAt: record.createdAt,
        url: URL.createObjectURL(record.blob),
      };
    });
  revokeHistory(previous, new Set(history.map((item) => item.id)));
  return history;
}

async function initialize(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    if (!("indexedDB" in window)) throw new Error("IndexedDB is unavailable");
    const records = await readAllRecords();
    const history = historyFromRecords(records, snapshot.history);
    const storedActiveId = readStorage(BACKGROUND_ACTIVE_STORAGE_KEY);
    const activeId = history.some((item) => item.id === storedActiveId) ? storedActiveId : null;
    if (!activeId) writeStorage(BACKGROUND_ACTIVE_STORAGE_KEY, null);
    update({
      activeId,
      opacity: clampBackgroundOpacity(readStorage(BACKGROUND_OPACITY_STORAGE_KEY)),
      history,
      loading: false,
      error: null,
    });
  })().catch((cause) => {
    update({
      ...snapshot,
      loading: false,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  });
  return initialization;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void initialize();
  return () => listeners.delete(listener);
}

function getSnapshot(): BackgroundAppearance {
  return snapshot;
}

function getServerSnapshot(): BackgroundAppearance {
  return SERVER_SNAPSHOT;
}

async function addBackground(file: File): Promise<void> {
  await initialize();
  if (!file.type.startsWith("image/")) throw new Error("The selected file is not an image");
  const record: StoredBackground = {
    id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name || "background",
    createdAt: Date.now(),
    blob: file,
  };
  const existingRecords = await readAllRecords();
  const records = [record, ...existingRecords.filter((item) => item.id !== record.id)]
    .sort((left, right) => right.createdAt - left.createdAt);
  const removed = records.slice(BACKGROUND_HISTORY_LIMIT);
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  store.put(record);
  removed.forEach((item) => store.delete(item.id));
  await transactionDone(transaction);

  const history = historyFromRecords(records.slice(0, BACKGROUND_HISTORY_LIMIT), snapshot.history);
  writeStorage(BACKGROUND_ACTIVE_STORAGE_KEY, record.id);
  update({ ...snapshot, activeId: record.id, history, loading: false, error: null });
}

async function removeBackground(id: string): Promise<void> {
  await initialize();
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(id);
  await transactionDone(transaction);
  const removed = snapshot.history.find((item) => item.id === id);
  if (removed) URL.revokeObjectURL(removed.url);
  const activeId = snapshot.activeId === id ? null : snapshot.activeId;
  if (!activeId) writeStorage(BACKGROUND_ACTIVE_STORAGE_KEY, null);
  update({ ...snapshot, activeId, history: snapshot.history.filter((item) => item.id !== id), error: null });
}

function selectBackground(id: string | null): void {
  if (id !== null && !snapshot.history.some((item) => item.id === id)) return;
  writeStorage(BACKGROUND_ACTIVE_STORAGE_KEY, id);
  update({ ...snapshot, activeId: id });
}

function setOpacity(value: number): void {
  const opacity = clampBackgroundOpacity(value);
  writeStorage(BACKGROUND_OPACITY_STORAGE_KEY, String(opacity));
  update({ ...snapshot, opacity });
}

export function useBackgroundAppearance() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    ...current,
    addBackground,
    removeBackground,
    selectBackground,
    setOpacity,
  };
}
