"use client";

import { useEffect } from "react";
import { useExtensionWindowTitle } from "@/lib/extension-window-title";

/**
 * Keeps `document.title` against Next's own writes: an extension's
 * `ctx.ui.setTitle()` for the session in view, else `fallback`. A leaf of its
 * own, so a title that changes many times a second re-renders this and not
 * AppShell.
 */
export function WindowTitle({ sessionId, fallback }: { sessionId: string | null; fallback: string }) {
  const title = useExtensionWindowTitle(sessionId) ?? fallback;

  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== title) document.title = title;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);

  return null;
}
