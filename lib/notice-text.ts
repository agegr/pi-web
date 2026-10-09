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
