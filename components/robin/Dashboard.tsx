"use client";

import Link from "next/link";
import { useI18n } from "@/hooks/useI18n";
import { useEffect, useState } from "react";
import { localDate, parseLocalDate } from "@/extension/robin/dates";
import { AssistantBar } from "./AssistantBar";
import { CalendarPanel } from "./CalendarPanel";
import { LinksPanel } from "./LinksPanel";
import { TodoPanel } from "./TodoPanel";

/**
 * Rendered on the client so the heading follows the viewer's clock. The panels
 * still bucket todos against the server's local date, which is where `due` was
 * written — see app/api/robin/todos/route.ts.
 */
function useLocalToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToday(localDate());
    update();
    // Cheap enough to just re-check every minute so the heading survives midnight.
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

export function Dashboard() {
  const { t, locale } = useI18n();
  const today = useLocalToday();
  const heading = today
    ? parseLocalDate(today).toLocaleDateString(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    : "";

  return (
    // globals.css locks html/body to the viewport height with
    // overflow:hidden for the chat shell. This page is a document, so it
    // supplies its own scroll container rather than changing that shared rule.
    <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{t("sidebar.dashboard")}</h1>
          {/* Empty until the effect runs, so server and client markup agree. */}
          <p className="text-sm" style={{ color: "var(--text-muted)" }} suppressHydrationWarning>
            {heading}
          </p>
        </div>
        <nav className="flex items-baseline gap-4">
          <Link
            href="/dashboard/settings"
            className="text-sm hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            {t("robin.nav.settings")}
          </Link>
          <Link href="/" className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
            {t("robin.nav.chat")}
          </Link>
        </nav>
      </header>

      <AssistantBar />

      {/* Full width: the week and month grids need the whole page to stay legible. */}
      <CalendarPanel />

      <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-start">
        <TodoPanel />
        <LinksPanel />
      </div>
      </main>
    </div>
  );
}
