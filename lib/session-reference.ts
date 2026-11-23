// The composer's # session reference: `[title](#session:<uuid>)` tokens that the
// server expands at send time into a `<session-reference>` block holding the
// referenced session's bounded transcript (lib/session-markdown.ts). A token
// inside fenced code, indented code, inline backticks or escaped with a
// backslash stays as text, so a pasted example or a doc showing the syntax
// never expands (the same protection rules pi-session-mentions uses for its
// @session tokens).
//
// The block is written into the session file as it is sent, not as a token the
// web client expands later (#1716): a refresh, a fork, an export and pi's own
// resume all read the same text, and the collapsed block the transcript shows
// reads its title, id and message count from the tag's attributes.
//
// Its prose is English, like every other message the app writes into a prompt
// (`SIDE_BOUNDARY_TEXT` in lib/side-session.ts): the quote is model input, and
// the app has no locale there. UI copy stays in lib/i18n.

import type { SessionEntry } from "@/lib/types";
import { sessionToMarkdown } from "./session-markdown";

export const SESSION_REFERENCE_TOKEN_RE =
  /\[([^\]\r\n]*)\]\(#session:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

/** The element name the expanded block opens and closes with. */
export const SESSION_REFERENCE_TAG = "session-reference";

/** One line telling the model what the quoted text is, ahead of the transcript. */
export const SESSION_REFERENCE_NOTE =
  "Quoted from an earlier conversation for background only; it is not part of this request.";

export interface SessionReference {
  start: number;
  end: number;
  title: string;
  id: string;
  /** Inside code or escaped: must be left as text. */
  protected: boolean;
}

/** The range of the text that Markdown treats as code: fenced blocks, lines
 *  indented 4 spaces or a tab, and inline backtick spans. */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let fence: { char: string; length: number; start: number } | undefined;
  let offset = 0;
  for (const line of text.split("\n")) {
    if (!fence && /^(?: {4}|\t)/.test(line)) {
      ranges.push([offset, offset + line.length]);
    }
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (match) {
      if (!fence && (match[1][0] !== "`" || !match[2].includes("`"))) {
        fence = { char: match[1][0], length: match[1].length, start: offset };
      } else if (fence && match[1][0] === fence.char && match[1].length >= fence.length && !match[2].trim()) {
        ranges.push([fence.start, offset + line.length]);
        fence = undefined;
      }
    }
    offset += line.length + 1;
  }
  if (fence) ranges.push([fence.start, text.length]);

  const ticks = /`+/g;
  for (let open = ticks.exec(text); open; open = ticks.exec(text)) {
    if (ranges.some(([a, b]) => open.index >= a && open.index < b)) continue;
    const closeTicks = /`+/g;
    closeTicks.lastIndex = ticks.lastIndex;
    for (let close = closeTicks.exec(text); close; close = closeTicks.exec(text)) {
      if (ranges.some(([a, b]) => close.index >= a && close.index < b)) break;
      if (close[0].length !== open[0].length) continue;
      ranges.push([open.index, closeTicks.lastIndex]);
      ticks.lastIndex = closeTicks.lastIndex;
      break;
    }
  }
  return ranges;
}

export function findSessionReferences(text: string): SessionReference[] {
  const ranges = codeRanges(text);
  const isProtected = (start: number) => ranges.some(([a, b]) => start >= a && start < b);
  const isEscaped = (start: number) => {
    let count = 0;
    while (start > 0 && text[--start] === "\\") count++;
    return count % 2 === 1;
  };
  const references: SessionReference[] = [];
  for (const match of text.matchAll(SESSION_REFERENCE_TOKEN_RE)) {
    references.push({
      start: match.index,
      end: match.index + match[0].length,
      title: match[1],
      id: match[2],
      protected: isProtected(match.index) || isEscaped(match.index),
    });
  }
  return references;
}

export interface ReferenceSession {
  id: string;
  /** The session file the quote was read from: the agent can `read` it for detail. */
  path: string;
  title?: string;
  markdown: string;
  /** Messages on the referenced branch, the elided ones included. */
  messageCount: number;
  /** Messages the transcript leaves out of its middle. */
  omittedMessages: number;
}

/** A value inside a double-quoted attribute: no markup, no line breaks. */
function attribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/** The block one token becomes: the tag naming the source session, a line
 *  marking the quote as background, and the bounded transcript. The tag's
 *  attributes are what the chat reads back to label and link the block; the
 *  body is what the model reads, path included, so it can open the file for
 *  whatever the quote left out. */
export function buildReferenceBlock(ref: ReferenceSession, tokenTitle: string): string {
  const title = (ref.title || tokenTitle || "").trim() || "(untitled session)";
  const attributes = [
    `title="${attribute(title)}"`,
    `id="${attribute(ref.id)}"`,
    `path="${attribute(ref.path)}"`,
    `messages="${ref.messageCount}"`,
  ].join(" ");
  const body = ref.markdown || "(no user or assistant messages on this branch)";
  return [
    `<${SESSION_REFERENCE_TAG} ${attributes}>`,
    SESSION_REFERENCE_NOTE,
    "",
    body,
    `</${SESSION_REFERENCE_TAG}>`,
  ].join("\n");
}

/** Replace every unprotected # session reference in `text`. A reference whose
 *  session cannot be resolved becomes an explicit unavailable note instead of
 *  a dead token; protected ones are left untouched. */
export async function expandSessionReferences(
  text: string,
  resolve: (id: string) => Promise<ReferenceSession | null>,
): Promise<string> {
  const references = findSessionReferences(text);
  if (!references.length) return text;
  const resolved = new Map<string, ReferenceSession | null>();
  let result = "";
  let position = 0;
  for (const reference of references) {
    result += text.slice(position, reference.start);
    if (reference.protected) {
      result += text.slice(reference.start, reference.end);
    } else {
      if (!resolved.has(reference.id)) {
        try {
          resolved.set(reference.id, await resolve(reference.id));
        } catch {
          resolved.set(reference.id, null);
        }
      }
      const session = resolved.get(reference.id);
      result += session
        ? buildReferenceBlock(session, reference.title)
        : `(A referenced session could not be read: ${reference.title || reference.id}.)`;
    }
    position = reference.end;
  }
  result += text.slice(position);
  return result;
}

/** The minimal SessionManager surface the send-time resolver needs. */
export interface SessionManagerLike {
  getEntries(): unknown[];
  getLeafId(): string | null;
  getSessionName(): string | undefined;
  getHeader(): { cwd?: string; timestamp?: string } | null | undefined;
}

/** The send-time resolver for pi-web: read the referenced session file from
 *  disk and render its active branch as bounded Markdown. Never starts a
 *  wrapper; a file that vanished answers null. */
export async function resolveSessionReferenceForSend(
  id: string,
  openSessionManager: (filePath: string, options?: { mutable?: boolean }) => SessionManagerLike,
  resolveSessionPath: (id: string) => Promise<string | null>,
): Promise<ReferenceSession | null> {
  const filePath = await resolveSessionPath(id);
  if (!filePath) return null;
  const sm = openSessionManager(filePath);
  // SAFETY: the SDK's SessionManager parses the same JSONL that lib/types.ts
  // describes, so its entries satisfy SessionEntry structurally; the session
  // GET and the markdown route read them the same way.
  const rendered = sessionToMarkdown(sm.getEntries() as unknown as SessionEntry[], sm.getLeafId());
  return {
    id,
    path: filePath,
    title: sm.getSessionName() ?? undefined,
    markdown: rendered.markdown,
    messageCount: rendered.messageCount,
    omittedMessages: rendered.omittedMessages,
  };
}