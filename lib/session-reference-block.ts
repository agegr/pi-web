// Reading a sent message's `<session-reference>` blocks back: the server writes
// one into the text for every # reference (lib/session-reference.ts), so a
// message that quoted other sessions carries their whole transcript. The chat
// shows each block as one collapsed line — its title, its message count and a
// link to that session — and only expands to the text the model actually read.
//
// A block's body is plain text, so the whole message stays one string on disk
// and a nested block (a quoted message that quoted another session) reads back
// as body text inside the outer one.

import { SESSION_REFERENCE_TAG } from "./session-reference";

export interface SessionReferenceView {
  kind: "reference";
  title: string;
  id: string;
  /** The referenced session file, as the block recorded it. */
  path: string;
  /** Its project folder, as the block recorded it; empty when it recorded none. */
  cwd: string;
  /** When the session file last changed, ISO; empty when the block recorded none. */
  modified: string;
  /** Messages on the referenced branch; null when the block records no count. */
  messages: number | null;
  /** Messages the transcript left out of its middle; 0 when it kept them all. */
  omitted: number;
  /** What the model read: the text between the tags, minus its outer newlines. */
  body: string;
  /** The tag pair as stored, for a copy that keeps the message whole. */
  raw: string;
}

export interface MessageTextSegment {
  kind: "text";
  text: string;
}

export type MessageSegment = MessageTextSegment | SessionReferenceView;

// Only a tag carrying attributes opens a block: the server always writes
// `title`, `id`, `path` and `messages` (lib/session-reference.ts), while a
// conversation *about* this feature writes the bare name in prose. Reading a
// bare `<session-reference>` as an opening tag would swallow the message.
const ATTRIBUTES = String.raw`(?:\s+[a-zA-Z-]+="[^"]*")*`;
const OPEN_TAG_RE = () => new RegExp(`<${SESSION_REFERENCE_TAG}${ATTRIBUTES}\\s*>`, "g");
const ANY_TAG_RE = () => new RegExp(`<${SESSION_REFERENCE_TAG}${ATTRIBUTES}\\s*>|</${SESSION_REFERENCE_TAG}>`, "g");

function unescapeAttribute(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function attributesOf(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    attributes.set(match[1], unescapeAttribute(match[2]));
  }
  return attributes;
}

/** The index of the `</session-reference>` that closes the block opened before
 *  `from`, counting the blocks nested inside it. The fallback covers a body that
 *  carries a complete block written by hand but no closing tag of its own
 *  (a conversation about this feature); -1 when no tag closes it. */
function closingTagIndex(text: string, from: number): number {
  const tags = ANY_TAG_RE();
  tags.lastIndex = from;
  let depth = 1;
  let firstClose = -1;
  for (let match = tags.exec(text); match; match = tags.exec(text)) {
    if (match[0].startsWith("</")) {
      if (firstClose === -1) firstClose = match.index;
      depth -= 1;
      if (depth === 0) return match.index;
    } else {
      depth += 1;
    }
  }
  return firstClose;
}

/** A message's text as a label reads it (a session's first message in the
 *  sidebar, the # picker, a chip's title): each quoted session as `#title`, not
 *  its transcript. A message that quoted other sessions holds their whole
 *  transcripts, tags included, which would otherwise make up the label. */
export function sessionReferencesAsMentions(text: string): string {
  if (!text.includes(`<${SESSION_REFERENCE_TAG} `)) return text;
  const segments = splitSessionReferences(text);
  if (!segments.some((segment) => segment.kind === "reference")) return text;
  return segments
    .map((segment) => segment.kind === "text"
      ? segment.text
      : `#${segment.title.trim() || segment.id.slice(0, 8)}`)
    .join("\n\n");
}

/** Split a message's text at its reference blocks: what the user typed around
 *  them, and one segment per block, in order. An unclosed tag is left as text,
 *  so a message that only mentions the syntax never loses its tail. */
export function splitSessionReferences(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const pushText = (value: string) => {
    const trimmed = value.replace(/^\n+/, "").replace(/\s+$/, "");
    if (trimmed) segments.push({ kind: "text", text: trimmed });
  };
  const openTags = OPEN_TAG_RE();
  let cursor = 0;
  for (let open = openTags.exec(text); open; open = openTags.exec(text)) {
    if (open.index < cursor) continue;
    const bodyStart = open.index + open[0].length;
    const closeAt = closingTagIndex(text, bodyStart);
    if (closeAt === -1) break;
    const attributes = attributesOf(open[0]);
    const count = Number.parseInt(attributes.get("messages") ?? "", 10);
    const omitted = Number.parseInt(attributes.get("omitted") ?? "", 10);
    pushText(text.slice(cursor, open.index));
    segments.push({
      kind: "reference",
      title: attributes.get("title") ?? "",
      id: attributes.get("id") ?? "",
      path: attributes.get("path") ?? "",
      cwd: attributes.get("cwd") ?? "",
      modified: attributes.get("modified") ?? "",
      messages: Number.isFinite(count) ? count : null,
      omitted: Number.isFinite(omitted) && omitted > 0 ? omitted : 0,
      body: text.slice(bodyStart, closeAt).replace(/^\n+/, "").replace(/\n+$/, ""),
      raw: text.slice(open.index, closeAt + `</${SESSION_REFERENCE_TAG}>`.length),
    });
    cursor = closeAt + `</${SESSION_REFERENCE_TAG}>`.length;
    openTags.lastIndex = cursor;
  }
  pushText(text.slice(cursor));
  return segments;
}