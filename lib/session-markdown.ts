// Render a session's active branch as bounded Markdown for the composer's #
// session mention: user and assistant text, one line per tool call, a short
// tool-result excerpt, and compaction summaries. Thinking blocks are skipped
// (they dominate the size) and the output is capped so a long session never
// floods the message. Read-only: entries come from a SessionManager, never a
// running wrapper.

import type { SessionEntry } from "@/lib/types";

export interface SessionMarkdownResult {
  markdown: string;
  /** True when the entry or char cap cut the branch short. */
  truncated: boolean;
  /** Entries actually rendered. */
  includedEntries: number;
  /** Entries considered (the branch capped at maxEntries). */
  totalEntries: number;
}

export const SESSION_MARKDOWN_MAX_ENTRIES = 300;
export const SESSION_MARKDOWN_MAX_CHARS = 40_000;
const TOOL_ARG_MAX_CHARS = 120;
const TOOL_RESULT_MAX_CHARS = 200;

type ContentBlock = { type?: string; text?: unknown; thinking?: unknown } & Record<string, unknown>;

/** The ancestor chain from `leafId` back to the session header, newest first. */
function newestChain(entries: SessionEntry[], leafId: string | null): SessionEntry[] {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  const chain: SessionEntry[] = [];
  const seen = new Set<string>();
  let current: SessionEntry | undefined = leafId ? byId.get(leafId) : entries[entries.length - 1];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

function messageContent(entry: SessionEntry): unknown {
  if (entry.type !== "message") return undefined;
  // SAFETY: only user/assistant/toolResult messages carry `content`; the other
  // roles (system, custom, bashExecution) render nothing here anyway.
  return (entry.message as { content?: unknown }).content;
}

function contentBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content as ContentBlock[];
}

function textOf(block: ContentBlock): string | null {
  return block.type === "text" && typeof block.text === "string" ? block.text : null;
}

function toolCallLine(block: ContentBlock): string {
  const name = typeof block.name === "string" ? block.name : "?";
  let args = "";
  if (typeof block.arguments === "string") {
    args = block.arguments;
  } else if (block.arguments && typeof block.arguments === "object") {
    try {
      args = JSON.stringify(block.arguments);
    } catch {
      args = "";
    }
  }
  if (args.length > TOOL_ARG_MAX_CHARS) args = `${args.slice(0, TOOL_ARG_MAX_CHARS)}…`;
  return `${name}(${args})`;
}

function renderEntry(entry: SessionEntry): string | null {
  if (entry.type === "message") {
    const role = entry.message?.role;
    const blocks = contentBlocks(messageContent(entry));
    if (role === "user") {
      const parts: string[] = [];
      for (const block of blocks) {
        const text = textOf(block);
        if (text) parts.push(text);
      }
      if (blocks.some((block) => block.type === "image")) parts.push("[图片]");
      return parts.filter((part) => part.trim()).join("\n") || null;
    }
    if (role === "assistant") {
      const parts: string[] = [];
      for (const block of blocks) {
        const text = textOf(block);
        if (text) {
          parts.push(text);
        } else if (block.type === "toolCall" || block.type === "tool_call") {
          parts.push(`[工具调用: ${toolCallLine(block)}]`);
        }
      }
      const text = parts.filter((part) => part.trim()).join("\n");
      return text || null;
    }
    if (role === "toolResult") {
      const text = blocks.map((block) => textOf(block)).filter((part): part is string => !!part).join("\n");
      if (!text.trim()) return null;
      const cut = text.length > TOOL_RESULT_MAX_CHARS ? `${text.slice(0, TOOL_RESULT_MAX_CHARS)}…` : text;
      return `[工具结果: ${cut}]`;
    }
    return null; // system, custom, bashExecution
  }
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
    return summary ? `> 摘要: ${summary}` : null;
  }
  if (entry.type === "model_change") {
    return `> 模型: ${entry.provider}/${entry.modelId}`;
  }
  return null;
}

export function sessionToMarkdown(
  entries: SessionEntry[],
  leafId: string | null,
  options: { maxEntries?: number; maxChars?: number } = {},
): SessionMarkdownResult {
  const maxEntries = options.maxEntries ?? SESSION_MARKDOWN_MAX_ENTRIES;
  const maxChars = options.maxChars ?? SESSION_MARKDOWN_MAX_CHARS;
  const chain = newestChain(entries, leafId);
  const considered = chain.length > maxEntries ? chain.slice(-maxEntries) : chain;
  const lines: string[] = [];
  let chars = 0;
  let truncated = false;
  for (const entry of considered) {
    const rendered = renderEntry(entry);
    if (!rendered) continue;
    const nextChars = chars + rendered.length;
    if (nextChars > maxChars) {
      truncated = true;
      break;
    }
    lines.push(rendered);
    chars = nextChars;
  }
  return {
    markdown: lines.join("\n"),
    truncated,
    includedEntries: lines.length,
    totalEntries: considered.length,
  };
}
