"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import {
  countReviewActions,
  MAIL_CATEGORIES,
  type MailCategory,
  type MailReview,
} from "@/extension/robin/mail";
import { ChatLink } from "./ChatLink";
import { GoogleConnect } from "./GoogleConnect";
import { usePolledResource } from "./usePolledResource";

interface GmailResponse {
  connected: boolean;
  today: string;
  review: MailReview | null;
}

function formatDate(iso: string, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Today's mail, categorised — not a raw inbox.
 *
 * The categorised review is produced by the mail-review turn (see
 * `/api/robin/gmail/check`): the agent reads today's mail, files each message
 * into a bucket, and creates the todo or calendar event that confirmations,
 * appointments, and deadlines call for. This page shows that review; the raw
 * list has no place here because "a list of emails" is what Gmail already does.
 */
export function GmailBoard() {
  const { t, locale } = useI18n();
  const { data, error, refresh } = usePolledResource<GmailResponse>("/api/robin/gmail", 30_000);

  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const review = data?.review ?? null;

  const byCategory = useMemo(() => {
    const buckets = new Map<MailCategory, MailReview["items"]>();
    for (const item of review?.items ?? []) {
      const list = buckets.get(item.category) ?? [];
      list.push(item);
      buckets.set(item.category, list);
    }
    return buckets;
  }, [review]);

  const attention = useMemo(
    () => (review?.items ?? []).filter((item) => item.category !== "other").length,
    [review],
  );
  const actions = review ? countReviewActions(review) : { todos: 0, events: 0 };

  const check = async () => {
    setChecking(true);
    setActionError(null);
    try {
      const response = await fetch("/api/robin/gmail/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: locale.startsWith("zh") ? "zh" : "en" }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      // The report is persisted server-side into the review; re-fetch it here.
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="robin-dashboard flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 desktop:p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {t("robin.gmail.title")}
            </h1>
            <p className="pi-eyebrow">{t("robin.gmail.subtitle")}</p>
          </div>
          <nav className="flex items-baseline gap-3">
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking || !data?.connected}
              className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
              data-state="accent"
            >
              {checking ? t("robin.gmail.checking") : t("robin.gmail.check")}
            </button>
            <Link href="/dashboard" className="ui-action pi-chrome-label pi-bracket text-xs">
              {t("robin.nav.back")}
            </Link>
            <ChatLink />
          </nav>
        </header>

        {(actionError || error) && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>{actionError ?? error}</p>
        )}

        {review?.report && (
          <section
            className="flex flex-col gap-1 rounded-lg p-4"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
          >
            <span className="pi-eyebrow">{t("robin.gmail.lastReport")}</span>
            <div style={{ color: "var(--text-muted)" }}>
              <MarkdownBody>{review.report}</MarkdownBody>
            </div>
          </section>
        )}

        {data?.connected && !review && (
          <section
            className="flex flex-col items-start gap-2 rounded-lg p-4"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("robin.gmail.empty")}
            </p>
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking}
              className="ui-action pi-chrome-label pi-bracket text-xs"
              data-state="accent"
            >
              {checking ? t("robin.gmail.checking") : t("robin.gmail.check")}
            </button>
          </section>
        )}

        {review && (
          <>
            {/* ── today at a glance ──────────────────────────────────── */}
            <section
              className="grid gap-3 rounded-lg p-4 split:grid-cols-3"
              style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="pi-eyebrow">{t("robin.gmail.todayCount")}</span>
                <span className="text-2xl tabular-nums" style={{ color: "var(--text)" }}>
                  {review.items.length}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="pi-eyebrow">{t("robin.gmail.attentionCount")}</span>
                <span className="text-2xl tabular-nums" style={{ color: attention > 0 ? "var(--accent)" : "var(--text)" }}>
                  {attention}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="pi-eyebrow">{t("robin.gmail.autoCreated")}</span>
                <span className="text-sm tabular-nums" style={{ color: "var(--text)" }}>
                  {t("robin.gmail.createdSummary", { todos: String(actions.todos), events: String(actions.events) })}
                </span>
              </div>
            </section>

            {/* ── categorised mail ───────────────────────────────────── */}
            {MAIL_CATEGORIES.map((category) => {
              const items = byCategory.get(category);
              if (!items || items.length === 0) return null;
              return (
                <section
                  key={category}
                  className="flex flex-col gap-2 rounded-lg p-4"
                  style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
                >
                  <h2 className="pi-label">
                    {t(`robin.gmail.category.${category}`)}
                    <span className="ml-2 tabular-nums" style={{ color: "var(--text-dim)" }}>
                      {items.length}
                    </span>
                  </h2>
                  <div className="flex flex-col">
                    {items.map((item) => (
                      <a
                        key={item.id}
                        href={`https://mail.google.com/mail/u/0/#all/${item.threadId || item.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col gap-0.5 border-b px-2 py-2 text-sm last:border-b-0"
                        style={{ borderColor: "var(--border)", color: "var(--text)" }}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate font-medium" style={{ color: "var(--text)" }}>
                            {item.subject}
                          </span>
                          <span className="shrink-0 tabular-nums text-xs" style={{ color: "var(--text-dim)" }}>
                            {formatDate(item.date, locale)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-xs" style={{ color: "var(--text-dim)" }}>
                            {item.from || "(unknown sender)"}
                          </span>
                          {item.action !== "none" && (
                            <span
                              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase"
                              style={{ background: "var(--bg-subtle)", color: "var(--accent)" }}
                            >
                              {t(`robin.gmail.action.${item.action}`)}
                            </span>
                          )}
                        </div>
                        {item.summary && (
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {item.summary}
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}

        {/* Account-level connect state, at the bottom: it is one-time setup,
            not something you read every day. */}
        <section
          className="flex flex-col gap-2 rounded-lg p-4"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
        >
          <GoogleConnect
            status={data ? { connected: data.connected } : undefined}
            onChanged={() => void refresh()}
          />
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            {t("robin.gmail.readonlyNote")}
          </p>
        </section>
      </main>
    </div>
  );
}
