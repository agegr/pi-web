"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { findReviewFile, getReviewNavigationItems, nextReviewItemKey, reviewCounts } from "@/lib/code-review";
import type { GitReviewDecision, GitReviewFile, GitReviewHunk, GitReviewResponse } from "@/lib/git-types";

interface Props {
  review: GitReviewResponse;
  onReviewChange: (review: GitReviewResponse) => void;
  onClose: () => void;
  onFilesChanged?: () => void;
}

type FinalDecision = Exclude<GitReviewDecision, "pending" | "mixed">;
type DecisionRequest = { decision: FinalDecision; fileId?: string; hunkId?: string; all?: boolean };

function decisionLabel(decision: GitReviewDecision): string {
  if (decision === "accepted") return "Accepted";
  if (decision === "rejected") return "Rejected";
  if (decision === "mixed") return "Mixed";
  return "Pending";
}

function DecisionButtons({ decision, context, disabled, busy, onDecide, compact = false }: {
  decision: GitReviewDecision;
  context: string;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  onDecide: (decision: FinalDecision) => void;
}) {
  return (
    <div className="review-decision-buttons" data-compact={compact || undefined}>
      <button
        type="button"
        className={`review-decision-button review-accept${decision === "accepted" ? " is-active" : ""}`}
        aria-label={`Accept ${context}`}
        aria-pressed={decision === "accepted"}
        disabled={disabled || busy}
        onClick={() => onDecide("accepted")}
      >
        <span aria-hidden="true">✓</span> Accept
      </button>
      <button
        type="button"
        className={`review-decision-button review-reject${decision === "rejected" ? " is-active" : ""}`}
        aria-label={`Reject ${context}`}
        aria-pressed={decision === "rejected"}
        disabled={disabled || busy}
        onClick={() => onDecide("rejected")}
      >
        <span aria-hidden="true">×</span> Reject
      </button>
    </div>
  );
}

function parseHunkStart(header: string): { old: number; next: number } {
  const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)?/);
  return { old: Number(match?.[1] ?? 0), next: Number(match?.[2] ?? 0) };
}

function HunkDiff({ hunk }: { hunk: GitReviewHunk }) {
  const start = parseHunkStart(hunk.header);
  let oldLine = start.old;
  let newLine = start.next;
  return (
    <div className="review-diff" aria-label={`Diff ${hunk.header}`}>
      <div className="review-hunk-header">{hunk.header}</div>
      {hunk.lines.map((line, index) => {
        const prefix = line[0] ?? " ";
        const text = line.slice(1);
        const type = prefix === "+" ? "added" : prefix === "-" ? "removed" : prefix === "\\" ? "meta" : "context";
        const oldNo = type === "added" || type === "meta" ? null : oldLine++;
        const newNo = type === "removed" || type === "meta" ? null : newLine++;
        const spokenType = type === "added" ? "Added" : type === "removed" ? "Removed" : type === "meta" ? "Metadata" : "Unchanged";
        return (
          <div className={`review-diff-line is-${type}`} key={`${index}:${line}`} aria-label={`${spokenType} line: ${text}`}>
            <span className="review-line-number" aria-hidden="true">{oldNo ?? ""}</span>
            <span className="review-line-number" aria-hidden="true">{newNo ?? ""}</span>
            <span className="review-line-prefix" aria-hidden="true">{prefix}</span>
            <code>{text || "\u00a0"}</code>
          </div>
        );
      })}
    </div>
  );
}

function FileSummary({ file }: { file: GitReviewFile }) {
  return (
    <div className="review-file-summary">
      <span className={`review-status-badge is-${file.status}`}>{file.status}</span>
      <span className="review-file-path" title={file.path}>{file.path}</span>
      <span className={`review-decision-state is-${file.decision}`}>{decisionLabel(file.decision)}</span>
    </div>
  );
}

