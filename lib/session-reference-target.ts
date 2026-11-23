// A # session reference as the composer holds it. The compact
// `[title](#session:<uuid>)` token is written into the message only when it is
// sent, so the textarea keeps the user's own words and the reference shows as a
// removable chip beside the attachments (#1716). The server turns each token
// into a `<session-reference>` block at send time (lib/session-reference.ts).

export interface SessionReferenceTarget {
  id: string;
  /** The session's title when it was picked: the token's link text. */
  title: string;
  /** Its project folder, for the chip's tooltip. */
  cwd?: string;
  /** Its last update, ISO, for the chip's tooltip. */
  modified?: string;
}

/** One message quotes at most this many sessions. */
export const MAX_SESSION_REFERENCES = 8;

/** What the chip reads: the title, or the id's start when the session has none. */
export function referenceTitle(target: SessionReferenceTarget): string {
  return target.title.trim() || target.id.slice(0, 8);
}

/** The token for one reference. Brackets in the title become spaces: a `]` in
 *  the link text would end the token early and it would never read back. */
export function sessionReferenceToken(target: SessionReferenceTarget): string {
  return `[${referenceTitle(target).replace(/[[\]]/g, " ")}](#session:${target.id})`;
}

/** Every reference's token, one per line; empty when there are none. */
export function sessionReferenceTokens(targets: readonly SessionReferenceTarget[]): string {
  return targets.map(sessionReferenceToken).join("\n");
}

/** The message as sent: the user's text, then the tokens the server expands. */
export function withSessionReferences(text: string, targets: readonly SessionReferenceTarget[]): string {
  const tokens = sessionReferenceTokens(targets);
  if (!tokens) return text;
  const body = text.trimEnd();
  return body ? `${body}\n\n${tokens}` : tokens;
}

/** Whether `id` may join the list: the same session twice would quote it twice. */
export function canAddSessionReference(
  targets: readonly SessionReferenceTarget[],
  id: string,
): boolean {
  return targets.length < MAX_SESSION_REFERENCES && !targets.some((target) => target.id === id);
}