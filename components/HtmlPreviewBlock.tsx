"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { CodeBlock } from "./MermaidBlock";

/** Collapsed height for html code blocks in the chat. */
export const HTML_CODE_MAX_HEIGHT = 300;

/**
 * A preview request emitted by an html code block. `key` uniquely identifies
 * the block (sessionId:entryId:blockIndex) so the right panel can dedupe tabs.
 */
export interface HtmlPreviewRequest {
  key: string;
  title: string;
  html: string;
}

/** Decode a small set of common HTML entities so titles read naturally. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

/**
 * Extract the `<title>` of an HTML document. Returns "" when missing/empty so
 * callers can fall back to a localized "untitled" label.
 */
export function extractHtmlTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return "";
  return decodeEntities(match[1].replace(/<[^>]+>/g, "").trim());
}

interface HtmlPreviewBlockProps {
  code: string;
  isStreaming?: boolean;
  /** Stable block identity (sessionId:entryId:blockIndex) for tab dedup. */
  previewKey?: string;
  onOpenPreview?: (request: HtmlPreviewRequest) => void;
}

/**
 * HTML code fence with a capped height ("expand full" toggle) and a "preview"
 * button that opens the content in the right-side preview panel.
 */
export function HtmlPreviewBlock({ code, isStreaming, previewKey, onOpenPreview }: HtmlPreviewBlockProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Detect whether the code exceeds the collapsed height. When expanded, keep
  // the collapse affordance available no matter how the content changes.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setOverflowing(expanded ? true : el.scrollHeight > el.clientHeight + 1);
  }, [code, expanded]);

  const openPreview = () => {
    if (!previewKey || !onOpenPreview || isStreaming) return;
    onOpenPreview({
      key: previewKey,
      title: extractHtmlTitle(code) || t("i18n.untitled"),
      html: code,
    });
  };

  const previewButton = (
    <button
      type="button"
      onClick={openPreview}
      disabled={isStreaming || !onOpenPreview || !previewKey}
      title={isStreaming ? t("i18n.previewAfterStreaming") : t("i18n.previewHtml")}
      className="markdown-code-action"
    >
      {t("i18n.previewHtml")}
    </button>
  );

  return (
    <div className="markdown-code-collapse">
      <div ref={bodyRef} className="markdown-code-collapse-body">
        <CodeBlock code={code} lang="html" maxHeight={expanded ? undefined : HTML_CODE_MAX_HEIGHT} headerAction={previewButton} />
      </div>
      {overflowing && (
        <>
          {!expanded && <div className="markdown-code-fade" aria-hidden="true" />}
          <button
            type="button"
            className="markdown-code-expand"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t("i18n.collapseCode") : t("i18n.expandCode")}
          </button>
        </>
      )}
    </div>
  );
}
