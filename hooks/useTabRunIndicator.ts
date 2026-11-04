"use client";

import { useEffect, useState } from "react";
import { syncFaviconRunStatus } from "@/lib/favicon-badge";
import { TAB_SPINNER_INTERVAL_MS, formatTabTitle, tabRunStatus, type TabRunPhase } from "@/lib/tab-status";

/**
 * The tab's run marker: a spinner in the title while the selected chat works,
 * then the outcome's glyph there and its colour in the favicon. The title is
 * written here and nowhere else, so the head observer that keeps other writers
 * (an extension's setTitle) from sticking re-asserts this text and not a stale
 * one. A finished run's dot goes on the first look: the tab shown again, or the
 * first gesture after it appeared.
 */
export function useTabRunIndicator(baseTitle: string, phase: TabRunPhase): void {
  const [seen, setSeen] = useState<{ phase: TabRunPhase; acknowledged: boolean }>({ phase: "idle", acknowledged: false });
  if (seen.phase !== phase) {
    // A new run (or a new session) owes the dot again.
    setSeen({ phase, acknowledged: false });
  }
  const finished = phase === "done" || phase === "failed";
  const effective: TabRunPhase = finished && seen.acknowledged ? "idle" : phase;

  useEffect(() => {
    let frame = 0;
    const write = () => {
      const next = formatTabTitle(baseTitle, effective, frame);
      if (document.title !== next) document.title = next;
    };
    write();
    const observer = new MutationObserver(write);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    const timer = effective === "running"
      ? setInterval(() => {
        frame += 1;
        write();
      }, TAB_SPINNER_INTERVAL_MS)
      : null;
    return () => {
      observer.disconnect();
      if (timer !== null) clearInterval(timer);
    };
  }, [baseTitle, effective]);

  useEffect(() => {
    syncFaviconRunStatus(tabRunStatus(effective));
  }, [effective]);

  useEffect(() => () => {
    syncFaviconRunStatus(null);
  }, []);

  useEffect(() => {
    if (!finished) return;
    const acknowledge = () => {
      setSeen((current) => (current.acknowledged ? current : { ...current, acknowledged: true }));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") acknowledge();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pointerdown", acknowledge);
    window.addEventListener("keydown", acknowledge);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pointerdown", acknowledge);
      window.removeEventListener("keydown", acknowledge);
    };
  }, [effective, finished]);
}
