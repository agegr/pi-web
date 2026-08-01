"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi, getFileName } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { getFileIcon } from "./FileIcons";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  sessionId?: string;
  onOpenFile?: (filePath: string) => void;
}

function getFileDownloadHref(filePath: string, sessionId?: string): string {
  const params = new URLSearchParams({ type: "download" });
  if (sessionId) params.set("sessionId", sessionId);
  return `/api/files/${encodeFilePathForApi(filePath)}?${params.toString()}`;
}

export function MarkdownBody({ children, className, isStreaming, cwd, sessionId, onOpenFile }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
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
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const filePath = (onOpenFile || sessionId) ? resolveLocalFileHref(href, cwd) : null;
      if (filePath) {
        const fileName = getFileName(filePath);
        return (
          <a
            href={getFileDownloadHref(filePath, sessionId)}
            download={fileName}
            {...props}
            className="markdown-file-link"
            title={filePath}
          >
            <span className="markdown-file-link-icon" aria-hidden="true">{getFileIcon(fileName, 16)}</span>
            <span>{children}</span>
          </a>
        );
      }

      return (
        <a href={href} {...props} target="_blank" rel="noopener noreferrer">
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
  }), [cwd, isStreaming, onOpenFile, sessionId]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
