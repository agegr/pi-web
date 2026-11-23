// Render a session's active branch as the transcript a `#` session reference
// quotes: the user's messages and each assistant turn's final reply. Tool
// calls, tool results, thinking, model switches and compaction summaries stay
// out (the rule the maintainer set in #1716): the quote is the conversation,
// not the work log that produced it. What the quote keeps in full is the focus:
// the newest few turns, the part a reader quoting a session usually wants to
// carry on from. Everything older is condensed to the question that opened each
// turn, so the model still gets the thread for a fraction of the characters and
// a long session never floods the message that carries it. The cut works in
// whole turns, so a question is never kept without the reply it got. Read-only:
// entries come from a SessionManager, never a running wrapper.

import type { SessionEntry } from "@/lib/types";

export interface SessionMarkdownResult {
  /** The transcript: condensed earlier questions, then the focus turns in full. */
  markdown: string;
  /** Messages on the branch, the left-out ones included. */
  messageCount: number;
  /** Messages nowhere in `markdown`; 0 when it all fits. */
  omittedMessages: number;
}

export const TRANSCRIPT_MAX_MESSAGES = 300;
export const TRANSCRIPT_MAX_CHARS = 40_000;

/** Turns the quote keeps in full: the newest ones. Older turns are condensed to
 *  the question that opened them (`OUTLINE_MAX_CHARS` each). */
export const TRANSCRIPT_FOCUS_TURNS = 3;

/** How much of an older turn's opening question the condensed list shows. */
const OUTLINE_MAX_CHARS = 80;

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

/** The quotable messages grouped into turns, as message positions: a turn
 *  starts at a user message and runs through the replies up to the next one. An
 *  assistant reply with no user message before it (its question was not
 *  quotable) opens a turn of its own, so nothing is dropped on the way in. */
function turnsOf(messages: QuotedMessage[]): number[][] {
  const turns: number[][] = [];
  messages.forEach((message, index) => {
    if (message.label === USER_LABEL || !turns.length) turns.push([index]);
    else turns[turns.length - 1].push(index);
  });
  return turns;
}

/** One line for a turn older than the focus: its opening message, cut to
 *  `OUTLINE_MAX_CHARS`, so the thread stays readable for ~80 characters. */
function outlineOf(message: QuotedMessage): string {
  const line = message.text.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return `${message.label} ${line.length > OUTLINE_MAX_CHARS ? `${line.slice(0, OUTLINE_MAX_CHARS - 1)}…` : line}`;
}

export function sessionToMarkdown(
  entries: SessionEntry[],
  leafId: string | null,
  options: { maxMessages?: number; maxChars?: number; focusTurns?: number } = {},
): SessionMarkdownResult {
  const maxMessages = options.maxMessages ?? TRANSCRIPT_MAX_MESSAGES;
  const maxChars = options.maxChars ?? TRANSCRIPT_MAX_CHARS;
  const focusTurns = Math.max(1, options.focusTurns ?? TRANSCRIPT_FOCUS_TURNS);
  const messages = quotedMessages(newestChain(entries, leafId));
  if (!messages.length) return { markdown: "", messageCount: 0, omittedMessages: 0 };
  const rendered = messages.map((message) => {
    const line = `${message.label} ${message.text}`;
    // One message may not outgrow the whole quote.
    return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
  });

  const turns = turnsOf(messages);
  const focusStart = Math.max(0, turns.length - focusTurns);
  // Everything older than the focus becomes one line per turn; the focus keeps
  // every message of its turns. The opening turn's own label is used because a
  // turn can open with a reply whose question was not quotable.
  const outline = turns.slice(0, focusStart).map((turn) => outlineOf(messages[turn[0]]));
  const focus = turns.slice(focusStart);

  // What is on screen, in the order it is written: the condensed lines (one per
  // line, single newlines) and then the focus messages (blank-line separated).
  let outlineStart = 0;
  let focusDrop = 0;
  const laidOut = () => {
    const lines = outline.slice(outlineStart);
    const focusIndexes = focus.slice(focusDrop).flatMap((turn) => turn);
    const outlineChars = lines.reduce((sum, line) => sum + line.length, 0) + Math.max(0, lines.length - 1);
    const focusChars = focusIndexes.reduce((sum, index) => sum + rendered[index].length, 0)
      + Math.max(0, focusIndexes.length - 1) * 2;
    const gap = lines.length && focusIndexes.length ? 2 : 0;
    return { chars: outlineChars + focusChars + gap, messages: lines.length + focusIndexes.length };
  };
  // Over a cap, the oldest background goes first; only once it is gone does the
  // oldest focus turn go, and the newest turn always stays whole (each message
  // was cut to the cap above): cutting into a turn is the one thing this must
  // not do. Because the background is given up before any focus turn, the gap
  // the note reports is always at one place: between the two parts.
  for (;;) {
    const { chars, messages: kept } = laidOut();
    if (kept <= maxMessages && chars <= maxChars) break;
    if (outlineStart < outline.length) outlineStart += 1;
    else if (focusDrop < focus.length - 1) focusDrop += 1;
    else break;
  }

  const lines = outline.slice(outlineStart);
  const focusIndexes = focus.slice(focusDrop).flatMap((turn) => turn);
  const omitted = messages.length - lines.length - focusIndexes.length;
  const body: string[] = [];
  if (lines.length) body.push(lines.join("\n"));
  if (lines.length) {
    // The count is messages, as the collapsed block shows it; the note says why
    // they are gone when the earlier turns were condensed rather than dropped.
    body.push(`… earlier turns condensed to their first question${omitted > 0 ? ` (${omitted} messages omitted)` : ""} …`);
  } else if (omitted > 0) {
    body.push(`… ${omitted} messages omitted …`);
  }
  for (const index of focusIndexes) body.push(rendered[index]);

  return {
    markdown: body.join("\n\n"),
    messageCount: messages.length,
    omittedMessages: omitted,
  };
}