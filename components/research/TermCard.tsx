"use client";

import { memo, useEffect, useRef, useState } from "react";
import { MarkdownBody } from "../MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { RESEARCH_DEPTH_ORDER, type ResearchDepth, type ResearchNode } from "@/lib/term-research";

export interface TermCardPosition {
  x: number;
  y: number;
}

interface Props {
  node: ResearchNode;
  /** Chain from the root term down to this node (inclusive). */
  path: ResearchNode[];
  position: TermCardPosition;
  zIndex: number;
  /** Briefly true after the card is reopened from the concept chain. */
  flashing?: boolean;
  modelLabel?: string;
  onClose: () => void;
  onDepthChange: (depth: ResearchDepth) => void;
  onRetry: () => void;
  onPositionChange?: (position: TermCardPosition) => void;
  onAskFollowup?: (question: string) => boolean;
  onWebToggle?: (web: boolean) => void;
}

const DEPTH_LABEL_KEY: Record<ResearchDepth, string> = {
  brief: "research.depthBrief",
  standard: "research.depthStandard",
  deep: "research.depthDeep",
};

/**
 * One AI term explanation. The body renders through MarkdownBody, so any
 * term inside it is selectable again — that is what makes the chain
 * recursive. The card carries data-research-node-id so the overlay can
 * attach nested lookups to this node as their parent, and its header acts
 * as a drag handle (buttons excluded).
 */
