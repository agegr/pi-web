"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SkillContentResponse } from "@/lib/api-types";
import { parseFrontmatter } from "@/lib/frontmatter";
import { resolveSkillDocumentLink } from "@/lib/skill-document-links";
import { MarkdownBody } from "./MarkdownBody";
import { ConfigButton } from "./SettingsUi";

export function skillInstructionsBody(content: string): string {
  return parseFrontmatter(content).rest.trim();
}

export const SKILL_DOCUMENT_HISTORY_LIMIT = 20;

interface DocumentView {
  document: string;
  content: string;
}

type DocumentSnapshot = DocumentView & { bodyTop: number };
type Position = { restoreBodyTop: number } | { anchor: string; newDocument: boolean };

export function SkillDocumentReader({ cwd, filePath, baseDir, renderOverview }: {
  cwd: string;
  filePath: string;
  baseDir: string;
  /** Only the root instructions belong inside the skill's metadata layout. */
  renderOverview: (instructions: ReactNode) => ReactNode;
}) {
  const { t } = useI18n();
  const rootDocument = filePath.split(/[\\/]/).pop()!;
  const [view, setView] = useState<DocumentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DocumentSnapshot[]>([]);
  const [positionRequest, setPositionRequest] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const positionRef = useRef<Position | null>(null);

  const readDocument = useCallback(async (document: string, signal: AbortSignal) => {
    const params = new URLSearchParams({ cwd, filePath });
    if (document !== rootDocument) params.set("document", document);
    const response = await fetch(`/api/skills/content?${params}`, { signal });
    const data = (await response.json()) as Partial<SkillContentResponse> & { error?: string };
    if (!response.ok || data.error || typeof data.content !== "string") {
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }
    return skillInstructionsBody(data.content);
  }, [cwd, filePath, rootDocument]);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setView(null);
    setHistory([]);
    setLoading(true);
    setError(null);
    positionRef.current = null;
    void readDocument(rootDocument, controller.signal).then((content) => {
      if (!controller.signal.aborted) setView({ document: rootDocument, content });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => { requestRef.current?.abort(); };
  }, [readDocument, rootDocument]);

  // Scroll only Settings' detail pane, not the dialog or the chat behind it.
  // Run after the new Markdown mounts; a failed read leaves the old view intact.
  useLayoutEffect(() => {
    const position = positionRef.current;
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>(".config-detail");
    const documentBody = root?.querySelector<HTMLElement>(".skill-document-body");
    if (!position || !root || !scroller || !documentBody) return;
    positionRef.current = null;
    if ("restoreBodyTop" in position) {
      documentBody.focus({ preventScroll: true });
      // Restore the paragraph, not an offset inflated by a transient loading notice.
      scroller.scrollTop += documentBody.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top - position.restoreBodyTop;
      return;
    }
    let target: HTMLElement | undefined = documentBody;
    if (position.anchor) {
      target = Array.from(root.querySelectorAll<HTMLElement>("[data-heading-anchor], [id]"))
        .find((element) => element.dataset.headingAnchor === position.anchor
          || element.id === position.anchor || element.id === `user-content-${position.anchor}`);
      if (!target) {
        if (position.newDocument) {
          documentBody.focus({ preventScroll: true });
          scroller.scrollTop = 0;
        }
        setError(t("skills.documentAnchorMissing", { anchor: position.anchor }));
        return;
      }
    }
    // Headings need programmatic focus; links keep their place in the Tab order.
    if (target.tabIndex < 0) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    if (position.newDocument && !position.anchor) {
      scroller.scrollTop = 0;
      return;
    }
    const toolbarHeight = root.querySelector<HTMLElement>(".skill-document-toolbar")?.offsetHeight ?? 0;
    // Reference headers cover the pane's padding; inline overview notices do not.
    const padding = view?.document === rootDocument
      ? parseFloat(scroller.ownerDocument.defaultView?.getComputedStyle(scroller).paddingTop ?? "0") || 0
      : 0;
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - toolbarHeight - padding - 12;
  }, [view, positionRequest, rootDocument, t]);

  const navigate = useCallback(async (href: string) => {
    if (!view) return;
    requestRef.current?.abort();
    setLoading(false);
    setError(null);
    const link = resolveSkillDocumentLink(href, view.document);
    if (link.kind === "external") return;
    if (link.kind === "error") {
      setError(t(link.reason === "outside" ? "skills.documentOutside" : link.reason === "unsupported" ? "skills.documentUnsupported" : "skills.documentInvalid"));
      return;
    }
    if (link.document === view.document) {
      // A fragment changes only the reading position, not the view or Back stack.
      positionRef.current = { anchor: link.anchor, newDocument: false };
      setPositionRequest((request) => request + 1);
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const content = await readDocument(link.document, controller.signal);
      if (controller.signal.aborted) return;
      const root = rootRef.current;
      const scroller = root?.closest<HTMLElement>(".config-detail");
      const body = root?.querySelector<HTMLElement>(".skill-document-body");
      if (!scroller || !body) return;
      const previous = { ...view, bodyTop: body.getBoundingClientRect().top - scroller.getBoundingClientRect().top };
      setHistory((history) => {
        const next = [...history, previous];
        // Keep the original overview and the most recent reference snapshots.
        return next.length > SKILL_DOCUMENT_HISTORY_LIMIT
          ? [next[0], ...next.slice(-(SKILL_DOCUMENT_HISTORY_LIMIT - 1))]
          : next;
      });
      positionRef.current = { anchor: link.anchor, newDocument: true };
      setView({ document: link.document, content });
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [view, readDocument, t]);

  const goBack = (overview: boolean) => {
    const index = overview ? 0 : history.length - 1;
    const previous = history[index];
    if (!previous) return;
    requestRef.current?.abort();
    setLoading(false);
    setError(null);
    positionRef.current = { restoreBodyTop: previous.bodyTop };
    setView(previous);
    setHistory(history.slice(0, index));
  };

  // Local images keep the existing renderer's rules; documents themselves use
  // only the skill-scoped endpoint, never the general file browser's grants.
  const documentDir = view?.document.includes("/") ? view.document.slice(0, view.document.lastIndexOf("/")) : "";
  const instructions = (
    <>
      {(history.length > 0 || loading || error) && (
        <div className="skill-document-toolbar">
          {history.length > 0 && (
            <div className="skill-document-navigation">
              <ConfigButton size="small" onClick={() => goBack(false)}>{t("skills.documentBack")}</ConfigButton>
              <ConfigButton size="small" onClick={() => goBack(true)}>{t("skills.documentOverview")}</ConfigButton>
              <span className="skill-document-path">{view?.document}</span>
            </div>
          )}
          {loading && <span role="status" className="skill-instructions-status">{t("i18n.loading")}</span>}
          {error && <span role="alert" className="skill-instructions-status is-error">{error}</span>}
        </div>
      )}
      {view && (
        <div className="skill-document-body" tabIndex={-1} aria-label={view.document}>
          {view.content ? (
            <MarkdownBody className="skill-instructions" cwd={`${baseDir}/${documentDir}`} onNavigateLink={navigate}>
              {view.content}
            </MarkdownBody>
          ) : <span className="skill-instructions-status">{t("skills.noInstructions")}</span>}
        </div>
      )}
    </>
  );
  const isOverview = !view || view.document === rootDocument;
  return (
    <div ref={rootRef} className="skill-document-reader" data-reference={!isOverview}>
      {isOverview ? renderOverview(instructions) : instructions}
    </div>
  );
}
