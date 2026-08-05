"use client";

import { Children as ReactChildren, Fragment, useCallback, useMemo, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { looksLikeLocalFileReference, resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  const renderLocalPathText = useCallback((value: string): ReactNode => {
    if (!onOpenFile || !cwd) return value;

    const parts = splitLocalPathText(value, cwd);
    if (parts.length === 1 && parts[0].filePath === null) return value;

    return parts.map((part, index) => part.filePath ? (
      <a
        key={`${part.text}-${index}`}
        href={part.text}
        className="markdown-local-file-link"
        onClick={(event) => {
          if (event.defaultPrevented || event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpenFile(part.filePath!);
        }}
      >
        {part.text}
      </a>
    ) : <Fragment key={`${part.text}-${index}`}>{part.text}</Fragment>);
  }, [cwd, onOpenFile]);
  const renderLocalPathChildren = useCallback((value: ReactNode): ReactNode => (
    ReactChildren.map(value, (child) => typeof child === "string" ? renderLocalPathText(child) : child)
  ), [renderLocalPathText]);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
      }
      const filePath = onOpenFile && looksLikeLocalFileReference(raw.trim())
        ? resolveLocalFileHref(raw.trim(), cwd)
        : null;
      if (filePath && onOpenFile) {
        return (
          <code className="markdown-inline-code markdown-local-file-code" {...props}>
            <button
              type="button"
              className="markdown-local-file-button"
              title={filePath}
              onClick={() => onOpenFile(filePath)}
            >
              {children}
            </button>
          </code>
        );
      }
      return <code className="markdown-inline-code" {...props}>{children}</code>;
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const filePath = onOpenFile && looksLikeLocalFileReference(href)
        ? resolveLocalFileHref(href, cwd)
        : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a
          href={href}
          {...props}
          className={["markdown-local-file-link", props.className].filter(Boolean).join(" ")}
          onClick={handleClick}
        >
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
    p({ children }) {
      return <p>{renderLocalPathChildren(children)}</p>;
    },
    li({ children }) {
      return <li>{renderLocalPathChildren(children)}</li>;
    },
  }), [cwd, isStreaming, onOpenFile, renderLocalPathChildren]);

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

interface LocalPathTextPart {
  text: string;
  filePath: string | null;
}

// Keep this deliberately conservative: Markdown links and inline code cover the
// ambiguous cases, while plain text detection handles path-shaped references.
const LOCAL_PATH_CANDIDATE = /(?:file:\/\/\/[A-Za-z]:\/[^\s<>"'`]+|[A-Za-z]:[\\/][^\s<>"'`]+|\\\\[^\s<>"'`]+|\/(?:[^\s<>"'`()\[\]{}]+\/)*[^\s<>"'`()\[\]{}]+|(?:\.{1,2}[\\/])?(?:[\w@.+-]+[\\/])+[\w@.+-]+(?:\.[\w@+-]+)?(?::\d+(?::\d+)?)?)/g;

export function splitLocalPathText(value: string, cwd: string): LocalPathTextPart[] {
  const parts: LocalPathTextPart[] = [];
  let cursor = 0;

  for (const match of value.matchAll(LOCAL_PATH_CANDIDATE)) {
    const start = match.index ?? 0;
    const previous = value[start - 1] ?? "";
    if (previous === ":" || previous === "/" || previous === "\\") continue;

    const text = match[0].replace(/[.,;!?]+$/, "");
    const filePath = looksLikeLocalFileReference(text)
      ? resolveLocalFileHref(text, cwd)
      : null;
    if (!filePath) continue;

    if (start > cursor) parts.push({ text: value.slice(cursor, start), filePath: null });
    parts.push({ text, filePath });
    cursor = start + text.length;
  }

  if (cursor < value.length) parts.push({ text: value.slice(cursor), filePath: null });
  return parts.length > 0 ? parts : [{ text: value, filePath: null }];
}
