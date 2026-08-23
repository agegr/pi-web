"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { getInitialNavigation } from "@/lib/initial-navigation";
import { useEffect, useState } from "react";
import { localDate, parseLocalDate } from "@/extension/robin/dates";
import { AssistantBar } from "./AssistantBar";
import { CalendarPanel } from "./CalendarPanel";
import { JobsPanel } from "./JobsPanel";
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
  const searchParams = useSearchParams();
  const { sessionId, requestedCwd: cwd } = getInitialNavigation(searchParams);
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
    <div className="robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <header className="robin-dashboard-header sticky top-0" style={{ zIndex: "var(--z-sticky)" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-2 desktop:px-6">
          <AssistantBar />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 desktop:p-6">
        {/* pi's page head: an italic serif title over a tracked mono dateline. */}
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {t("sidebar.dashboard")}
            </h1>
            {/* Empty until the effect runs, so server and client markup agree. */}
            <p className="pi-eyebrow" suppressHydrationWarning>
              {heading}
            </p>
          </div>
          <nav className="flex items-baseline gap-3">
            <Link href="/dashboard/gmail" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 11 }}>
              {t("robin.nav.gmail")}
            </Link>
            <Link href="/dashboard/jobs" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 11 }}>
              {t("robin.nav.jobs")}
            </Link>
            <Link href="/dashboard/settings" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 11 }}>
              {t("robin.nav.settings")}
            </Link>
            <Link
              href={{
                pathname: "/",
                query: sessionId
                  ? { session: sessionId }
                  : cwd
                    ? { cwd }
                    : {},
              }}
              className="ui-action pi-chrome-label pi-bracket"
              data-state="accent"
              style={{ fontSize: 11 }}
            >
              {t("robin.nav.chat")}
            </Link>
          </nav>
        </div>

        {/* Full width: the week and month grids need the whole page to stay legible. */}
        <CalendarPanel />

        {/* Each section gets a full row; the links collection can grow without
            making the todo list look like a narrow sidebar. */}
        <div className="flex flex-col gap-4">
          <TodoPanel />
          {/* Between the todos and the links: the morning push lands here, and
              this is the row you scan before deciding what today looks like. */}
          <JobsPanel />
          <LinksPanel />
        </div>
      </main>
    </div>
  );
}
