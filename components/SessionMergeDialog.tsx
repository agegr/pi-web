"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { openStackedDialog } from "@/lib/stacked-dialog";
import type { SessionMergePreview } from "@/lib/session-merge";
import type { SessionInfo } from "@/lib/types";
import { CloseIcon, SpinnerIcon } from "./SidebarIcons";

/**
 * Merge sessions into one. The list shows every session of the sidebar; the
 * user picks at least two. While they pick, a preview call scores each pair
 * by the .jsonl content itself; the scores gate the Merge button — a pair
 * below the suggestion threshold needs an explicit "merge anyway" check, so
 * nothing destructive happens by accident. The merge replaces the sources
 * with one new session; `onMerged` receives it so the sidebar can open it.
 */

export function SessionMergeDialog({
  sessions,
  preselected,
  onClose,
  onMerged,
}: {
  sessions: SessionInfo[];
  /** Sessions already ticked when the dialog opens (a row's Merge…). */
  preselected?: ReadonlySet<string>;
  onClose: () => void;
  onMerged: (session: SessionInfo, deletedIds: string[]) => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(preselected ?? []));
  const [preview, setPreview] = useState<SessionMergePreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [merging, setMerging] = useState(false);
  const [force, setForce] = useState(false);
  const [sameCwdOnly, setSameCwdOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // True once a preview round-trip has failed. While true we let a click fall
  // through to the server's own validation instead of blocking forever.
  const [previewFailed, setPreviewFailed] = useState(false);

  // Selection below two: the preview is stale, the Merge button disabled.
  const selectedIds = useMemo(() => [...selected], [selected]);
  const enough = selectedIds.length >= 2;

  // Escape closes the dialog alone; focus moves in and back out of it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => openStackedDialog(document, dialogRef.current, () => onCloseRef.current()), []);

  // Preview the selected sessions whenever the selection settles. Debounced so
  // a row of checkbox clicks sends one evaluation.
  const previewAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enough) {
      setPreview(null);
      setPreviewFailed(false);
      setForce(false);
      setError(null);
      return;
    }
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewFailed(false);
    const timer = setTimeout(() => {
      setChecking(true);
      setError(null);
      void fetch("/api/sessions/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, preview: true }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({})) as SessionMergePreview & { message?: string };
          if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
          setPreview(data);
          setPreviewFailed(false);
          setForce(false);
          setError(null);
        })
        .catch((err: unknown) => {
          if ((err as Error).name === "AbortError") return;
          setPreview(null);
          setPreviewFailed(true);
          setError((err as Error).message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enough, JSON.stringify(selectedIds)]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return sessions;
    return sessions.filter((session) => (
      (session.name ?? "").toLowerCase().includes(lower)
      || session.firstMessage.toLowerCase().includes(lower)
      || session.id.toLowerCase().includes(lower)
    ));
  }, [sessions, query]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const forceBlocked = preview !== null && !preview.suggested && !force;

  const runMerge = async () => {
    if (!enough || merging) return;
    if (cwdBlocked) {
      setError(t("sidebar.mergeCrossCwdNotice"));
      return;
    }
    if (subagentBlocked) {
      setError(t("sidebar.mergeSubagentRejected"));
      return;
    }
    // Similarity only advises: an unconfirmed dissimilar merge is blocked by
    // the disabled button (forceBlocked); the checks here stay as a defense at
    // click time (keyboard/script paths) so a 409 can never be swallowed.
    if (preview === null) {
      if (checking || !previewFailed) {
        // The similarity round-trip is still in flight (or has not been tried
        // yet): show feedback instead of racing an unconfirmed merge against it.
        setError(t("sidebar.mergeStillChecking"));
        return;
      }
      // Preview failed; let the server re-evaluate for real so the user is
      // never stuck behind a dead preview.
    } else if (!preview.suggested && !force) {
      setError(t("sidebar.mergeNeedConfirm"));
      return;
    }
    setMerging(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, force, sameCwdOnly }),
      });
      const data = await res.json().catch(() => ({})) as { session?: SessionInfo; deletedIds?: string[]; message?: string };
      if (!res.ok || !data.session) throw new Error(data.message ?? `HTTP ${res.status}`);
      onMerged(data.session, data.deletedIds ?? []);
    } catch (err) {
      setError((err as Error).message);
      setMerging(false);
    }
  };

  // The first selected session is the main line: the merged file is written
  // beside it and takes its cwd. Show that to the user so a repeated merge
  // cannot silently keep absorbing sessions into the same tree.
  const mainSession = useMemo(() => (
    selectedIds.length > 0 ? sessions.find((s) => s.id === selectedIds[0]) : undefined
  ), [sessions, selectedIds]);

  // Same-directory mode (on by default) blocks mixing projects. Computed from
  // the session list locally so the button reacts before the preview round-trip
  // returns; the server enforces the same rule again at merge time.
  const sameCwdSelected = useMemo(() => {
    const picked = sessions.filter((s) => selected.has(s.id));
    if (picked.length < 2) return true;
    const first = picked[0].cwd;
    return picked.every((s) => s.cwd === first);
  }, [sessions, selected]);
  const cwdBlocked = enough && sameCwdOnly && !sameCwdSelected;
  // A subagent session carries pi-web:subagent metadata; merging it into a
  // normal one would be read back as that subagent and folded out of sight.
  // The list below filters its rows, and the server refuses anyway; this is
  // the button-side guard for a preselected subagent (a row's Merge…).
  const subagentBlocked = enough && preview !== null && preview.hasSubagent;

  const sessionTitle = (session: SessionInfo) => (
    session.name?.trim()
    || session.firstMessage.trim()
    || session.id.slice(0, 8)
  );

  return (
    <div
      role="presentation"
      className="session-merge-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget && !merging) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-merge-title"
        tabIndex={-1}
        className="session-merge-dialog"
      >
        <div className="session-merge-head">
          <div id="session-merge-title" className="session-merge-title">
            {t("sidebar.mergeSessions")}
          </div>
          <button
            type="button"
            className="session-merge-close"
            onClick={onClose}
            disabled={merging}
            aria-label={t("sidebar.cancel")}
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="session-merge-body">
          <div className="session-merge-hint">{t("sidebar.mergeSelectHint")}</div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("sidebar.searchSessions")}
            aria-label={t("sidebar.searchSessions")}
            className="session-merge-search"
          />
          {enough && (
            <div className="session-merge-preview" aria-live="polite">
              {mainSession && (
                <div className="session-merge-dest">
                  {t("sidebar.mergeDestHint", { cwd: mainSession.cwd })}
                </div>
              )}
              <label className="session-merge-same-cwd">
                <input
                  type="checkbox"
                  checked={sameCwdOnly}
                  onChange={(event) => setSameCwdOnly(event.target.checked)}
                  disabled={merging}
                />
                <span>{t("sidebar.mergeSameCwdOnly")}</span>
              </label>
              {cwdBlocked && (
                <div className="session-merge-error" role="alert">
                  {t("sidebar.mergeCrossCwdNotice")}
                </div>
              )}
              <div className="session-merge-preview-row">
                <span>{t("sidebar.mergeSimilarity")}</span>
                {checking && <SpinnerIcon size={13} className="session-merge-spinner" />}
              </div>
              {preview && (
                <>
                  <div className="session-merge-pairs">
                    {preview.pairs.map((pair) => (
                      <div key={`${pair.aId}:${pair.bId}`} className="session-merge-pair">
                        <div className="session-merge-bar" aria-hidden="true">
                          <div
                            className={`session-merge-bar-fill${pair.score >= 0.45 ? " is-strong" : pair.score >= 0.25 ? " is-mid" : " is-weak"}`}
                            style={{ width: `${Math.round(pair.score * 100)}%` }}
                          />
                        </div>
                        <span className="session-merge-pair-score">
                          {Math.round(pair.score * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                  {preview.suggested
                    ? (
                      <div className="session-merge-verdict is-suggested">
                        {t("sidebar.mergeSimilaritySuggest")}
                      </div>
                    )
                    : (
                      <>
                        <div className="session-merge-verdict is-warning">
                          {t("sidebar.mergeNotSimilar")}
                        </div>
                        <label className="session-merge-force">
                          <input
                            type="checkbox"
                            checked={force}
                            onChange={(event) => setForce(event.target.checked)}
                            disabled={merging}
                          />
                          <span>{t("sidebar.mergeConfirm")}</span>
                        </label>
                      </>
                    )}
                </>
              )}
              {error && <div className="session-merge-error" role="alert">{error}</div>}
            </div>
          )}
          {sessions.length === 0 ? (
            <div className="session-merge-empty">{t("sidebar.mergeNoSessions")}</div>
          ) : (
            <ul className="session-merge-list" role="group" aria-label={t("sidebar.mergeSelected")}>
              {filtered.map((session) => {
                const checked = selected.has(session.id);
                return (
                  <li key={session.id}>
                    <label className="session-merge-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(session.id)}
                        disabled={merging}
                      />
                      <span className="session-merge-item-text" title={session.cwd}>
                        <span className="session-merge-item-title">{sessionTitle(session)}</span>
                        <span className="session-merge-item-meta">
                          {session.cwd}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="session-merge-footer">
          <button
            type="button"
            className="session-merge-button"
            onClick={onClose}
            disabled={merging}
          >
            {t("sidebar.cancel")}
          </button>
          <button
            type="button"
            className="session-merge-button is-primary"
            onClick={() => { void runMerge(); }}
            disabled={!enough || merging || forceBlocked || cwdBlocked || subagentBlocked}
            aria-busy={merging || undefined}
          >
            {merging ? t("sidebar.mergeMerging") : t("sidebar.mergeSelected")}
          </button>
        </div>
      </div>
    </div>
  );
}
