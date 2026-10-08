import { skillExpansionToCommand } from "./slash-display";

/**
 * The name the sidebar's Fork gives its copy: the title the sidebar shows for
 * the source plus a short random suffix ("PR#1030 状态栏命令按钮 · 3f9a"), so
 * the copy and its source can be told apart in the tree. Client-safe: the
 * copy's row and the Fork's toast split the suffix off, so their one-line
 * ellipsis cuts the title before it and never the suffix.
 */

/** Code points of the source's title kept: a name, not a whole first message. */
export const FORK_NAME_BASE_MAX = 40;

/** A Fork's suffix at the end of a name: the separator and 4 lowercase hex digits. */
const FORK_SUFFIX_RE = / · [0-9a-f]{4}$/;

/**
 * A session's title as its sidebar row shows it (sessionRowTitle() in
 * components/SessionTree.tsx, which renders it cut to 50 UTF-16 units): its
 * stored name, else its first user message with an SDK skill expansion shown
 * as the /skill:name command, else its id. `name` and `firstMessage` are the
 * session list's own (scanSessionFileInfo()).
 */
export function sessionDisplayTitle(session: { id: string; name?: string; firstMessage: string }): string {
  return session.name
    || (skillExpansionToCommand(session.firstMessage) ?? session.firstMessage)
    || session.id.slice(0, 12);
}

/** `text` cut to at most `max` code points, the last an ellipsis; a surrogate pair is never split. */
export function shortenToCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * The copy's name: `sourceTitle` on one line, cut to FORK_NAME_BASE_MAX code
 * points, then " · " and `suffix`. An earlier Fork's suffix is dropped first,
 * so forks of forks do not stack them; only when the source is itself a fork
 * (`sourceIsFork`, a header `parentSession`), so a session its user named
 * "Weekly sync · 2024" keeps its whole name. `sourceTitle` is not blank
 * (forkSessionBranch() gives a blank one the source's id).
 */
export function forkSessionName(sourceTitle: string, suffix: string, sourceIsFork: boolean): string {
  let base = sourceTitle.replace(/\s+/g, " ").trim();
  if (sourceIsFork) base = base.replace(FORK_SUFFIX_RE, "").trimEnd();
  base = shortenToCodePoints(base, FORK_NAME_BASE_MAX);
  return base ? `${base} · ${suffix}` : suffix;
}

/**
 * A name split before its Fork suffix: `base`, which a one-line view may cut,
 * and `suffix` (" · 3f9a", separator included), which it keeps in view. Null
 * when the name does not end in one or is nothing but one. Callers split only
 * a fork's name (header `parentSession`), as forkSessionName() strips only a
 * fork's.
 */
export function splitForkSuffix(name: string): { base: string; suffix: string } | null {
  const match = FORK_SUFFIX_RE.exec(name);
  if (!match || match.index === 0) return null;
  return { base: name.slice(0, match.index), suffix: match[0] };
}

/**
 * A message naming a fork (the Fork's toast) split before the name's suffix:
 * `head`, which a one-line view may cut, and `tail`, the suffix and what
 * follows it in the message (a closing quote), which it keeps in view. Null
 * when `name` has no suffix or `message` does not contain it.
 */
export function splitBeforeForkSuffix(message: string, name: string): { head: string; tail: string } | null {
  const suffix = splitForkSuffix(name)?.suffix;
  const at = suffix ? message.lastIndexOf(suffix) : -1;
  return at > 0 ? { head: message.slice(0, at), tail: message.slice(at) } : null;
}
