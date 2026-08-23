"use client";

import { useEffect, useId, useRef, useState } from "react";
import { parseLocalDate } from "@/extension/robin/dates";
import {
  eventEndDate,
  formatEventTime,
  isReadOnlyEvent,
  type DashboardEvent,
} from "@/extension/robin/events";
import { useI18n } from "@/hooks/useI18n";

function externalUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 split:grid-cols-[7rem_1fr] split:gap-3">
      <dt className="pi-eyebrow">{label}</dt>
      <dd className="min-w-0 text-sm" style={{ color: "var(--text)" }}>{children}</dd>
    </div>
  );
}

function LinkedText({ children }: { children: string }) {
  return children.split(/(https?:\/\/[^\s<]+)/g).map((part, index) => {
    const href = externalUrl(part);
    return href ? (
      <a
        key={`${index}:${href}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-[var(--border-strong)] underline-offset-4"
      >
        {part}
      </a>
    ) : part;
  });
}

export function EventDetailsDialog({
  event,
  onClose,
  onDelete,
}: {
  event: DashboardEvent;
  onClose: () => void;
  onDelete: (event: DashboardEvent) => Promise<boolean>;
}) {
  const { t, locale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [event.id]);

  const close = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  };

  const startDate = parseLocalDate(event.date).toLocaleDateString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const lastDate = eventEndDate(event);
  const dateLabel = lastDate === event.date
    ? startDate
    : `${startDate} – ${parseLocalDate(lastDate).toLocaleDateString(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}`;
  const calendarUrl = externalUrl(event.url);
  const meetingUrl = externalUrl(event.meetingUrl);
  const copyUrl = meetingUrl ?? calendarUrl;
  const locationUrl = event.location
    ? externalUrl(event.location)
      ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`
    : null;
  const readOnly = isReadOnlyEvent(event);

  return (
    <dialog
      ref={dialogRef}
      className="calendar-event-dialog"
      aria-labelledby={titleId}
      onCancel={(dialogEvent) => {
        dialogEvent.preventDefault();
        close();
      }}
      onClick={(dialogEvent) => {
        if (dialogEvent.target === dialogEvent.currentTarget) close();
      }}
    >
      <div className="flex max-h-[min(42rem,calc(100dvh-2rem))] flex-col bg-[var(--bg-panel)]">
        <header
          className="flex shrink-0 items-start justify-between gap-4 px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0">
            <p className="pi-eyebrow mb-1">
              {readOnly
                ? t("robin.calendar.readOnlySource", { calendar: event.calendar ?? "Google" })
                : t("robin.calendar.localEvent")}
            </p>
            <h2 id={titleId} className="text-xl leading-tight" style={{ color: "var(--text)" }}>
              {event.title}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label={t("i18n.close")}
            className="ui-action min-h-11 min-w-11 shrink-0 text-xl"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-4 py-4">
          <dl className="flex flex-col gap-4">
            <DetailRow label={t("robin.calendar.date")}>{dateLabel}</DetailRow>
            <DetailRow label={t("robin.calendar.time")}>
              {event.start ? formatEventTime(event) : t("robin.calendar.allDay")}
            </DetailRow>
            {event.location && (
              <DetailRow label={t("robin.calendar.location")}>
                <a
                  href={locationUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-[var(--border-strong)] underline-offset-4"
                >
                  {event.location}
                </a>
              </DetailRow>
            )}
            {event.organizer && (
              <DetailRow label={t("robin.calendar.organizer")}>{event.organizer}</DetailRow>
            )}
            {event.description && (
              <DetailRow label={t("robin.calendar.description")}>
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--copy)" }}>
                  <LinkedText>{event.description}</LinkedText>
                </p>
              </DetailRow>
            )}
          </dl>
        </div>

        <footer
          className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          {meetingUrl && (
            <a
              href={meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="ui-action ui-action--outline pi-bracket flex min-h-11 items-center px-3"
              data-state="accent"
            >
              {t("robin.calendar.joinMeeting")}
            </a>
          )}
          {calendarUrl && (
            <a
              href={calendarUrl}
              target="_blank"
              rel="noreferrer"
              className="ui-action ui-action--outline-soft flex min-h-11 items-center px-3"
            >
              {t("robin.calendar.openCalendar")}
            </a>
          )}
          {copyUrl && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(copyUrl).then(() => setCopied(true)).catch(() => {});
              }}
              className="ui-action ui-action--outline-soft min-h-11 px-3"
              aria-live="polite"
            >
              {copied ? t("i18n.copied") : t("robin.calendar.copyLink")}
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                setDeleting(true);
                void onDelete(event).then((deleted) => {
                  if (deleted) close();
                  else setDeleting(false);
                });
              }}
              className="ui-action ml-auto min-h-11 px-3 disabled:opacity-40"
              data-state="danger"
            >
              {deleting ? t("robin.calendar.deleting") : t("robin.calendar.delete")}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  );
}
