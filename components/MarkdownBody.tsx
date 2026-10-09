"use client";

import { createContext, useContext, useMemo, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parsePdfPageFragment, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, markdownUrlTransform, markdownUserRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { ImagePreview } from "./ImagePreview";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { InteractivePreview } from "./InteractivePreview";
import { INTERACTIVE_PREVIEW_LANGUAGE, isCompleteInteractiveFence } from "@/lib/interactive-preview";

const MarkdownLinkContext = createContext(false);
const MarkdownCodeContext = createContext<{ markdown: string; isStreaming?: boolean; allowInteractive: boolean }>({
  markdown: "", allowInteractive: false,
});

function MarkdownCode({ className, children, node, ...props }: ComponentProps<"code"> & ExtraProps) {
  const { markdown, isStreaming, allowInteractive } = useContext(MarkdownCodeContext);
  const lang = className?.replace("language-", "").toLowerCase() ?? "";
  const raw = String(children);
  const isBlock = className?.includes("language-") || raw.includes("\n");
  if (!isBlock) return <code className="markdown-inline-code" {...props}>{children}</code>;
  const code = raw.replace(/\n$/, "");
  if (allowInteractive && lang === INTERACTIVE_PREVIEW_LANGUAGE) {
    return <InteractivePreview code={code} isStreaming={isStreaming}
      complete={isCompleteInteractiveFence(markdown, node?.position)} />;
  }
  if (lang === "mermaid") return <MermaidBlock code={code} isStreaming={isStreaming} defaultPreview />;
  return <CodeBlock code={code} lang={lang} isStreaming={isStreaming} />;
}

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  /** Render every line ending as a line break, for text the user typed. */
  keepLineBreaks?: boolean;
  allowInteractive?: boolean;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  ...props
}: ComponentProps<"img"> & ExtraProps & { cwd?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  delete props.node;
  const href = typeof src === "string" ? src : undefined;
  const filePath = href ? resolveLocalFileHref(href, cwd) : null;
  const imageSrc = filePath
    ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
    : href;
  // Dynamic local paths are served directly by the file API.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
  if (!imageSrc || insideLink) return image;
  return (
    <ImagePreview src={imageSrc} alt={alt ?? ""} className="markdown-image">
      {image}
    </ImagePreview>
  );
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, keepLineBreaks, allowInteractive = false }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  const codeContext = useMemo(() => ({ markdown: normalizedMarkdown, isStreaming, allowInteractive }),
    [normalizedMarkdown, isStreaming, allowInteractive]);
  // Context updates content without remounting stateful blocks on each streaming delta.
  const components = useMemo<Components>(() => ({
    code: MarkdownCode,
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
          <MarkdownLinkContext.Provider value={true}>
            <a href={href} {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath, parsePdfPageFragment(href) ?? undefined);
      };

      return (
        <MarkdownLinkContext.Provider value={true}>
          <a href={href} {...props} onClick={handleClick}>
            {children}
          </a>
        </MarkdownLinkContext.Provider>
      );
    },
    img(props) {
      return <MarkdownImage cwd={cwd} {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [cwd, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <MarkdownCodeContext.Provider value={codeContext}>
      <ReactMarkdown
        remarkPlugins={keepLineBreaks ? markdownUserRemarkPlugins : markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        urlTransform={onOpenFile ? markdownUrlTransform : undefined}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
      </MarkdownCodeContext.Provider>
    </div>
  );
}
