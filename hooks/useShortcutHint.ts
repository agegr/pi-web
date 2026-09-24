"use client";

import { useEffect, useState } from "react";
import { formatShortcutHint, formatShortcutKeys } from "@/lib/global-shortcuts";

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

/**
 * Platform-correct `aria-keyshortcuts` value for the same chord, e.g.
 * "Meta+K" on Apple platforms and "Control+K" elsewhere.
 *
 * Returns null on the first render for the same reason as `useShortcutHint`:
 * the platform is only known in the browser.
 *
 * @param key The non-modifier key, e.g. "k".
 * @param options Set `shift` for chords that also hold Shift.
 */
export function useShortcutKeys(key: string, options: { shift?: boolean } = {}): string | null {
  const [keys, setKeys] = useState<string | null>(null);
  const shift = options.shift ?? false;

  useEffect(() => {
    const platform = typeof navigator === "undefined"
      ? ""
      : navigator.platform || navigator.userAgent;
    setKeys(formatShortcutKeys(key, platform, { shift }));
  }, [key, shift]);

  return keys;
}
