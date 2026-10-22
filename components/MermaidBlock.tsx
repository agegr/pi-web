"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { usePrismLanguages } from "@/hooks/usePrismLanguages";
import { copyText } from "@/lib/clipboard";
import { takeHighlightBudget, waitForHighlight } from "@/lib/highlight-queue";
import { prismLanguagesLoaded } from "@/lib/prism-languages";

interface MermaidBlockProps {
  code: string;
  isStreaming?: boolean;
  defaultPreview?: boolean;
}

// The viewer lays the diagram out at its natural pixel size and scales it with
// a transform, so the zooms below are relative to 100% of that size.
const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
/** Space kept around the diagram when it is fitted to the viewport. */
const FIT_PADDING = 16;
/** A press that moved less than this (CSS px) is a click, not a pan. */
const DRAG_THRESHOLD = 3;
/** Wheel zoom strength: one notch (deltaY 100) is about a 22% step. */
const WHEEL_ZOOM_SPEED = 0.002;

export function downloadMermaidSvg(svg: SVGSVGElement): void {
  // Mermaid's HTML serialization can leave void tags such as <br> unclosed.
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "mermaid-diagram.svg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

type RenderState =
  | { key: string; status: "loading" }
  | { key: string; status: "error" }
  | { key: string; status: "ready"; svg: string };

export function MermaidBlock({ code, isStreaming, defaultPreview = false }: MermaidBlockProps) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [showPreview, setShowPreview] = useState(defaultPreview);
  const [renderState, setRenderState] = useState<RenderState | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const previewRef = useRef<HTMLButtonElement>(null);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;
  const previewVisible = showPreview && !isStreaming;

  useEffect(() => {
    if (!previewVisible) return;

    let cancelled = false;
    setRenderState({ key: currentKey, status: "loading" });

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      const parsed = await mermaid.parse(code, { suppressErrors: true });
      if (!parsed) throw new Error("Invalid Mermaid diagram");

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await mermaid.render(id, code);
      if (!cancelled) {
        setRenderState({ key: currentKey, status: "ready", svg: result.svg });
      }
    };

    render().catch(() => {
      if (!cancelled) setRenderState({ key: currentKey, status: "error" });
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, previewVisible]);

  const previewButton = useMemo(() => (
    <button
      type="button"
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={isStreaming ? t("i18n.previewAfterStreaming") : (previewVisible ? t("i18n.showMermaidSource") : t("i18n.previewMermaid"))}
      className={["markdown-code-action", previewVisible ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {previewVisible ? t("i18n.source") : t("i18n.preview")}
    </button>
  ), [isStreaming, previewVisible, t]);

  if (!previewVisible) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} isStreaming={isStreaming} />;
  }

  const body = renderState?.key === currentKey && renderState.status === "error" ? (
      <div className="mermaid-block mermaid-block-error">{t("i18n.invalidMermaid")}</div>
    ) : renderState?.key !== currentKey || renderState.status !== "ready" ? (
      <div className="mermaid-block mermaid-block-loading" aria-label={t("i18n.renderingMermaid")} />
    ) : (
      <>
        {!zoomOpen && (
          <button
            ref={previewRef}
            type="button"
            className="mermaid-block mermaid-preview-button"
            title={t("i18n.openMermaidViewer")}
            aria-label={t("i18n.openMermaidViewer")}
            onClick={() => setZoomOpen(true)}
            dangerouslySetInnerHTML={{ __html: renderState.svg }}
          />
        )}
        {zoomOpen && <MermaidZoomDialog svg={renderState.svg} onClose={() => setZoomOpen(false)} />}
      </>
    );

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">mermaid</span>
        <div className="markdown-code-actions">
          {renderState?.key === currentKey && renderState.status === "ready" && (
            <button
              type="button"
              className="markdown-code-action"
              title={`${t("i18n.downloadFile")} (SVG)`}
              aria-label={`${t("i18n.downloadFile")} (SVG)`}
              onClick={() => {
                const svg = previewRef.current?.querySelector("svg");
                if (svg) downloadMermaidSvg(svg);
              }}
            >
              SVG
            </button>
          )}
          {previewButton}
        </div>
      </div>
      {body}
    </div>
  );
}

