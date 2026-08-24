import type { RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function selectedText(markdown: string): string {
  try {
    return normalizedText(toString(unified().use(remarkParse).parse(markdown)));
  } catch {
    return normalizedText(markdown);
  }
}

function nodeKind(node: RootContent): string | null {
  if (node.type === "heading") return `h${node.depth}`;
  if (node.type === "listItem") return "li";
  if (node.type === "paragraph") return "p";
  return null;
}

/**
 * Resolve quoted Markdown to the same block key emitted by MarkdownBody.
 * This is both a fallback for DOM selections without a usable ancestor and a
 * compatibility path for threads created before anchorKey was persisted.
 */
export function findMarkdownThreadAnchor(
  markdown: string,
  selectionMarkdown: string,
  blockKeyPrefix: string,
): string | undefined {
  const needle = selectedText(selectionMarkdown);
  if (!needle) return undefined;
  const tree = unified().use(remarkParse).parse(markdown);
  const candidates: Array<{ key: string; text: string; preferred: boolean }> = [];
  const wantsListItem = /^\s*(?:[-*+] |\d+[.)]\s+)/.test(selectionMarkdown);
  const wantsHeading = /^\s{0,3}#{1,6}\s+/.test(selectionMarkdown);

  visit(tree, (node) => {
    const content = node as RootContent;
    const kind = nodeKind(content);
    const offset = content.position?.start.offset;
    if (!kind || typeof offset !== "number") return;
    const text = normalizedText(toString(content));
    if (!text || (!text.includes(needle) && !needle.includes(text))) return;
    candidates.push({
      key: `${blockKeyPrefix}:${kind}:${offset}`,
      text,
      preferred: (wantsListItem && kind === "li") || (wantsHeading && kind.startsWith("h")),
    });
  });

  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.text.length - b.text.length);
  return candidates[0]?.key;
}
