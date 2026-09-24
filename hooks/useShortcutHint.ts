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
 * @param options Set `shift` for chords that also hold Shift.
 */
export function useShortcutHint(key: string, options: { shift?: boolean } = {}): string | null {
  const [hint, setHint] = useState<string | null>(null);
  const shift = options.shift ?? false;

  useEffect(() => {
    const platform = typeof navigator === "undefined"
      ? ""
      : navigator.platform || navigator.userAgent;
    setHint(formatShortcutHint(key, platform, { shift }));
  }, [key, shift]);

  return hint;
}
