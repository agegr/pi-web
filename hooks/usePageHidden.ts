"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * How long a page stays hidden before it lets go of the long-lived streams it can
 * reopen (#1283): the selected session's idle event stream and the file watch. A
 * quick tab switch tears nothing down.
 */
export const HIDDEN_PAGE_GRACE_MS = 30_000;

function subscribe(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

const getSnapshot = () => document.visibilityState === "hidden";
const getServerSnapshot = () => false;

/** True once the page has been hidden for `graceMs`; false again as soon as it shows. */
export function usePageHiddenFor(graceMs: number): boolean {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (!hidden) {
      setGraceOver(false);
      return;
    }
    const timer = setTimeout(() => setGraceOver(true), graceMs);
    return () => clearTimeout(timer);
  }, [graceMs, hidden]);
  return hidden && graceOver;
}
