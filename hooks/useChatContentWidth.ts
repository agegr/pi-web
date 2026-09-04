"use client";

import { useCallback, useEffect, useState } from "react";

export const CHAT_CONTENT_WIDTH_DEFAULT = 820;
export const CHAT_CONTENT_WIDTH_MIN = 820;
export const CHAT_CONTENT_WIDTH_MAX = 2000;
export const CHAT_CONTENT_WIDTH_STORAGE_KEY = "pi-chat-content-width";

export function clampChatContentWidth(value: unknown): number {
  const width = Number(value);
  if (!Number.isFinite(width)) return CHAT_CONTENT_WIDTH_DEFAULT;
  return Math.max(CHAT_CONTENT_WIDTH_MIN, Math.min(CHAT_CONTENT_WIDTH_MAX, Math.round(width)));
}

function readChatContentWidth(): number {
  if (typeof window === "undefined") return CHAT_CONTENT_WIDTH_DEFAULT;
  try {
    return clampChatContentWidth(window.localStorage.getItem(CHAT_CONTENT_WIDTH_STORAGE_KEY));
  } catch {
    return CHAT_CONTENT_WIDTH_DEFAULT;
  }
}

function applyChatContentWidth(width: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--chat-content-max-width", `${width}px`);
}

export function useChatContentWidth() {
  const [width, setWidthState] = useState(CHAT_CONTENT_WIDTH_DEFAULT);

  useEffect(() => {
    const storedWidth = readChatContentWidth();
    setWidthState(storedWidth);
    applyChatContentWidth(storedWidth);
  }, []);

  const setWidth = useCallback((value: number) => {
    const nextWidth = clampChatContentWidth(value);
    setWidthState(nextWidth);
    applyChatContentWidth(nextWidth);
    try {
      window.localStorage.setItem(CHAT_CONTENT_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {
      // Best-effort browser preference persistence.
    }
  }, []);

  return { width, setWidth };
}
