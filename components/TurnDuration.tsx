"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { TurnTiming } from "@/lib/turn-timing";

export function formatTurnDuration(milliseconds: number, locale: string): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  if (locale.startsWith("zh")) {
    return `${hours ? `${hours}${locale === "zh-TW" ? "小時" : "小时"}` : ""}${minutes || hours ? `${minutes}分` : ""}${remainder}秒`;
  }
  return [hours ? `${hours}h` : "", minutes || hours ? `${minutes}m` : "", `${remainder}s`].filter(Boolean).join(" ");
}

/** Keep the ticking state local so long transcripts do not rerender every second. */
export function TurnDuration({ timing, live = false, elapsedOnly = false }: { timing: TurnTiming; live?: boolean; elapsedOnly?: boolean }) {
  const { t, locale } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const running = live && timing.endedAt === undefined;
  useEffect(() => {
    if (!running) return;
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [running, timing.id]);

  if (!running && timing.endedAt === undefined) return null;
  const duration = formatTurnDuration((timing.endedAt ?? now) - timing.startedAt, locale);
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {elapsedOnly ? duration : t(running ? "chat.turnRunningDuration" : "chat.turnDuration", { duration })}
    </span>
  );
}
