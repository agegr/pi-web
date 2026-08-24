"use client";

import { useMemo, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { normalizeWebUrl } from "@/lib/web-url";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  /** Opens an external HTTP(S) link in the app's web panel. */
  onOpenUrl?: (url: string) => void;
  /** Inline content appended after addressable Markdown blocks. */
  threadPanels?: ReadonlyMap<string, ReactNode>;
  /** Prefix that makes Markdown block anchors unique within an assistant entry. */
  blockKeyPrefix?: string;
}

function getExternalWebUrl(href: string | undefined): string | null {
  if (!href || !(/^(?:https?:)?\/\//i.test(href) || /^www\./i.test(href))) return null;
  return normalizeWebUrl(href.startsWith("//") ? `https:${href}` : href);
}

function blockAnchorKey(prefix: string | undefined, kind: string, node: unknown): string | undefined {
  if (!prefix || !node || typeof node !== "object") return undefined;
  const position = (node as { position?: { start?: { offset?: unknown } } }).position;
  const offset = position?.start?.offset;
  return typeof offset === "number" ? `${prefix}:${kind}:${offset}` : undefined;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, onOpenUrl, threadPanels, blockKeyPrefix }: MarkdownBodyProps) {
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
      const webUrl = onOpenUrl ? getExternalWebUrl(href) : null;
      const openFile = onOpenFile;
      if ((!filePath || !openFile) && (!webUrl || !onOpenUrl)) {
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
        if (filePath && openFile) openFile(filePath);
        else if (webUrl && onOpenUrl) onOpenUrl(webUrl);
      };

      return <a href={href} {...props} onClick={handleClick}>{children}</a>;
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
    h1({ node, children, ...props }) {
      const anchorKey = blockAnchorKey(blockKeyPrefix, "h1", node);
      return <><h1 {...props} {...(anchorKey ? { "data-thread-anchor": anchorKey } : {})}>{children}</h1>{anchorKey ? threadPanels?.get(anchorKey) : null}</>;
    },
    h2({ node, children, ...props }) {
      const anchorKey = blockAnchorKey(blockKeyPrefix, "h2", node);
      return <><h2 {...props} {...(anchorKey ? { "data-thread-anchor": anchorKey } : {})}>{children}</h2>{anchorKey ? threadPanels?.get(anchorKey) : null}</>;
    },
    h3({ node, children, ...props }) {
      const anchorKey = blockAnchorKey(blockKeyPrefix, "h3", node);
      return <><h3 {...props} {...(anchorKey ? { "data-thread-anchor": anchorKey } : {})}>{children}</h3>{anchorKey ? threadPanels?.get(anchorKey) : null}</>;
    },
    h4({ node, children, ...props }) {
      const anchorKey = blockAnchorKey(blockKeyPrefix, "h4", node);
      return <><h4 {...props} {...(anchorKey ? { "data-thread-anchor": anchorKey } : {})}>{children}</h4>{anchorKey ? threadPanels?.get(anchorKey) : null}</>;
    },
    h5({ node, children, ...props }) {
      const anchorKey = blockAnchorKey(blockKeyPrefix, "h5", node);
      return <><h5 {...props} {...(anchorKey ? { "data-thread-anchor": anchorKey } : {})}>{children}</h5>{anchorKey ? threadPanels?.get(anchorKey) : null}</>;
    },
    h6({ node, children, ...props }) {
      const anchorKey = blockAnchorKey(blockKeyPrefix, "h6", node);
      return <><h6 {...props} {...(anchorKey ? { "data-thread-anchor": anchorKey } : {})}>{children}</h6>{anchorKey ? threadPanels?.get(anchorKey) : null}</>;
    },
    p({ node, children, ...props }) {
      const anchorKey = blockAnchorKey(blockKeyPrefix, "p", node);
      return <><p {...props} {...(anchorKey ? { "data-thread-anchor": anchorKey } : {})}>{children}</p>{anchorKey ? threadPanels?.get(anchorKey) : null}</>;
    },
    li({ node, children, ...props }) {
      const anchorKey = blockAnchorKey(blockKeyPrefix, "li", node);
      return <li {...props} {...(anchorKey ? { "data-thread-anchor": anchorKey } : {})}>{children}{anchorKey ? threadPanels?.get(anchorKey) : null}</li>;
    },
  }), [blockKeyPrefix, cwd, isStreaming, onOpenFile, onOpenUrl, threadPanels]);

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
