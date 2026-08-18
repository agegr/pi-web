"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Job, JobStatus } from "@/extension/robin/jobs";

/**
 * The score badge is a three-step ladder on the one accent hue, not a
 * red/amber/green traffic light: those are reserved for alarm states, and a
 * 3.2 is not a warning — it is a job that scored 3.2. Below the push floor the
 * badge drops out of the accent entirely and reads as ordinary data.
 */
function scoreSurface(score: number | undefined, minScore: number) {
  if (typeof score !== "number") {
    return { background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)" };
  }
  // Solid, not another tint: at four steps the tint ladder stops separating,
  // and the top of the list is the one thing that has to read at a glance.
  if (score >= 4.5) return { background: "var(--accent)", color: "var(--on-accent)", border: "1px solid var(--accent)" };
  if (score >= minScore) return { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)" };
  return { background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)" };
}

export function JobRow({
  job,
  minScore,
  onStatus,
  onNote,
  onDelete,
  busy = false,
}: {
  job: Job;
  minScore: number;
  onStatus?: (status: JobStatus) => void;
  onNote?: (note: string) => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const meta = [
    job.location,
    job.postedAt ? t("robin.jobs.posted", { date: job.postedAt }) : "",
    job.source,
  ].filter(Boolean).join(" · ");

  return (
    <div
      className="group flex flex-col gap-1 rounded px-2 py-1.5"
      style={{ background: "var(--bg-subtle)" }}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="shrink-0 px-1.5 py-0.5 text-xs tabular-nums"
          style={{ ...scoreSurface(job.score, minScore), fontFamily: "var(--font-mono)" }}
          title={typeof job.score === "number" ? undefined : t("robin.jobs.unscored")}
        >
          {typeof job.score === "number" ? job.score.toFixed(1) : "—"}
        </span>
        {/* noreferrer matters: these URLs come from third-party job boards. */}
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-sm hover:underline"
          style={{ color: "var(--text)" }}
          title={job.url}
        >
          <span style={{ color: "var(--text-muted)" }}>{job.company}</span>
          {" — "}
          {job.title}
        </a>
        {job.status !== "new" && (
          <span className="pi-eyebrow shrink-0">
            {job.appliedAt && job.status === "applied"
              ? t("robin.jobs.appliedOn", { date: new Date(job.appliedAt).toLocaleDateString() })
              : t(`robin.jobs.status.${job.status}`)}
          </span>
        )}
      </div>

      {(meta || job.reason) && (
        <div className="flex flex-col gap-0.5 pl-9">
          {job.reason && (
            <p className="text-xs" style={{ color: "var(--copy)" }}>{job.reason}</p>
          )}
          {meta && <p className="pi-eyebrow truncate" title={meta}>{meta}</p>}
          {job.note && !editingNote && (
            <p className="text-xs" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>{job.note}</p>
          )}
          {job.flags && job.flags.length > 0 && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>{job.flags.join(" · ")}</p>
          )}
        </div>
      )}

      {onStatus && (
        // Dimmed rather than hover-revealed: a hover-only control cannot be
        // reached on a phone, and this dashboard is used on one.
        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-9 opacity-60 transition-opacity group-hover:opacity-100">
          {job.status !== "shortlist" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onStatus("shortlist")}
              className="ui-action pi-eyebrow disabled:opacity-40"
              data-state="accent"
            >
              {t("robin.jobs.action.shortlist")}
            </button>
          )}
          {job.status !== "applied" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onStatus("applied")}
              className="ui-action pi-eyebrow disabled:opacity-40"
            >
              {t("robin.jobs.action.applied")}
            </button>
          )}
          {job.status !== "dropped" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onStatus("dropped")}
              className="ui-action pi-eyebrow disabled:opacity-40"
            >
              {t("robin.jobs.action.drop")}
            </button>
          )}
          {job.status !== "new" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onStatus("new")}
              className="ui-action pi-eyebrow disabled:opacity-40"
            >
              {t("robin.jobs.action.reopen")}
            </button>
          )}
          {onNote && (editingNote ? (
            <input
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { onNote(draftNote); setEditingNote(false); }
                if (event.key === "Escape") setEditingNote(false);
              }}
              onBlur={() => { onNote(draftNote); setEditingNote(false); }}
              placeholder={t("robin.jobs.notePlaceholder")}
              aria-label={t("robin.jobs.note")}
              autoFocus
              className="min-w-0 flex-1 rounded px-1 py-0.5 text-xs outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)" }}
            />
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => { setDraftNote(job.note ?? ""); setEditingNote(true); }}
              className="ui-action pi-eyebrow disabled:opacity-40"
            >
              {job.note ? t("robin.jobs.editNote") : t("robin.jobs.addNote")}
            </button>
          ))}
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="ui-action pi-eyebrow ml-auto disabled:opacity-40"
              data-hover="danger"
            >
              {t("robin.jobs.action.delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
