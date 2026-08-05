import type { Options as ReactMarkdownOptions } from "react-markdown";
import { load as parseYaml } from "js-yaml";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
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

    normalized.push(normalizeInlineLatexMath(line));
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

// Parse YAML frontmatter into a `yaml` node before the math/GFM plugins run, so
// the raw metadata never leaks into the rendered output (without it, the opening
// `---` becomes an <hr> and the closing `---` turns the YAML into a setext heading).
export const markdownRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [[remarkFrontmatter, ["yaml"]], remarkGfm, remarkMath];
export const markdownPreviewRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [[remarkFrontmatter, ["yaml"]], remarkGfm, remarkMath];

/**
 * Leading `---`-fenced YAML block. Mirrors what `remarkFrontmatter(["yaml"])`
 * recognizes so the metadata card and the hidden-in-body behavior stay in sync.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface FrontmatterResult {
  /** Parsed metadata, or null when the document has no valid frontmatter. */
  data: Record<string, unknown> | null;
  /** Markdown with the frontmatter block removed. */
  rest: string;
}

export function parseFrontmatter(markdown: string): FrontmatterResult {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) return { data: null, rest: markdown };

  try {
    const parsed = parseYaml(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, rest: markdown.slice(match[0].length) };
    }
  } catch {
    // Malformed YAML: leave the text untouched, the frontmatter plugin still hides it.
  }

  return { data: null, rest: markdown };
}

export const markdownRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];

export const markdownPreviewRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];
