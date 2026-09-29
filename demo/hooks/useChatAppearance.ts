"use client";

import { useSyncExternalStore } from "react";

export const CHAT_CONTENT_WIDTH_DEFAULT = 820;
export const CHAT_CONTENT_WIDTH_MIN = 820;
export const CHAT_CONTENT_WIDTH_MAX = 2000;
export const CHAT_CONTENT_WIDTH_STORAGE_KEY = "pi-chat-content-width";
export const CHAT_CONTENT_FONT_SIZE_DEFAULT = 14;
export const CHAT_CONTENT_FONT_SIZE_MIN = 12;
export const CHAT_CONTENT_FONT_SIZE_MAX = 24;
export const CHAT_CONTENT_FONT_SIZE_STORAGE_KEY = "pi-chat-content-font-size";

interface ChatAppearance {
  width: number;
  fontSize: number;
}

const DEFAULT_APPEARANCE: ChatAppearance = {
  width: CHAT_CONTENT_WIDTH_DEFAULT,
  fontSize: CHAT_CONTENT_FONT_SIZE_DEFAULT,
};
let appearance: ChatAppearance | null = null;
const listeners = new Set<() => void>();

export function clampChatContentWidth(value: unknown): number {
  const width = Number(value);
  if (!Number.isFinite(width)) return CHAT_CONTENT_WIDTH_DEFAULT;
  return Math.max(CHAT_CONTENT_WIDTH_MIN, Math.min(CHAT_CONTENT_WIDTH_MAX, Math.round(width)));
}

export function clampChatContentFontSize(value: unknown): number {
  const size = Number(value ?? CHAT_CONTENT_FONT_SIZE_DEFAULT);
  if (!Number.isFinite(size)) return CHAT_CONTENT_FONT_SIZE_DEFAULT;
  return Math.max(CHAT_CONTENT_FONT_SIZE_MIN, Math.min(CHAT_CONTENT_FONT_SIZE_MAX, Math.round(size)));
}

function readStoredPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function applyAppearance({ width, fontSize }: ChatAppearance): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--chat-content-max-width", `${width}px`);
  document.documentElement.style.setProperty("--chat-content-font-size", `${fontSize}px`);
}

function getSnapshot(): ChatAppearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  if (!appearance) {
    appearance = {
      width: clampChatContentWidth(readStoredPreference(CHAT_CONTENT_WIDTH_STORAGE_KEY)),
      fontSize: clampChatContentFontSize(readStoredPreference(CHAT_CONTENT_FONT_SIZE_STORAGE_KEY)),
    };
    applyAppearance(appearance);
  }
  return appearance;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setPreference(key: keyof ChatAppearance, value: number): void {
  const nextValue = key === "width" ? clampChatContentWidth(value) : clampChatContentFontSize(value);
  appearance = { ...getSnapshot(), [key]: nextValue };
  applyAppearance(appearance);
  try {
    window.localStorage.setItem(
      key === "width" ? CHAT_CONTENT_WIDTH_STORAGE_KEY : CHAT_CONTENT_FONT_SIZE_STORAGE_KEY,
      String(nextValue),
    );
  } catch {
    // Best-effort browser preference persistence.
  }
  listeners.forEach((listener) => listener());
}

const setWidth = (value: number) => setPreference("width", value);
const setFontSize = (value: number) => setPreference("fontSize", value);

export function useChatAppearance() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_APPEARANCE);
  return { ...snapshot, setWidth, setFontSize };
}
