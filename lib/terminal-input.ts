export interface TerminalKeyEventLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const SPECIAL_KEY_SEQUENCES: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Escape: "\x1b",
  Backspace: "\x7f",
};

const ALT_ARROW_SEQUENCES: Record<string, string> = {
  ArrowLeft: "\x1bb",
  ArrowRight: "\x1bf",
  ArrowUp: "\x1bp",
  ArrowDown: "\x1bn",
};

function legacyCtrlSequence(key: string): string | null {
  if (key.length !== 1) return null;
  const code = key.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code & 0x1f);
  if (key === "?") return "\x7f";
  return null;
}

export function toTerminalKeyData(event: TerminalKeyEventLike): string | null {
  if (event.metaKey) return null;
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "v") return null;

  if (event.ctrlKey && !event.altKey) {
    const control = legacyCtrlSequence(event.key);
    if (control) return control;
  }

  if (event.altKey && !event.ctrlKey) {
    if (event.key === "Backspace") return "\x1b\x7f";
    const arrow = ALT_ARROW_SEQUENCES[event.key];
    if (arrow) return arrow;
    if (event.key.length === 1) return `\x1b${event.key}`;
  }

  if (event.key === "Enter") return event.shiftKey ? "\n" : "\r";
  if (event.key === "Tab") return event.shiftKey ? "\x1b[Z" : "\t";

  return SPECIAL_KEY_SEQUENCES[event.key] ?? null;
}

export function asBracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}
