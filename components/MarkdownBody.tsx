"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { copyText } from "@/lib/clipboard";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins } from "@/lib/markdown";
import { renderMermaid } from "@/lib/mermaid";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

function isImagePath(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

function filePathToApiUrl(filePath: string): string {
  return `/api/files/${encodeFilePathForApi(filePath)}?type=read`;
}

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={{
          code({ className, children, ...props }) {
            const lang = className?.replace("language-", "").toLowerCase() ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              if (lang === "mermaid") {
                return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
              }
              return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
            }
            return (
              <code
                className="markdown-inline-code"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
          img({ src, alt, ...props }) {
            if (!src || typeof src !== "string") return null;
            const filePath = resolveLocalFileHref(src, cwd);
            if (filePath && isImagePath(filePath)) {
              // eslint-disable-next-line @next/next/no-img-element
              return (
                <img
                  src={filePathToApiUrl(filePath)}
                  alt={alt ?? ""}
                  style={{ maxWidth: "100%", maxHeight: 480, borderRadius: 8, display: "block", margin: "8px 0" }}
                  loading="lazy"
                />
              );
            }
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={src} alt={alt} {...props} />;
          },
          a({ href, children, ...props }) {
            const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
            const openFile = onOpenFile;
            const isImage = filePath ? isImagePath(filePath) : false;

            const handleClick = (event: MouseEvent<HTMLElement>) => {
              if (event.defaultPrevented || event.button !== 0) return;
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              const target = event.currentTarget.getAttribute("target");
              if (target && target !== "_self") return;
              event.preventDefault();
              if (filePath && openFile) openFile(filePath);
            };

            if (isImage && filePath) {
              return (
                <span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={filePathToApiUrl(filePath)}
                    alt={String(children)}
                    style={{ maxWidth: "100%", maxHeight: 480, borderRadius: 8, display: "block", margin: "8px 0", cursor: "pointer" }}
                    loading="lazy"
                    onClick={openFile ? handleClick : undefined}
                  />
                </span>
              );
            }

            if (!filePath || !openFile) {
              return (
                <a href={href} {...props}>
                  {children}
                </a>
              );
            }

            return (
              <a href={href} {...props} onClick={handleClick}>
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="markdown-table-wrap">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        const size = fenceMatch[1].length;
        if (!fence) fence = { marker, size };
        else if (marker === fence.marker && size >= fence.size) fence = null;
        return line;
      }

      if (fence) return line;

      const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
      if (!displayMathMatch) return line;

      const math = displayMathMatch[2].trim();
      if (!math) return line;

      return `${displayMathMatch[1]}$$${lineBreak}${math}${lineBreak}${displayMathMatch[1]}$$`;
    })
    .join(lineBreak);
}

function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { isDark } = useTheme();
  const [showPreview, setShowPreview] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const bindFunctionsRef = useRef<((element: Element) => void) | undefined>(undefined);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;

  useEffect(() => {
    if (!showPreview || isStreaming) return;

    let cancelled = false;
    setError(null);

    const render = async () => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await renderMermaid(id, code, isDark);
      if (!cancelled) {
        bindFunctionsRef.current = result.bindFunctions;
        setSvg(result.svg);
        setRenderedKey(currentKey);
      }
    };

    render().catch((err: unknown) => {
      if (!cancelled) {
        setError({
          key: currentKey,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, isStreaming, showPreview]);

  useEffect(() => {
    if (renderedKey === currentKey && diagramRef.current) {
      bindFunctionsRef.current?.(diagramRef.current);
    }
  }, [currentKey, renderedKey, svg]);

  const previewButton = (
    <button
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={isStreaming ? "Preview available after streaming" : (showPreview ? "Show Mermaid source" : "Preview Mermaid diagram")}
      className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {showPreview ? "Source" : "Preview"}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
  }

  const body =
    error?.key === currentKey ? (
      <div className="mermaid-block mermaid-block-error">{error.message}</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div className="mermaid-block mermaid-block-loading" aria-label="Rendering Mermaid diagram" />
    ) : (
      <div
        ref={diagramRef}
        className="mermaid-block"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
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

function CodeBlock({ code, lang, headerAction }: { code: string; lang: string; headerAction?: ReactNode }) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);

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
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
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
          background: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
