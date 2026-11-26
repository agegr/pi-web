// Render a session's active branch as the transcript a `#` session reference
// quotes: the user's messages and each assistant turn's final reply. Tool
// calls, tool results, thinking, model switches and compaction summaries stay
// out (the rule the maintainer set in #1716): the quote is the conversation,
// not the work log that produced it. A session under the caps is quoted whole;
// over them the quote keeps the beginning and the recent end, with a note
// saying how many messages are left out between them (#1716). The cut works in
// whole turns, so a question is never kept without the reply it got. Read-only:
// entries come from a SessionManager, never a running wrapper.

import type { SessionEntry } from "@/lib/types";

export interface SessionMarkdownResult {
  /** The transcript: the beginning, the omitted note when cut, the recent end. */
  markdown: string;
  /** Messages on the branch, the left-out ones included. */
  messageCount: number;
  /** Messages nowhere in `markdown`; 0 when it all fits. */
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

/** The line where the quote was cut, saying how many messages are not in it. */
function omittedNote(count: number): string {
  return `… ${count} ${count === 1 ? "message" : "messages"} omitted …`;
}

/** Cut the given messages so their text fits `room` characters: the shortest
 *  first takes all it needs, the rest share what is left. */
function cutToFit(rendered: string[], indexes: number[], room: number): void {
  const shortestFirst = [...indexes].sort((a, b) => rendered[a].length - rendered[b].length);
  shortestFirst.forEach((index, position) => {
    const share = Math.max(1, Math.floor(room / (shortestFirst.length - position)));
    if (rendered[index].length > share) rendered[index] = `${rendered[index].slice(0, share - 1)}…`;
    room -= rendered[index].length;
  });
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
  // The beginning, the note where the quote was cut, the recent end.
  const result = (head: number[], tail: number[]): SessionMarkdownResult => {
    const omitted = messages.length - head.length - tail.length;
    const pieces = [
      ...head.map((index) => rendered[index]),
      ...(omitted > 0 ? [omittedNote(omitted)] : []),
      ...tail.map((index) => rendered[index]),
    ];
    return { markdown: pieces.join("\n\n"), messageCount: messages.length, omittedMessages: omitted };
  };

  // Under both caps the quote is the whole conversation (#1716).
  const fullChars = rendered.reduce((sum, line) => sum + line.length, 0) + (rendered.length - 1) * 2;
  if (messages.length <= maxMessages && fullChars <= maxChars) return result([], messages.map((_, index) => index));

  // Over a cap: the beginning and the recent end in whole turns, so no reply
  // loses its question, and the note between them. A message costs its text
  // and the blank line after it; the note's room is set aside up front (its
  // count can only be shorter than the branch's).
  const turns = turnsOf(messages);
  const room = maxChars - omittedNote(messages.length).length;
  const cost = (turn: number[]) => turn.reduce((sum, index) => sum + rendered[index].length + 2, 0);
  let chars = 0;
  let count = 0;
  const fits = (turn: number[], limitChars: number, limitMessages: number) =>
    chars + cost(turn) <= limitChars && count + turn.length <= limitMessages;
  const take = (turn: number[]) => {
    chars += cost(turn);
    count += turn.length;
  };
  // The beginning gets at most a quarter, so the recent end, what a reader
  // quoting a session usually carries on from, keeps most of the room.
  let first = 0;
  while (first < turns.length - 1 && fits(turns[first], room / 4, maxMessages / 4)) take(turns[first++]);
  let last = turns.length;
  while (last > first && fits(turns[last - 1], room, maxMessages)) take(turns[--last]);
  if (last === turns.length) {
    // The newest turn does not fit beside the beginning: it comes first.
    first = 0;
    chars = 0;
    count = 0;
    while (last > 0 && fits(turns[last - 1], room, maxMessages)) take(turns[--last]);
  }
  if (last === turns.length) {
    // The newest turn does not fit even beside nothing: it is quoted alone,
    // its messages cut to share the room.
    const newest = turns[turns.length - 1].slice(-maxMessages);
    const omitted = messages.length > newest.length;
    cutToFit(rendered, newest, (omitted ? room - 2 : maxChars) - (newest.length - 1) * 2);
    return result([], newest);
  }
  // What the recent end could not use goes to the beginning.
  while (first < last && fits(turns[first], room, maxMessages)) take(turns[first++]);
  return result(turns.slice(0, first).flat(), turns.slice(last).flat());
}