/** Zoom scale plus the translation of the diagram's top-left corner in the viewport. */
interface MermaidView {
  scale: number;
  x: number;
  y: number;
}

interface MermaidDrag {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  /** The press started on empty space, so releasing it without a drag closes the viewer. */
  onBackground: boolean;
  moved: boolean;
}

function clampZoom(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** Fit the diagram to the viewport width (never enlarging past its own size), centered. */
function fitMermaidView(
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
): MermaidView {
  const availableWidth = Math.max(1, viewportWidth - FIT_PADDING * 2);
  const scale = contentWidth > 0 ? clampZoom(Math.min(1, availableWidth / contentWidth)) : 1;
  const width = contentWidth * scale;
  const height = contentHeight * scale;
  return {
    scale,
    x: (viewportWidth - width) / 2,
    y: height + FIT_PADDING * 2 <= viewportHeight ? (viewportHeight - height) / 2 : FIT_PADDING,
  };
}

function MermaidZoomDialog({ svg, onClose }: { svg: string; onClose: () => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MermaidDrag | null>(null);
  const [view, setView] = useState<MermaidView>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // Show the dialog, then pin the svg to the pixel size in its viewBox and fit
  // it to the view. Both belong to one layout effect: a closed <dialog> has no
  // layout box, so measuring before showModal() would only read zeros.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!dialog || !viewport || !canvas) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();

    // Mermaid sizes its svg to the container (width="100%"), which leaves
    // nothing to scale.
    const svgElement = canvas.querySelector("svg");
    const viewBox = svgElement?.viewBox?.baseVal;
    const measured = svgElement?.getBoundingClientRect();
    const width = viewBox?.width || measured?.width || 0;
    const height = viewBox?.height || measured?.height || 0;
    if (svgElement && width && height) {
      svgElement.style.setProperty("width", `${width}px`, "important");
      svgElement.style.setProperty("height", `${height}px`, "important");
      svgElement.style.setProperty("max-width", "none", "important");
      setView(fitMermaidView(viewport.clientWidth, viewport.clientHeight, canvas.offsetWidth, canvas.offsetHeight));
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  /** Zoom by `factor`, keeping the diagram point under (pointerX, pointerY) in place. */
  const zoomAt = useCallback((pointerX: number, pointerY: number, factor: number) => {
    setView((current) => {
      const scale = clampZoom(current.scale * factor);
      if (scale === current.scale) return current;
      const ratio = scale / current.scale;
      return {
        scale,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      };
    });
  }, []);

  const zoomFromCenter = (factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor);
  };

  const fitToView = () => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    setView(fitMermaidView(viewport.clientWidth, viewport.clientHeight, canvas.offsetWidth, canvas.offsetHeight));
  };

  // React attaches wheel listeners passively, so preventDefault (no page scroll
  // behind the dialog) needs a listener of our own.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const delta = event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * rect.height
          : event.deltaY;
      if (!delta) return;
      zoomAt(
        event.clientX - rect.left,
        event.clientY - rect.top,
        Math.exp(-delta * WHEEL_ZOOM_SPEED),
      );
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [zoomAt]);

  const endDrag = (event: { pointerId: number }) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    dragRef.current = null;
    setDragging(false);
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    return drag;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || event.button !== 0 || !event.isPrimary) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      onBackground: event.target === viewport,
      moved: false,
    };
    viewport.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      setDragging(true);
    }
    setView((current) => ({ scale: current.scale, x: drag.originX + dx, y: drag.originY + dy }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = endDrag(event);
    if (drag && !drag.moved && drag.onBackground) onClose();
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    endDrag(event);
  };

  return (
    <dialog
      ref={dialogRef}
      className="mermaid-zoom-dialog"
      aria-label={t("i18n.mermaidViewer")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="mermaid-zoom-layout">
        <div className="mermaid-zoom-toolbar">
          <span className="mermaid-zoom-title">{t("i18n.mermaidDiagram")}</span>
          <div className="mermaid-zoom-actions">
            <div className="mermaid-zoom-stepper">
              <button
                type="button"
                onClick={() => zoomFromCenter(1 / ZOOM_STEP)}
                disabled={view.scale <= ZOOM_MIN * 1.001}
                title={t("i18n.zoomOut")}
                aria-label={t("i18n.zoomOut")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 12h14" />
                </svg>
              </button>
              <span className="mermaid-zoom-value">{Math.round(view.scale * 100)}%</span>
              <button
                type="button"
                onClick={() => zoomFromCenter(ZOOM_STEP)}
                disabled={view.scale >= ZOOM_MAX * 0.999}
                title={t("i18n.zoomIn")}
                aria-label={t("i18n.zoomIn")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="mermaid-zoom-icon-button"
              onClick={fitToView}
              title={t("i18n.fitToWidth")}
              aria-label={t("i18n.fitToWidth")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              </svg>
            </button>
            <button
              type="button"
              className="mermaid-zoom-icon-button"
              onClick={onClose}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div
          ref={viewportRef}
          className={["mermaid-zoom-viewport", dragging ? "is-dragging" : ""].filter(Boolean).join(" ")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
          onDragStart={(event) => event.preventDefault()}
        >
          <div
            ref={canvasRef}
            className="mermaid-zoom-canvas"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </dialog>
  );
}

interface CodeBlockProps {
  code: string;
  lang: string;
  headerAction?: ReactNode;
  isStreaming?: boolean;
}

// Prism's light theme uses backgroundColor, while its dark theme uses the
// background shorthand. Keep the pre background solely in customStyle so a
// theme switch cannot remove/update one and reset the other in React's diff.
const codeBlockDarkTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
  },
};
delete codeBlockDarkTheme['pre[class*="language-"]'].background;

/**
 * Syntax-highlighted code block with copy button.
 * Used as the "source" view for mermaid blocks and for all non-mermaid code fences.
 *
 * Memoized: parent markdown re-renders (e.g. streaming updates elsewhere in
 * the message list) must not re-run Prism tokenization on unchanged code.
 * While the owning message is still streaming, the block renders as plain
 * monospace text — highlighting a growing block re-tokenizes all of it on
 * every chunk, which is the single most expensive part of streamed rendering.
 * A finished block past this task's highlight budget (lib/highlight-queue.ts),
 * or mounted before the Prism languages have loaded (lib/prism-languages.ts),
 * renders through the same highlighter as `text` (same lines, numbers and
 * box, no tokens) until an idle slice lets it take its language.
 */
export const CodeBlock = memo(function CodeBlock({ code, lang, headerAction, isStreaming }: CodeBlockProps) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  // Loading starts with the first block, streaming or not, so a streamed
  // reply usually finds the languages ready when it ends.
  const languagesReady = usePrismLanguages();
  const [highlighted, setHighlighted] = useState(
    () => !isStreaming && prismLanguagesLoaded() && takeHighlightBudget(code.length),
  );

  useEffect(() => {
    if (isStreaming || highlighted || !languagesReady) return;
    return waitForHighlight(() => setHighlighted(true));
  }, [isStreaming, highlighted, languagesReady]);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || "text"}</span>
        <div className="markdown-code-actions">
          {headerAction}
          <button
            onClick={copy}
            className="markdown-code-action"
          >
            {copied ? t("i18n.copied") : t("i18n.copy")}
          </button>
        </div>
      </div>
      {isStreaming ? (
        <pre
          style={{
            margin: 0,
            padding: "11px 13px",
            fontSize: "calc(12.5px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.62,
            overflowX: "auto",
            backgroundColor: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
          }}
        >
          <code style={{ fontFamily: "var(--font-mono)" }}>{code}</code>
        </pre>
      ) : (
        <SyntaxHighlighter
          language={highlighted ? lang || "text" : "text"}
          style={isDark ? codeBlockDarkTheme : vs}
          showLineNumbers
          lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
          customStyle={{
            margin: 0,
            padding: "11px 13px",
            fontSize: "calc(12.5px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.62,
            fontWeight: "var(--font-mono-weight)",
            // The light `vs` theme puts its own 1px #ddd border on <pre>; the
            // block's wrapper already draws the frame.
            border: "none",
            borderRadius: 0,
            backgroundColor: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)", fontWeight: "var(--font-mono-weight)" } }}
        >
          {code}
        </SyntaxHighlighter>
      )}
    </div>
  );
});
