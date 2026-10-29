"use client";

import { useSyncExternalStore } from "react";

export const IMAGE_MAX_SIDE_DEFAULT = 2000;
export const IMAGE_MAX_SIDE_MIN = 256;
export const IMAGE_MAX_SIDE_MAX = 4096;
export const IMAGE_MAX_SIDE_STORAGE_KEY = "pi-image-max-side";
export const IMAGE_JPEG_QUALITY_DEFAULT = 0.95;
export const IMAGE_JPEG_QUALITY_MIN = 0.5;
export const IMAGE_JPEG_QUALITY_MAX = 1;
export const IMAGE_JPEG_QUALITY_STORAGE_KEY = "pi-image-jpeg-quality";

export interface ImageCompressionPreferences {
  maxSide: number;
  quality: number;
}

const DEFAULT_PREFERENCES: ImageCompressionPreferences = {
  maxSide: IMAGE_MAX_SIDE_DEFAULT,
  quality: IMAGE_JPEG_QUALITY_DEFAULT,
};

let preferences: ImageCompressionPreferences | null = null;
const listeners = new Set<() => void>();

export function clampImageMaxSide(value: unknown): number {
  const side = Number(value);
  if (!Number.isFinite(side)) return IMAGE_MAX_SIDE_DEFAULT;
  return Math.max(IMAGE_MAX_SIDE_MIN, Math.min(IMAGE_MAX_SIDE_MAX, Math.round(side)));
}

export function clampImageJpegQuality(value: unknown): number {
  const quality = Number(value);
  if (!Number.isFinite(quality)) return IMAGE_JPEG_QUALITY_DEFAULT;
  // Two decimals keep a stored value like 0.9500000001 from drifting the slider.
  const clamped = Math.max(IMAGE_JPEG_QUALITY_MIN, Math.min(IMAGE_JPEG_QUALITY_MAX, quality));
  return Math.round(clamped * 100) / 100;
}

function readStoredPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function getSnapshot(): ImageCompressionPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  if (!preferences) {
    preferences = {
      maxSide: clampImageMaxSide(readStoredPreference(IMAGE_MAX_SIDE_STORAGE_KEY)),
      quality: clampImageJpegQuality(readStoredPreference(IMAGE_JPEG_QUALITY_STORAGE_KEY)),
    };
  }
  return preferences;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setPreference(key: keyof ImageCompressionPreferences, value: number): void {
  const nextValue = key === "maxSide" ? clampImageMaxSide(value) : clampImageJpegQuality(value);
  preferences = { ...getSnapshot(), [key]: nextValue };
  try {
    window.localStorage.setItem(
      key === "maxSide" ? IMAGE_MAX_SIDE_STORAGE_KEY : IMAGE_JPEG_QUALITY_STORAGE_KEY,
      String(nextValue),
    );
  } catch {
    // Best-effort browser preference persistence.
  }
  listeners.forEach((listener) => listener());
}

/** Snapshot read for call sites outside React (the composer's attach path). */
export function getImageCompressionPreferences(): ImageCompressionPreferences {
  return getSnapshot();
}

const setMaxSide = (value: number) => setPreference("maxSide", value);
const setQuality = (value: number) => setPreference("quality", value);

export function useImageCompression() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PREFERENCES);
  return { ...snapshot, setMaxSide, setQuality };
}
