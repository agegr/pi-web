"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";

// While streaming, `children` grows every frame; feeding it straight into
// ReactMarkdown re-parses the accumulated text each frame (O(n²), main-thread
// spikes on long streams). Throttle: hand the latest text to ReactMarkdown at
// most every 200ms; intermediate frames skip parsing. Non-streaming renders
// (history / stream finished) always parse immediately.
const STREAM_PARSE_INTERVAL_MS = 200;

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Throttled streaming text (see STREAM_PARSE_INTERVAL_MS). Non-streaming
  // renders track `normalizedMarkdown` directly (no delay, no stale tail).
  const [renderText, setRenderText] = useState(normalizedMarkdown);
  const lastParseRef = useRef({ text: normalizedMarkdown, at: 0 });
  useEffect(() => {
    if (!isStreaming) {
      lastParseRef.current = { text: normalizedMarkdown, at: 0 };
      setRenderText(normalizedMarkdown);
      return;
    }
    lastParseRef.current.text = normalizedMarkdown;
    const now = Date.now();
    if (now - lastParseRef.current.at >= STREAM_PARSE_INTERVAL_MS) {
      lastParseRef.current.at = now;
      setRenderText(normalizedMarkdown);
      return;
    }
    const timer = setTimeout(() => {
      lastParseRef.current.at = Date.now();
      setRenderText(lastParseRef.current.text);
    }, STREAM_PARSE_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [isStreaming, normalizedMarkdown]);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return (
            <MermaidBlock
              code={raw.replace(/\n$/, "")}
              isStreaming={isStreaming}
              defaultPreview
            />
          );
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
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
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={href} {...props} onClick={handleClick}>
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      delete props.node;
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      const imageSrc = filePath
        ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
        : src;
      // Dynamic local paths are served directly by the file API.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [cwd, isStreaming, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        urlTransform={onOpenFile ? markdownUrlTransform : undefined}
        components={components}
      >
        {renderText}
      </ReactMarkdown>
    </div>
  );
}
