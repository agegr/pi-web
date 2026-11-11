export interface NoticeTextPart {
  kind: "text" | "art";
  text: string;
}

// Block elements (█ ▀ ▄ ▌ ░ …): what terminal QR codes and bars are drawn with.
const BLOCK_ELEMENT_RE = /[▀-▟]/;

/**
 * Splits an extension notice into prose and the runs of lines drawn with block
 * characters, such as a `qrcode-terminal` QR code sent through `ctx.ui.notify()`
 * (#755). Those only line up on a terminal grid: every space kept, one monospace
 * font for spaces and blocks alike, no gap between rows. The toast's prose styling
 * collapses runs of spaces and spaces its lines apart. Joining the parts' text
 * gives back the message; the line breaks around a run stay in the prose.
 */
export function splitNoticeText(message: string): NoticeTextPart[] {
  const parts: NoticeTextPart[] = [];
  const push = (kind: NoticeTextPart["kind"], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };

  let previousIsArt = false;
  message.split("\n").forEach((line, index) => {
    const isArt = BLOCK_ELEMENT_RE.test(line);
    if (index > 0) push(isArt && previousIsArt ? "art" : "text", "\n");
    push(isArt ? "art" : "text", line);
    previousIsArt = isArt;
  });
  return parts;
}

export interface NoticeLinkPart {
  kind: "text" | "link";
  text: string;
}

// An http(s) URL up to whitespace, a quote, a closing bracket or full-width
// punctuation ("打开 http://localhost:3000。"), with an IPv6 host in brackets
// (`http://[::1]:3000`). A `)` is kept only while it closes a `(` of the URL's
// own (`…/wiki/Foo_(bar)`), as GFM autolinks do; trailing sentence punctuation
// is trimmed below ("Open http://localhost:3000.").
const URL_RE = /https?:\/\/(?:\[[0-9A-Fa-f:.]+\])?[^\s<>"'`\]}。，、；：！？）」』】]*/g;
const TRAILING_PUNCTUATION_RE = /^[.,;:!?]$/;

function trimUrl(candidate: string): string {
  // Counted once and kept in step while trimming: re-counting the whole URL for
  // each `)` was quadratic on a long run of them.
  let open = 0;
  let close = 0;
  for (const char of candidate) {
    if (char === "(") open += 1;
    else if (char === ")") close += 1;
  }
  let end = candidate.length;
  while (end > 0) {
    const last = candidate[end - 1];
    if (TRAILING_PUNCTUATION_RE.test(last)) {
      end -= 1;
    } else if (last === ")" && close > open) {
      end -= 1;
      close -= 1;
    } else {
      break;
    }
  }
  return candidate.slice(0, end);
}

/**
 * Splits prose into text and the http(s) URLs in it, so a notice such as
 * "Code review opened at http://localhost:39193" can be opened with a click,
 * as a terminal lets one open the same line from pi's TUI. Joining the parts'
 * text gives back the input.
 */
export function splitNoticeLinks(text: string): NoticeLinkPart[] {
  const parts: NoticeLinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = trimUrl(match[0]);
    if (!/^https?:\/\/[^/]/.test(url)) continue;
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push({ kind: "link", text: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
