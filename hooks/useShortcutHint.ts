"use client";

import { useEffect, useState } from "react";
import { formatShortcutHint } from "@/lib/global-shortcuts";

/**
 * Platform-correct display string for a primary-modifier shortcut, such as
 * "⌘K" on Apple platforms or "Ctrl+K" elsewhere.
 *
 * Returns null on the first render so the server-rendered markup and the
 * hydrated client markup agree; the resolved hint appears one render later.
 *
 * @param key The non-modifier key, e.g. "k".
 */
export function useShortcutHint(key: string): string | null {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const platform = typeof navigator === "undefined"
      ? ""
      : navigator.platform || navigator.userAgent;
    setHint(formatShortcutHint(key, platform));
  }, [key]);

  return hint;
}