export const TermCard = memo(function TermCard({
  node,
  path,
  position,
  zIndex,
  flashing,
  modelLabel,
  onClose,
  onDepthChange,
  onRetry,
  onPositionChange,
  onAskFollowup,
  onWebToggle,
}: Props) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const [followupDraft, setFollowupDraft] = useState("");
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const thinkingRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const isLoading = node.status === "loading";
  const hasError = node.status === "error";
  const isStreaming = isLoading && node.explanation.length > 0;
  const showThinking = isLoading && !!node.thinking;
  const followups = node.followups ?? [];
  const followupBusy = followups.some((f) => f.status === "loading");

  // Keep the live reasoning view pinned to the newest line.
  useEffect(() => {
    const el = thinkingRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [node.thinking]);

  // While a follow-up answer streams in, keep it in view.
  const lastFollowup = followups[followups.length - 1];
  useEffect(() => {
    if (lastFollowup?.status !== "loading") return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastFollowup?.answer, lastFollowup?.status]);

  const submitFollowup = () => {
    const trimmed = followupDraft.trim();
    if (!trimmed || followupBusy || isLoading) return;
    if (onAskFollowup?.(trimmed)) setFollowupDraft("");
  };

  const startDrag = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: position.x, baseY: position.y };
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (d) onPositionChange?.({ x: d.baseX + ev.clientX - d.startX, y: d.baseY + ev.clientY - d.startY });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className={`research-card${dragging ? " is-dragging" : ""}${flashing ? " is-flashing" : ""}`}
      data-research-node-id={node.id}
      role="dialog"
      aria-label={node.term}
      style={{ left: position.x, top: position.y, zIndex }}
    >
      <div className="research-glow" aria-hidden="true" />
      <div
        className="flex cursor-grab items-center gap-2 border-b border-[var(--border)] px-3 py-2 research-drag-handle"
        onMouseDown={startDrag}
        onDoubleClick={() => onPositionChange?.({ x: -1, y: -1 })}
      >
        <div className="flex min-w-0 flex-1 flex-col select-none">
          <div
            className="truncate text-[10px] leading-tight text-[var(--text-dim)]"
            title={path.map((n) => n.term).join(" › ")}
          >
            {path.length > 1 && (
              <span>
                {path.slice(0, -1).map((n) => n.term).join(" › ")}
                <span className="mx-1">›</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold leading-tight text-[var(--text)]" title={node.term}>
              {node.term}
            </span>
            {isLoading && (
              <svg className="research-spinner" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-9-9" />
              </svg>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => onWebToggle?.(!node.web)}
            title={`${t("research.webSearch")}${node.web === true && node.webStatus === "failed" ? ` (${t("research.webFailed")})` : ""}`}
            aria-label={t("research.webSearch")}
            aria-pressed={node.web === true}
            className="research-web-toggle"
            data-active={node.web === true}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
            </svg>
          </button>
          {RESEARCH_DEPTH_ORDER.map((depth) => (
            <button
              key={depth}
              type="button"
              disabled={isLoading}
              onClick={() => onDepthChange(depth)}
              title={t(DEPTH_LABEL_KEY[depth])}
              className="research-depth-pill"
              data-active={node.depth === depth}
            >
              {t(DEPTH_LABEL_KEY[depth]).slice(0, 1)}
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            title={t("research.close")}
            aria-label={t("research.close")}
            className="ml-1 grid h-6 w-6 place-items-center rounded-md border-none bg-transparent text-[var(--text-dim)] cursor-pointer hover:text-[var(--text)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="research-card-body" ref={bodyRef}>
        {showThinking && (
          <div className="research-thinking" ref={thinkingRef}>
            <div className="research-thinking-title">
              <svg className="research-spinner" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-9-9" />
              </svg>
              {t("research.thinking")}
            </div>
            <div className="research-thinking-text">{node.thinking}</div>
          </div>
        )}
        {hasError && (
          <div className="research-error">
            <span>{node.error ?? t("research.unknownError")}</span>
            <button type="button" onClick={onRetry} className="research-retry">
              {t("research.retry")}
            </button>
          </div>
        )}
        {!hasError && node.explanation.length === 0 && isLoading && !showThinking && (
          <div className="flex flex-col gap-2 py-1" aria-hidden="true">
            <div className="research-shimmer h-3 w-11/12" />
            <div className="research-shimmer h-3 w-full" />
            <div className="research-shimmer h-3 w-4/5" />
            <div className="research-shimmer h-3 w-3/5" />
          </div>
        )}
        {node.explanation.length > 0 && (
          <MarkdownBody className="markdown-research-card">{node.explanation}</MarkdownBody>
        )}
        {isStreaming && <span className="research-caret" aria-hidden="true" />}

        {followups.map((f) => (
          <div key={f.id} className="research-followup">
            <div className="research-followup-q">
              <span className="research-followup-tag">{t("research.followupQ")}</span>
              <span className="min-w-0 flex-1 break-words">{f.question}</span>
            </div>
            {f.status === "error" ? (
              <div className="research-error">
                <span>{f.error ?? t("research.unknownError")}</span>
              </div>
            ) : (
              <div className="research-followup-a">
                {f.answer.length > 0
                  ? <MarkdownBody className="markdown-research-card">{f.answer}</MarkdownBody>
                  : <div className="research-shimmer h-3 w-3/4" aria-hidden="true" />}
                {f.status === "loading" && f.answer.length > 0 && <span className="research-caret" aria-hidden="true" />}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="research-followup-bar">
        <input
          type="text"
          className="research-followup-input"
          placeholder={t("research.followupPlaceholder")}
          value={followupDraft}
          disabled={followupBusy || isLoading || hasError}
          onChange={(e) => setFollowupDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submitFollowup();
            }
          }}
        />
        <button
          type="button"
          className="research-followup-send"
          disabled={!followupDraft.trim() || followupBusy || isLoading || hasError}
          onClick={submitFollowup}
          title={t("research.followupSend")}
          aria-label={t("research.followupSend")}
        >
          {followupBusy ? (
            <svg className="research-spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-9-9" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>

      <div className="flex items-center border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--text-dim)]">
        <span>{t("research.explainHint")}</span>
        {modelLabel && (
          <span className="ml-auto flex-shrink-0 pl-2 truncate" title={modelLabel}>
            {modelLabel}
          </span>
        )}
      </div>
    </div>
  );
});
