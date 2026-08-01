import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

interface MarkdownTreeNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownTreeNode[];
}

function encodeLocalFileHrefForSanitizer(href: string): string {
  if (/^[^/?#\s]+:\d+(?::\d+)?(?:[#?]|$)/.test(href)) {
    return href.replace(/:(\d+(?::\d+)?)(?=[#?]|$)/, "%3A$1");
  }
  if (/^[a-zA-Z]:[\\/]/.test(href)) {
    return href.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, "$1%3A");
  }
  if (/^file:\/\//i.test(href)) {
    return href.replace(/^file:/i, "file%3A");
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(href)) return href;
  return href.replace(/:(\d+(?::\d+)?)(?=[#?]|$)/, "%3A$1");
}

function normalizeLocalFileLinkHrefs() {
  return (tree: unknown) => {
    const visit = (node: MarkdownTreeNode) => {
      if (node.type === "element" && node.tagName === "a" && node.properties && typeof node.properties.href === "string") {
        node.properties.href = encodeLocalFileHrefForSanitizer(node.properties.href);
      }
      node.children?.forEach(visit);
    };
    visit(tree as MarkdownTreeNode);
  };
}

function normalizeWindowsFileLinkDestination(href: string): string {
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(href)
    || /^file:\/\/\/?[a-zA-Z]:[\\/]/i.test(href)
    || /\\[^\\/]+\.[^\\/.?#]+(?:[?#].*)?$/.test(href);
  return isWindowsPath ? href.replace(/\\/g, "/") : href;
}

function normalizeWindowsFileLinkDestinations(line: string): string {
  const normalize = (match: string, prefix: string, href: string, suffix: string) => {
    const normalized = normalizeWindowsFileLinkDestination(href);
    return normalized === href ? match : `${prefix}${normalized}${suffix}`;
  };

  return line
    .replace(/(\]\(\s*<)([^>\r\n]*\\[^>\r\n]*)(>\s*\))/g, normalize)
    .replace(/(\]\(\s*)([^)\r\n]*\\[^)\r\n]*)(\s*\))/g, normalize);
}

export function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const normalized: string[] = [];
  let fence: { marker: string; size: number } | null = null;
  let inlineCodeMarkerSize = 0;
  let rawCodeTag: string | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (rawCodeTag) {
      normalized.push(line);
      if (new RegExp(`</${rawCodeTag}\\s*>`, "i").test(line)) rawCodeTag = null;
      continue;
    }

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) fence = { marker, size };
      else if (marker === fence.marker && size >= fence.size) fence = null;
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (fence) {
      normalized.push(line);
      continue;
    }

    const rawCodeOpen = line.match(/<(code|pre|script|style)\b/i);
    if (rawCodeOpen) {
      const tag = rawCodeOpen[1].toLowerCase();
      const remainder = line.slice((rawCodeOpen.index ?? 0) + rawCodeOpen[0].length);
      if (!new RegExp(`</${tag}\\s*>`, "i").test(remainder)) rawCodeTag = tag;
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (/^(?: {4}|\t)/.test(line) || line.trim() === "") {
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (inlineCodeMarkerSize || line.includes("`")) {
      inlineCodeMarkerSize = updateInlineCodeMarker(line, inlineCodeMarkerSize);
      normalized.push(line);
      continue;
    }

    const bracketDisplayOneLine = line.match(/^([ ]{0,3})\\\[[ \t]*(.+?)[ \t]*\\\][ \t]*$/);
    if (bracketDisplayOneLine) {
      const math = bracketDisplayOneLine[2].trim();
      if (math) {
        normalized.push(`${bracketDisplayOneLine[1]}$$`, math, `${bracketDisplayOneLine[1]}$$`);
        continue;
      }
    }

    const bracketDisplayStart = line.match(/^([ ]{0,3})\\\[[ \t]*$/);
    if (bracketDisplayStart) {
      const closingIndex = findBracketDisplayClose(lines, index + 1);
      if (closingIndex !== -1) {
        normalized.push(
          `${bracketDisplayStart[1]}$$`,
          ...lines.slice(index + 1, closingIndex),
          `${bracketDisplayStart[1]}$$`,
        );
        index = closingIndex;
        continue;
      }
    }

    const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
    if (displayMathMatch) {
      const math = displayMathMatch[2].trim();
      if (math) {
        normalized.push(`${displayMathMatch[1]}$$`, math, `${displayMathMatch[1]}$$`);
        continue;
      }
    }

    normalized.push(normalizeInlineLatexMath(normalizeWindowsFileLinkDestinations(line)));
  }

  return normalized.join(lineBreak);
}

function findBracketDisplayClose(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (/^ {0,3}\\\][ \t]*$/.test(line)) return index;

    // Do not pair delimiters across another Markdown block boundary.
    if (
      /^ {0,3}(`{3,}|~{3,})/.test(line) ||
      /^ {0,3}\\\[[ \t]*$/.test(line) ||
      /<(code|pre|script|style)\b/i.test(line)
    ) {
      return -1;
    }
  }

  return -1;
}

function updateInlineCodeMarker(line: string, initialMarkerSize: number): number {
  let markerSize = initialMarkerSize;
  for (let cursor = 0; cursor < line.length;) {
    if (line[cursor] !== "`") {
      cursor++;
      continue;
    }

    let end = cursor + 1;
    while (line[end] === "`") end++;
    const runSize = end - cursor;
    if (markerSize === 0) markerSize = runSize;
    else if (runSize === markerSize) markerSize = 0;
    cursor = end;
  }
  return markerSize;
}

function normalizeInlineLatexMath(line: string): string {
  if (
    /^\s{0,3}\[[^\]]+\]:/.test(line) ||
    /]\s*\(/.test(line) ||
    /<(?:!--|\/?[A-Za-z][^>]*>)/.test(line) ||
    /\b(?:https?|file|mailto):/i.test(line) ||
    /\b[A-Za-z]:\\/.test(line)
  ) {
    return line;
  }

  return line.replace(
    /(?<!\\)\\\(([^`\r\n$]+?)(?<!\\)\\\)/g,
    (match, math: string) => (math.trim() ? `$${math}$` : match),
  );
}

export const markdownRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [remarkGfm, remarkMath];
export const markdownPreviewRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [remarkGfm, remarkMath];

export const markdownRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  normalizeLocalFileLinkHrefs,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];

export const markdownPreviewRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  normalizeLocalFileLinkHrefs,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];
