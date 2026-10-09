"use client";

import { createContext, useContext, useMemo, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parsePdfPageFragment, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownAppUrlTransform, markdownRehypePlugins, markdownRemarkPlugins, markdownUrlTransform, markdownUserRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { ImagePreview } from "./ImagePreview";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { InteractiveArtifact } from "./InteractiveArtifacts";
import { interactiveFences, type InteractiveFence } from "@/lib/interactive-artifacts";
import { INTERACTIVE_PREVIEW_LANGUAGE, isCompleteInteractiveFence } from "@/lib/interactive-preview";

const MarkdownLinkContext = createContext(false);
const MarkdownCodeContext = createContext<{ markdown: string; isStreaming?: boolean; allowInteractive: boolean; fences: InteractiveFence[]; sourceKey?: string }>({
  markdown: "", allowInteractive: false, fences: [],
});

function MarkdownCode({ className, children, node, ...props }: ComponentProps<"code"> & ExtraProps) {
  const { markdown, isStreaming, allowInteractive, fences, sourceKey } = useContext(MarkdownCodeContext);
  const lang = className?.replace("language-", "").toLowerCase() ?? "";
  const raw = String(children);
  const isBlock = className?.includes("language-") || raw.includes("\n");
  if (!isBlock) return <code className="markdown-inline-code" {...props}>{children}</code>;
  const code = raw.replace(/\n$/, "");
  if (allowInteractive && lang === INTERACTIVE_PREVIEW_LANGUAGE) {
    const fence = fences.find((item) => item.offset === node?.position?.start.offset);
    return <InteractiveArtifact id={fence?.id} sourceKey={sourceKey && fence ? `${sourceKey}:${fence.ordinal}` : undefined} code={code} isStreaming={isStreaming}
      complete={fence?.complete ?? isCompleteInteractiveFence(markdown, node?.position, code)} />;
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
  interactiveSourceKey?: string;
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

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, keepLineBreaks, allowInteractive = false, interactiveSourceKey }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  const fences = useMemo(() => allowInteractive ? interactiveFences(normalizedMarkdown) : [], [normalizedMarkdown, allowInteractive]);
  const codeContext = useMemo(() => ({ markdown: normalizedMarkdown, isStreaming, allowInteractive, fences, sourceKey: interactiveSourceKey }),
    [normalizedMarkdown, isStreaming, allowInteractive, fences, interactiveSourceKey]);
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
    ol({ node, start, style, ...props }) {
      // An outside marker wider than the list's left padding is clipped by
      // .markdown-body's overflow-x, so the padding follows the largest number.
      const items = node?.children.filter((child) => child.type === "element" && child.tagName === "li").length ?? 0;
      const digits = String(Math.abs((start ?? 1) + Math.max(items, 1) - 1)).length;
      return <ol start={start} style={{ ...style, ["--ol-marker-digits" as string]: Math.max(digits, 2) }} {...props} />;
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
        urlTransform={onOpenFile ? markdownUrlTransform : markdownAppUrlTransform}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
      </MarkdownCodeContext.Provider>
    </div>
  );
}
