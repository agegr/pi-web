"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parsePdfPageFragment, resolveInlineCodePath, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { ImagePreview } from "./ImagePreview";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { RevealInFileManagerButton } from "./RevealInFileManagerButton";
import { useI18n } from "@/hooks/useI18n";
import { pathIsReadableFile, revealPathInFileManager } from "@/lib/path-actions";

const MarkdownLinkContext = createContext(false);

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
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

/**
 * A path chip with both actions kept apart: clicking the path opens it in the
 * in-app viewer (as markdown file links already do), while the folder button
 * reveals it in the OS file manager.
 *
 * A directory cannot be previewed (/api/files answers "Not a file"), so the
 * click probes the path first and opens the folder instead of showing an error.
 */
function InlineFilePath({ filePath, label, onOpenFile }: {
  filePath: string;
  label: string;
  onOpenFile: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(() => {
    setError(null);
    void (async () => {
      if (await pathIsReadableFile(filePath)) {
        onOpenFile(filePath);
        return;
      }
      setError(await revealPathInFileManager(filePath));
    })();
  }, [filePath, onOpenFile]);

  return (
    <span className="inline-file-path">
      <button
        type="button"
        className="inline-file-path-open"
        onClick={open}
        title={error ?? filePath}
        aria-label={t("i18n.previewFile", { file: label })}
        style={error ? { color: "#f87171" } : undefined}
      >
        {label}
      </button>
      <RevealInFileManagerButton
        filePath={filePath}
        className="inline-file-path-reveal"
        iconSize={11}
      />
    </span>
  );
}

/**
 * Inline code that happens to be a filesystem path becomes a chip: clicking it
 * previews the file in-app, and the folder button reveals it in the OS file
 * manager. Anything that is not unambiguously a path stays plain code, and code
 * nested inside a markdown link is left alone.
 */
function InlineCode({
  children,
  cwd,
  onOpenFile,
  ...props
}: ComponentProps<"code"> & ExtraProps & { cwd?: string; onOpenFile?: (filePath: string, page?: number) => void }) {
  const insideLink = useContext(MarkdownLinkContext);
  delete props.node;

  const label = String(children);
  const filePath = !insideLink && onOpenFile ? resolveInlineCodePath(label, cwd) : null;
  if (!filePath || !onOpenFile) {
    return <code className="markdown-inline-code" {...props}>{children}</code>;
  }
  return <InlineFilePath filePath={filePath} label={label} onOpenFile={onOpenFile} />;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
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
        <InlineCode cwd={cwd} onOpenFile={onOpenFile} {...props}>
          {children}
        </InlineCode>
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
  }), [cwd, isStreaming, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        urlTransform={onOpenFile ? markdownUrlTransform : undefined}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