export function CodeReviewPanel({ review, onReviewChange, onClose, onFilesChanged }: Props) {
  const items = useMemo(() => getReviewNavigationItems(review), [review]);
  const [currentKey, setCurrentKey] = useState<string | null>(() => nextReviewItemKey(review, null, { pendingOnly: true }));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentFile = findReviewFile(review, currentKey);
  const currentItem = items.find((item) => item.key === currentKey) ?? items[0] ?? null;
  const currentIndex = currentItem ? items.findIndex((item) => item.key === currentItem.key) : -1;
  const counts = reviewCounts(review);
  const liveRef = useRef<HTMLDivElement>(null);
  const hunkRefs = useRef(new Map<string, HTMLElement>());
  const reviewRef = useRef(review);
  reviewRef.current = review;

  useEffect(() => {
    if (currentKey && items.some((item) => item.key === currentKey)) return;
    setCurrentKey(nextReviewItemKey(review, null, { pendingOnly: true }) ?? items[0]?.key ?? null);
  }, [currentKey, items, review]);

  useEffect(() => {
    if (!currentKey) return;
    const target = hunkRefs.current.get(currentKey);
    target?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target?.focus({ preventScroll: true });
  }, [currentKey]);

  const decide = async (request: DecisionRequest, advanceFrom: string | null) => {
    if (busyKey) return;
    const operationKey = request.all ? "all" : `${request.fileId}:${request.hunkId ?? "file"}`;
    setBusyKey(operationKey);
    setError(null);
    try {
      const response = await fetch("/api/git/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", reviewId: review.id, revision: review.revision, ...request }),
      });
      const body = await response.json() as GitReviewResponse & { error?: string };
      if (!response.ok) {
        const message = body.error || `HTTP ${response.status}`;
        if (response.status === 409) {
          const reloadResponse = await fetch("/api/git/review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "get", reviewId: review.id }),
          });
          const reloaded = await reloadResponse.json() as GitReviewResponse & { error?: string };
          if (reloadResponse.ok && reloaded.id === reviewRef.current.id) {
            onReviewChange(reloaded);
            onFilesChanged?.();
            setError(`${message} The latest review state has been reloaded.`);
            return;
          }
        }
        throw new Error(message);
      }
      const current = reviewRef.current;
      if (body.id !== current.id || body.revision <= current.revision) return;
      onReviewChange(body);
      onFilesChanged?.();
      const next = nextReviewItemKey(body, advanceFrom, { pendingOnly: true });
      if (next) setCurrentKey(next);
      liveRef.current?.focus({ preventScroll: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const selectFile = (fileId: string) => {
    const item = items.find((candidate) => candidate.fileId === fileId && candidate.pending)
      ?? items.find((candidate) => candidate.fileId === fileId);
    setCurrentKey(item?.key ?? fileId);
  };

  if (!currentFile) {
    return <div className="review-empty">No code changes were captured for this prompt.</div>;
  }

  return (
    <section className="code-review-panel" aria-label="Code changes review">
      <header className="review-toolbar">
        <div className="review-title-row">
          <div>
            <strong>Review changes</strong>
            <span>{counts.pending > 0 ? `${counts.pending} of ${counts.total} pending` : "Review complete"}</span>
          </div>
          <div className="review-global-actions">
            <button type="button" aria-label="Accept all changes in this review" disabled={Boolean(busyKey) || counts.total === 0} onClick={() => void decide({ decision: "accepted", all: true }, currentKey)}>Accept all</button>
            <button type="button" aria-label="Reject all changes in this review" disabled={Boolean(busyKey) || counts.total === 0} onClick={() => void decide({ decision: "rejected", all: true }, currentKey)}>Reject all</button>
            <button type="button" aria-label="Close code review panel" title="Close review" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="review-nav-row">
          <label>
            <span className="sr-only">Review file</span>
            <select value={currentFile.id} onChange={(event) => selectFile(event.target.value)}>
              {review.files.map((file) => (
                <option key={file.id} value={file.id}>{decisionLabel(file.decision)} · {file.path}</option>
              ))}
            </select>
          </label>
          <span className="review-position">{Math.max(0, currentIndex) + 1} / {items.length}</span>
          <button type="button" aria-label="Previous change" title="Previous change" disabled={items.length < 2} onClick={() => setCurrentKey(nextReviewItemKey(review, currentKey, { direction: -1 }))}>←</button>
          <button type="button" aria-label="Next change" title="Next change" disabled={items.length < 2} onClick={() => setCurrentKey(nextReviewItemKey(review, currentKey, { direction: 1 }))}>→</button>
        </div>
        {error && <div className="review-error" role="alert">{error}</div>}
        <div ref={liveRef} className="sr-only" tabIndex={-1} aria-live="polite">{counts.pending > 0 ? `${counts.pending} changes pending` : "All changes reviewed"}</div>
      </header>

      <div className="review-scroll-area">
        <div className="review-file-header">
          <FileSummary file={currentFile} />
          <DecisionButtons
            compact
            context={`all changes in ${currentFile.path}`}
            decision={currentFile.decision}
            disabled={!currentFile.actionable}
            busy={Boolean(busyKey)}
            onDecide={(decision) => void decide({ decision, fileId: currentFile.id }, currentKey)}
          />
        </div>
        {currentFile.reason && <p className="review-file-note">{currentFile.reason}</p>}
        {!currentFile.actionable ? (
          <div className="review-unsupported">This file cannot be safely changed from the review panel. Inspect it manually before continuing.</div>
        ) : currentFile.granular ? (
          <div className="review-hunk-list">
            {currentFile.hunks.map((hunk, index) => {
              const key = `${currentFile.id}:${hunk.id}`;
              return (
                <article
                  className={`review-hunk${currentKey === key ? " is-current" : ""}`}
                  key={hunk.id}
                  tabIndex={-1}
                  ref={(element) => { if (element) hunkRefs.current.set(key, element); else hunkRefs.current.delete(key); }}
                  onClick={() => setCurrentKey(key)}
                >
                  <div className="review-hunk-actions">
                    <span>Block {index + 1} of {currentFile.hunks.length}</span>
                    <span className={`review-decision-state is-${hunk.decision}`}>{decisionLabel(hunk.decision)}</span>
                    <DecisionButtons
                      compact
                      context={`block ${index + 1} in ${currentFile.path}`}
                      decision={hunk.decision}
                      busy={Boolean(busyKey)}
                      onDecide={(decision) => void decide({ decision, fileId: currentFile.id, hunkId: hunk.id }, key)}
                    />
                  </div>
                  <HunkDiff hunk={hunk} />
                </article>
              );
            })}
          </div>
        ) : (
          <div className="review-file-level">
            <p>This change is available for whole-file review. Use Accept to keep it or Reject to restore the pre-prompt version.</p>
          </div>
        )}
      </div>
    </section>
  );
}
