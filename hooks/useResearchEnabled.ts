"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "pi-research-enabled";
const CHANGE_EVENT = "pi-research-enabled-changed";

function readStored(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Absent means the feature stays on — it ships enabled by default.
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

/**
 * Research-mode preference (Settings → General). Persisted in localStorage
 * and synchronized across every hook instance on the page plus other tabs
 * via storage events, so toggling in settings hides the overlay immediately.
 */
export function useResearchEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(readStored());
    const sync = () => setEnabled(readStored());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Private mode — preference just lives for this session.
    }
    setEnabled(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [enabled, update];
}
