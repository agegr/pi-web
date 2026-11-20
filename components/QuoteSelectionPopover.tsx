"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { buildQuotedSelection } from "@/lib/quoted-selection";
import { useI18n } from "@/hooks/useI18n";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { errorMessage } from "@/lib/errors";

interface Props {
  /** The transcript a selection must sit in for the popover to offer it. */
  rootRef: RefObject<HTMLElement | null>;
  chatInputRef?: RefObject<ChatInputHandle | null>;
  /** Ask in side chat; absent where a side chat cannot start (a side chat itself). */
  startSideChat?: (prompt: string, quote: string) => Promise<string | null | undefined>;
}

/**
 * The selected-text popover (Settings › General). Its state lives here, not in
 * ChatWindow: a selection made or cleared re-renders this popover alone, never
 * the transcript, whose render grows with every loaded turn.
 */
export function QuoteSelectionPopover({ rootRef, chatInputRef, startSideChat }: Props) {
  const { t } = useI18n();
  const [quotedSelection, setQuotedSelection] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);
  const [quoteInputOpen, setQuoteInputOpen] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quotePopoverRef = useRef<HTMLDivElement | null>(null);
  const quoteChatInputRef = useRef<ChatInputHandle | null>(null);
  const closeQuotedSelection = useCallback(() => {
    setQuotedSelection(null);
    setQuoteInputOpen(false);
    setQuoteError(null);
  }, []);

  useEffect(() => {
    if (quoteInputOpen) return;
    const captureQuotedSelection = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!selection || selection.isCollapsed || !range || !root.contains(range.commonAncestorContainer)) {
        setQuotedSelection(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        setQuotedSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setQuotedSelection({
        text,
        top: Math.min(window.innerHeight - 44, rect.bottom + 8),
        left: Math.max(64, Math.min(window.innerWidth - 64, rect.left + rect.width / 2)),
      });
    };
    document.addEventListener("pointerup", captureQuotedSelection);
    return () => document.removeEventListener("pointerup", captureQuotedSelection);
  }, [rootRef, quoteInputOpen]);

  useEffect(() => {
    if (!quoteInputOpen || !quotedSelection) return;
    quoteChatInputRef.current?.insertIfEmpty(buildQuotedSelection(quotedSelection.text));
  }, [quoteInputOpen, quotedSelection]);

  useLayoutEffect(() => {
    const popover = quotePopoverRef.current;
    if (!popover || !quotedSelection) return;
    const viewport = window.visualViewport;
    const position = () => {
      const rect = popover.getBoundingClientRect();
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      popover.style.top = `${Math.max(top + 8, Math.min(quotedSelection.top, top + (viewport?.height ?? window.innerHeight) - rect.height - 8))}px`;
      popover.style.left = `${Math.max(left + 8, Math.min(quotedSelection.left - rect.width / 2, left + (viewport?.width ?? window.innerWidth) - rect.width - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popover);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [quotedSelection, quoteInputOpen, quoteError]);

  useEffect(() => {
    if (!quotedSelection) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!quoteInputOpen && !quotePopoverRef.current?.contains(event.target as Node)) closeQuotedSelection();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (!quoteSubmitting) closeQuotedSelection();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [quotedSelection, quoteInputOpen, quoteSubmitting, closeQuotedSelection]);

  const quoteSelectionHere = useCallback(() => {
    if (!quotedSelection) return;
    chatInputRef?.current?.insertQuote(buildQuotedSelection(quotedSelection.text));
    // No `removeAllRanges()` here: inserting focuses the composer, and that
    // focus already collapses the page's selection. Calling it afterwards also
    // clears the composer's own selection and drops its caret to offset 0
    // (#1319), so the quote would be typed in front of instead of after.
    closeQuotedSelection();
  }, [chatInputRef, quotedSelection, closeQuotedSelection]);

  const askSelectionInSideChat = useCallback(async (prompt: string) => {
    if (!startSideChat || quoteSubmitting || !prompt.trim() || !quotedSelection) return;
    setQuoteSubmitting(true);
    setQuoteError(null);
    try {
      const refusal = await startSideChat(prompt, quotedSelection.text);
      if (!refusal) {
        closeQuotedSelection();
        return;
      }
      quoteChatInputRef.current?.restoreSubmission(prompt);
      setQuoteError(refusal);
    } catch (error) {
      quoteChatInputRef.current?.restoreSubmission(prompt);
      setQuoteError(errorMessage(error));
    } finally {
      setQuoteSubmitting(false);
    }
  }, [quotedSelection, quoteSubmitting, closeQuotedSelection, startSideChat]);

  if (!quotedSelection) return null;
  return createPortal(
    <div
      ref={quotePopoverRef}
      role={quoteInputOpen ? "dialog" : "toolbar"}
      aria-label={t(quoteInputOpen ? "chat.newQuoteChat" : "chat.selectionActions")}
      style={{
        position: "fixed",
        top: quotedSelection.top,
        left: quotedSelection.left,
        zIndex: 260,
        display: "flex",
        flexWrap: "wrap",
        gap: 3,
        width: quoteInputOpen ? "min(420px, calc(100vw - 16px))" : undefined,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(var(--app-viewport-height, 100dvh) - 16px)",
        overflowY: "auto",
        padding: quoteInputOpen ? 12 : 3,
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg)",
        boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
      }}
    >
      {quoteInputOpen ? (
        <fieldset
          disabled={quoteSubmitting}
          aria-busy={quoteSubmitting}
          style={{ width: "100%", minWidth: 0, margin: 0, padding: 0, border: "none", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600 }}>{t("chat.askInSideChat")}</span>
            <button type="button" className="file-viewer-icon-button" title={t("i18n.close")} aria-label={t("i18n.close")} disabled={quoteSubmitting} onClick={closeQuotedSelection} style={{ border: "none" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <ChatInput
            ref={quoteChatInputRef}
            compact
            onSend={askSelectionInSideChat}
            onAbort={closeQuotedSelection}
            isStreaming={false}
          />
          {quoteError && <div role="alert" style={{ color: "#dc2626", fontSize: 12, overflowWrap: "anywhere" }}>{quoteError}</div>}
        </fieldset>
      ) : <>
      <button
        type="button"
        className="file-viewer-icon-button"
        title={t("chat.quoteSelection")}
        aria-label={t("chat.quoteSelection")}
        onPointerDown={(event) => event.preventDefault()}
        onClick={quoteSelectionHere}
        style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: 12, fontWeight: 500 }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
          <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
        </svg>
        <span>{t("chat.quoteSelection")}</span>
      </button>
      {startSideChat && (
        <button
          type="button"
          className="file-viewer-icon-button"
          title={t("chat.askInSideChat")}
          aria-label={t("chat.askInSideChat")}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => { setQuoteInputOpen(true); window.getSelection()?.removeAllRanges(); }}
          style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: 12, fontWeight: 500 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-8 8H5.5a2 2 0 0 1-1.4-3.4A8 8 0 1 1 21 12z" />
          </svg>
          <span>{t("chat.askInSideChat")}</span>
        </button>
      )}
      </>}
    </div>,
    document.body,
  );
}
