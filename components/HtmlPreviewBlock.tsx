"use client";

import { useI18n } from "@/hooks/useI18n";
import { CodeBlock } from "./MermaidBlock";

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
 * HTML code fence with a "preview" button that opens the content in the
 * right-side preview panel. Height collapse/expand is inherited from CodeBlock.
 */
export function HtmlPreviewBlock({ code, isStreaming, previewKey, onOpenPreview }: HtmlPreviewBlockProps) {
  const { t } = useI18n();

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

  return <CodeBlock code={code} lang="html" headerAction={previewButton} />;
}
