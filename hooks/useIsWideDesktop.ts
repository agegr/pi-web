"use client";

import { useSyncExternalStore } from "react";

const WIDE_DESKTOP_QUERY = "(min-width: 1280px)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(WIDE_DESKTOP_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(WIDE_DESKTOP_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsWideDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
