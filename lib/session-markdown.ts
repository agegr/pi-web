// Render a session's active branch as the transcript a `#` session reference
// quotes: the user's messages and each assistant turn's final reply. Tool
// calls, tool results, thinking, model switches and compaction summaries stay
// out (the rule the maintainer set in #1716): the quote is the conversation,
// not the work log that produced it. The output is bounded — the start and the
// recent end are kept and the middle is elided — so a long session never floods
// the message that carries it. Read-only: entries come from a SessionManager,
// never a running wrapper.

import type { SessionEntry } from "@/lib/types";

export interface SessionMarkdownResult {
  /** The bounded transcript: `User:` / `Assistant:` messages, blank-line separated. */
  markdown: string;
  /** Messages on the branch, the elided ones included. */
  messageCount: number;
  /** Messages left out of the middle of `markdown`; 0 when it all fits. */
  omittedMessages: number;
}

export const TRANSCRIPT_MAX_MESSAGES = 300;
export const TRANSCRIPT_MAX_CHARS = 40_000;

const USER_LABEL = "User:";
const ASSISTANT_LABEL = "Assistant:";

type ContentBlock = { type?: string; text?: unknown } & Record<string, unknown>;

/** What a message entry carries: text parts, or the plain string older files hold. */
type MessageContent = string | ContentBlock[] | undefined;

interface QuotedMessage {
  /** The speaker, prefixed to the message's first line. */
  label: string;
  text: string;
}

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

function messageContent(entry: SessionEntry): MessageContent {
  if (entry.type !== "message") return undefined;
  // SAFETY: only the message entries carry `content`; the other entry types
  // render nothing here anyway.
  return (entry.message as { content?: MessageContent }).content;
}

function contentBlocks(content: MessageContent): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content as ContentBlock[];
}

function textOf(block: ContentBlock): string | null {
  return block.type === "text" && typeof block.text === "string" ? block.text : null;
}

/** A user message's text, with images named (their bytes never enter the quote). */
function userText(content: MessageContent): string {
  if (typeof content === "string") return content.trim();
  const blocks = contentBlocks(content);
  const parts: string[] = [];
  for (const block of blocks) {
    const text = textOf(block);
    if (text) parts.push(text);
  }
  if (blocks.some((block) => block.type === "image")) parts.push("[image]");
  return parts.join("\n").trim();
}

function assistantText(content: MessageContent): string {
  return contentBlocks(content)
    .map(textOf)
    .filter((part): part is string => !!part)
    .join("\n")
    .trim();
}

/** The quotable messages of a newest-first chain, returned oldest first: the
 *  quote reads in the order the conversation happened. */
function quotedMessages(chain: SessionEntry[]): QuotedMessage[] {
  const messages: QuotedMessage[] = [];
  for (let position = chain.length - 1; position >= 0; position -= 1) {
    const entry = chain[position];
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    if (role === "user") {
      const text = userText(messageContent(entry));
      if (text) messages.push({ label: USER_LABEL, text });
    } else if (role === "assistant") {
      // A turn that ends in a tool call is not the assistant's reply: its text
      // only narrates the calls the quote leaves out.
      if ((entry.message as { stopReason?: string }).stopReason === "toolUse") continue;
      const text = assistantText(messageContent(entry));
      if (text) messages.push({ label: ASSISTANT_LABEL, text });
    }
    // toolResult, system, custom and bashExecution messages carry no reply.
  }
  return messages;
}

export function sessionToMarkdown(
  entries: SessionEntry[],
  leafId: string | null,
  options: { maxMessages?: number; maxChars?: number } = {},
): SessionMarkdownResult {
  const maxMessages = options.maxMessages ?? TRANSCRIPT_MAX_MESSAGES;
  const maxChars = options.maxChars ?? TRANSCRIPT_MAX_CHARS;
  const messages = quotedMessages(newestChain(entries, leafId));
  if (!messages.length) return { markdown: "", messageCount: 0, omittedMessages: 0 };
  const rendered = messages.map((message) => {
    const line = `${message.label} ${message.text}`;
    // One message may not outgrow the whole quote.
    return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
  });

  const kept = rendered.map((_, index) => index);
  // A blank line separates the messages, so each kept message but the last
  // carries one extra character.
  let chars = rendered.reduce((sum, line) => sum + line.length, 0) + kept.length - 1;
  // Drop from the middle out, so what survives is the start of the conversation
  // and its most recent part, both caps shrinking the same way.
  while (kept.length > 1 && (kept.length > maxMessages || chars > maxChars)) {
    const at = Math.floor(kept.length / 2);
    chars -= rendered[kept[at]].length + 1;
    kept.splice(at, 1);
  }

  const omitted = messages.length - kept.length;
  let headCount = 0;
  while (headCount < kept.length && kept[headCount] === headCount) headCount += 1;
  const body = kept.slice(0, headCount).map((index) => rendered[index]);
  if (omitted > 0) body.push(`… ${omitted} messages omitted …`);
  for (const index of kept.slice(headCount)) body.push(rendered[index]);

  return {
    markdown: body.join("\n\n"),
    messageCount: messages.length,
    omittedMessages: omitted,
  };
}