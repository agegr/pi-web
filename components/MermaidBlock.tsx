"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { prepareSvgForZoomPan, ZoomPanViewer } from "@/components/ZoomPanViewer";

interface MermaidBlockProps {
  code: string;
  isStreaming?: boolean;
  defaultPreview?: boolean;
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

  const previewButton = (
    <button
      type="button"
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={isStreaming ? t("i18n.previewAfterStreaming") : (previewVisible ? t("i18n.showMermaidSource") : t("i18n.previewMermaid"))}
      className={["markdown-code-action", previewVisible ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {previewVisible ? t("i18n.source") : t("i18n.preview")}
    </button>
  );

  if (!previewVisible) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
  }

  const body = renderState?.key === currentKey && renderState.status === "error" ? (
      <div className="mermaid-block mermaid-block-error">{t("i18n.invalidMermaid")}</div>
    ) : renderState?.key !== currentKey || renderState.status !== "ready" ? (
      <div className="mermaid-block mermaid-block-loading" aria-label={t("i18n.renderingMermaid")} />
    ) : (
      <>
        {!zoomOpen && (
          <button
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
        {previewButton}
      </div>
      {body}
    </div>
  );
}

function MermaidZoomDialog({ svg, onClose }: { svg: string; onClose: () => void }) {
  const { t } = useI18n();
  const prepared = useMemo(() => prepareSvgForZoomPan(svg), [svg]);

  return (
    <ZoomPanViewer
      contentWidth={prepared.width}
      contentHeight={prepared.height}
      title={t("i18n.mermaidDiagram")}
      ariaLabel={t("i18n.mermaidViewer")}
      onClose={onClose}
    >
      <div dangerouslySetInnerHTML={{ __html: prepared.html }} />
    </ZoomPanViewer>
  );
}

interface CodeBlockProps {
  code: string;
  lang: string;
  headerAction?: ReactNode;
}

/** Collapsed height for chat code fences (all languages). */
export const CODE_MAX_HEIGHT = 300;

/**
 * Syntax-highlighted code block with copy button and a capped-height
 * expand/collapse toggle ("expand full" over a gradient fade). Used for all
 * chat code fences — plain blocks, mermaid source view and html preview blocks.
 */
export function CodeBlock({ code, lang, headerAction }: CodeBlockProps) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  // The measured element must be the maxHeight wrapper itself: its own
  // scrollHeight is the full code height, while an outer element's scrollHeight
  // only reflects the already-clipped descendant box (always false negative).
  const bodyRef = useRef<HTMLDivElement>(null);

  // Detect whether the code exceeds the collapsed height. When expanded, keep
  // the collapse affordance available no matter how the content changes.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setOverflowing(expanded ? true : el.scrollHeight > el.clientHeight + 1);
    measure();
    // Re-measure once the frame settles so late-loading fonts can't cause a
    // false "fits" reading right after mount.
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [code, expanded]);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="markdown-code-collapse">
      <div className="markdown-code-collapse-body">
        <div className="markdown-code-block">
          <div className="markdown-code-header">
            <span className="markdown-code-lang">{lang || "text"}</span>
            <div className="markdown-code-actions">
              {headerAction}
              {overflowing && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="markdown-code-action"
                >
                  {expanded ? t("i18n.collapseCode") : t("i18n.expandCode")}
                </button>
              )}
              <button
                onClick={copy}
                className="markdown-code-action"
              >
                {copied ? t("i18n.copied") : t("i18n.copy")}
              </button>
            </div>
          </div>
          <div ref={bodyRef} style={expanded ? undefined : { maxHeight: CODE_MAX_HEIGHT, overflow: "hidden" }}>
          <SyntaxHighlighter
            language={lang || "text"}
            style={isDark ? vscDarkPlus : vs}
            showLineNumbers
            lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
            customStyle={{
              margin: 0,
              padding: "11px 13px",
              fontSize: 12.5,
              lineHeight: 1.62,
              borderRadius: 0,
              // Longhand only: the prism theme already sets backgroundColor, and
              // mixing shorthand `background` with it triggers React style warnings.
              backgroundColor: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
            }}
            codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
          >
            {code}
          </SyntaxHighlighter>
          </div>
        </div>
      </div>
      {overflowing && !expanded && <div className="markdown-code-fade" aria-hidden="true" />}
    </div>
  );
}
