"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { visitParents } from "unist-util-visit-parents";
import { getFileDirectory, encodeFilePathForApi } from "@/lib/file-paths";
import { resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { parseFrontmatter } from "@/lib/frontmatter";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { CodeBlock, MermaidBlock } from "./MermaidBlock";
import { FrontmatterCard } from "./FrontmatterCard";

export interface MarkdownFileContext {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (path: string) => void;
}

type MarkdownNodePosition = {
  position?: { start?: { line?: number }; end?: { line?: number } };
};

type MarkdownTextNode = MarkdownNodePosition & {
  type: "text";
  value: string;
};

type MarkdownParentNode = {
  children?: Array<Record<string, unknown>>;
};

type MarkdownElementNode = MarkdownParentNode & {
  type: string;
  tagName?: string;
};

/**
 * Keep source line identity on the rendered text itself. Block-level source
 * ranges are useful for scrolling, but they make a location highlight cover
 * an entire paragraph. Splitting text nodes by their source lines lets the
 * viewer highlight only the selected line while preserving normal Markdown
 * rendering and selection behavior.
 */
function rehypeSourceLineSpans() {
  return (tree: unknown) => {
    visitParents(tree as MarkdownElementNode, "text", (node: MarkdownTextNode, ancestors) => {
      const parent = ancestors.at(-1) as MarkdownParentNode | undefined;
      // CodeBlock/Pre content is rendered by its own syntax highlighter. Do
      // not inject React-facing source-line spans into that text or its raw
      // code would be turned into element children (and lose its value).
      if (ancestors.some((ancestor) => {
        const element = ancestor as MarkdownElementNode;
        return element.type === "element" && (element.tagName === "code" || element.tagName === "pre");
      })) return;
      // SAFETY: visitParents returns the same AST node object stored in the parent's generic children array.
      const index = parent?.children?.indexOf(node as unknown as Record<string, unknown>) ?? -1;
      if (!parent || typeof index !== "number" || !parent.children || !node.position?.start?.line) return;

      const startLine = node.position.start.line;
      const segments = node.value.split("\n");
      if (segments.length === 1) {
        parent.children[index] = {
          type: "element",
          tagName: "span",
          properties: {
            "data-source-line": startLine,
            "data-source-start-line": startLine,
            "data-source-end-line": startLine,
            className: ["markdown-source-line"],
          },
          children: [node],
        };
        return;
      }

      const replacements: Array<Record<string, unknown>> = [];
      segments.forEach((segment, segmentIndex) => {
        const value = segmentIndex < segments.length - 1 ? `${segment}\n` : segment;
        if (!value) return;
        const line = startLine + segmentIndex;
        replacements.push({
          type: "element",
          tagName: "span",
          properties: {
            "data-source-line": line,
            "data-source-start-line": line,
            "data-source-end-line": line,
            className: ["markdown-source-line"],
          },
          children: [{ type: "text", value }],
        });
      });

      parent.children.splice(index, 1, ...replacements);
      return index + replacements.length;
    });
  };
}

function sourceLineAttributes(node: unknown): Record<string, number> {
  const position = (node as MarkdownNodePosition | undefined)?.position;
  const startLine = position?.start?.line;
  const endLine = position?.end?.line;
  return typeof startLine === "number" && typeof endLine === "number"
    && Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0 && endLine >= startLine
    ? { "data-source-start-line": startLine, "data-source-end-line": endLine }
    : {};
}

/** Shared by the read-only preview and editor's complex blocks. */
export function MarkdownFilePreview({ content, filePath, cwd, sourceSessionId, onOpenFile }: MarkdownFileContext & { content: string }) {
  const directory = getFileDirectory(filePath);
  const frontmatter = useMemo(() => parseFrontmatter(content), [content]);
  const normalized = useMemo(() => normalizeDisplayMath(content), [content]);
  const components = useMemo<Components>(() => ({
    h1({ node, ...props }) { return <h1 {...props} {...sourceLineAttributes(node)} />; },
    h2({ node, ...props }) { return <h2 {...props} {...sourceLineAttributes(node)} />; },
    h3({ node, ...props }) { return <h3 {...props} {...sourceLineAttributes(node)} />; },
    h4({ node, ...props }) { return <h4 {...props} {...sourceLineAttributes(node)} />; },
    h5({ node, ...props }) { return <h5 {...props} {...sourceLineAttributes(node)} />; },
    h6({ node, ...props }) { return <h6 {...props} {...sourceLineAttributes(node)} />; },
    p({ node, ...props }) { return <p {...props} {...sourceLineAttributes(node)} />; },
    blockquote({ node, ...props }) { return <blockquote {...props} {...sourceLineAttributes(node)} />; },
    li({ node, ...props }) { return <li {...props} {...sourceLineAttributes(node)} />; },
    table({ node, ...props }) { return <table {...props} {...sourceLineAttributes(node)} />; },
    code({ className, children, node, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      if (className?.includes("language-") || raw.includes("\n")) {
        return <div {...sourceLineAttributes(node)}>{lang === "mermaid"
          ? <MermaidBlock code={raw.replace(/\n$/, "")} defaultPreview />
          : <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />}</div>;
      }
      return <code className={className} {...props}>{children}</code>;
    },
    pre: ({ children }) => <>{children}</>,
    a({ href, children, ...props }) {
      delete props.node;
      const linkedFile = onOpenFile ? resolveLocalFileHref(href, directory, cwd ?? directory) : null;
      return <a href={href} {...props} onClick={linkedFile && onOpenFile ? (event) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        event.preventDefault();
        onOpenFile(linkedFile);
      } : undefined}>{children}</a>;
    },
    img({ src, alt, ...props }) {
      delete props.node;
      const imagePath = typeof src === "string" ? resolveLocalFileHref(src, directory, cwd ?? directory) : null;
      const query = sourceSessionId ? `?type=read&sessionId=${encodeURIComponent(sourceSessionId)}` : "?type=read";
      const imageSrc = imagePath ? `/api/files/${encodeFilePathForApi(imagePath)}${query}` : src;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
    },
  }), [directory, cwd, sourceSessionId, onOpenFile]);
  const rehypePlugins = useMemo(() => [
    ...(markdownPreviewRehypePlugins ?? []),
    rehypeSourceLineSpans,
  ], []);
  return <>
    {frontmatter.data && <FrontmatterCard data={frontmatter.data} />}
    <ReactMarkdown remarkPlugins={markdownPreviewRemarkPlugins} rehypePlugins={rehypePlugins}
      urlTransform={onOpenFile ? markdownUrlTransform : undefined} components={components}>{normalized}</ReactMarkdown>
  </>;
}
