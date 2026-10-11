"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * The sidebar's brand with the files below the sessions (its toolbar row,
 * components/SessionSidebar.tsx; the tabs layout has its tabs there), with
 * the old sidebar's easter egg: a click scrambles "Pi Web" into the versions
 * (pi-web's, a "p", pi's) in the accent; they scramble back after
 * VERSION_SHOWN_MS, or at once on a second click.
 */

export const BRAND_TEXT = "Pi Web";
/** How long the versions stay, counted from the click that showed them. */
export const VERSION_SHOWN_MS = 3000;
/** The text settles left to right over its length times this many frames. */
export const SCRAMBLE_FRAMES_PER_CHAR = 4;
export const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

/** The versions as the brand shows them: "0.11.0p1.1.0". */
export function brandVersionText(appVersion: string | undefined, piVersion: string | undefined): string {
  return `${appVersion ?? "0.0.0"}p${piVersion ?? "0.0.0"}`;
}

/** How many frames `target` takes to settle. */
export function scrambleFrameCount(target: string): number {
  return target.length * SCRAMBLE_FRAMES_PER_CHAR;
}

/**
 * The scramble's text at `frame` (from 0): spaces kept, the characters
 * settling left to right, every one not yet settled random; `target` itself
 * from the last frame on. The length never changes, so in the brand's code
 * type neither does the width while it scrambles.
 */
export function scrambleFrame(target: string, frame: number, random: () => number = Math.random): string {
  const total = scrambleFrameCount(target);
  if (frame >= total) return target;
  const settled = Math.floor((frame / total) * target.length);
  let text = "";
  for (let index = 0; index < target.length; index++) {
    const char = target[index];
    text += char === " " || index < settled ? char : SCRAMBLE_CHARS[Math.floor(random() * SCRAMBLE_CHARS.length)];
  }
  return text;
}

/**
 * `target`, scrambled into place whenever it changes (never on mount): one
 * frame at a time until every character has settled. Under
 * prefers-reduced-motion the text is swapped at once.
 */
function useScramble(target: string): string {
  const [text, setText] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    if (shownRef.current === target) return;
    shownRef.current = target;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setText(target);
      return;
    }
    const totalFrames = scrambleFrameCount(target);
    let frame = 0;
    let request = 0;
    const step = () => {
      frame += 1;
      setText(scrambleFrame(target, frame));
      if (frame < totalFrames) request = requestAnimationFrame(step);
    };
    // The new length at once, so the row is fitted to it before it paints.
    setText(scrambleFrame(target, 0));
    request = requestAnimationFrame(step);
    return () => cancelAnimationFrame(request);
  }, [target]);
  return text;
}

export function PiWebTitle({ onWidthChange }: {
  /**
   * After a commit that changed the text's length (in its code type, its
   * width): the toolbar row fits its labels again, before that paints.
   */
  onWidthChange?: () => void;
}) {
  const { t } = useI18n();
  const [versionShown, setVersionShown] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const piVersion = process.env.NEXT_PUBLIC_PI_VERSION;
  const text = useScramble(versionShown ? brandVersionText(appVersion, piVersion) : BRAND_TEXT);

  useLayoutEffect(() => {
    onWidthChange?.();
  }, [text.length, onWidthChange]);

  useEffect(() => () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
  }, []);

  const handleClick = () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    revertTimerRef.current = null;
    if (versionShown) {
      setVersionShown(false);
      return;
    }
    setVersionShown(true);
    revertTimerRef.current = setTimeout(() => {
      revertTimerRef.current = null;
      setVersionShown(false);
    }, VERSION_SHOWN_MS);
  };

  // The name says what the click shows, so the versions need no click (and
  // no scrambled text is ever read out: the name stays the same).
  return (
    <button
      type="button"
      className={`sidebar-brand${versionShown ? " is-version" : ""}`}
      aria-label={t("sidebar.brandLabel", { app: appVersion ?? "0.0.0", pi: piVersion ?? "0.0.0" })}
      onClick={handleClick}
    >
      {text}
    </button>
  );
}
