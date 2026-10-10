export type TerminalExtraKey =
  | "Escape" | "/" | "-" | "Home" | "ArrowUp" | "End" | "PageUp"
  | "Tab" | "ArrowLeft" | "ArrowDown" | "ArrowRight" | "PageDown";

export type TerminalModifier = "ctrl" | "alt";

export interface TerminalModifiers {
  ctrl: boolean;
  alt: boolean;
}

export const NO_TERMINAL_MODIFIERS: TerminalModifiers = { ctrl: false, alt: false };

export const TERMINAL_EXTRA_KEY_ROWS: readonly (readonly (TerminalExtraKey | TerminalModifier)[])[] = [
  ["Escape", "/", "-", "Home", "ArrowUp", "End", "PageUp"],
  ["Tab", "ctrl", "alt", "ArrowLeft", "ArrowDown", "ArrowRight", "PageDown"],
];

export const TERMINAL_REPEATING_KEYS: ReadonlySet<TerminalExtraKey> = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown",
]);

const CURSOR_FINALS: Partial<Record<TerminalExtraKey, string>> = {
  ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D", Home: "H", End: "F",
};

const TILDE_CODES: Partial<Record<TerminalExtraKey, number>> = { PageUp: 5, PageDown: 6 };

function modifierParam({ ctrl, alt }: TerminalModifiers): number {
  return 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
}

function ctrlChar(char: string): string {
  if (/^[a-z]$/i.test(char)) return String.fromCharCode(char.toUpperCase().charCodeAt(0) & 0x1f);
  const code = char.charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code & 0x1f);
  if (char === " ") return "\x00";
  if (char === "/" || char === "-") return "\x1f";
  if (char === "?") return "\x7f";
  return char;
}

export function applyTerminalModifiers(data: string, modifiers: TerminalModifiers): string {
  if ((!modifiers.ctrl && !modifiers.alt) || [...data].length !== 1) return data;
  const char = modifiers.ctrl ? ctrlChar(data) : data;
  return modifiers.alt ? `\x1b${char}` : char;
}

export function terminalExtraKeySequence(
  key: TerminalExtraKey,
  modifiers: TerminalModifiers,
  applicationCursorKeys: boolean,
): string {
  const modified = modifiers.ctrl || modifiers.alt;
  const final = CURSOR_FINALS[key];
  if (final) {
    if (modified) return `\x1b[1;${modifierParam(modifiers)}${final}`;
    return applicationCursorKeys ? `\x1bO${final}` : `\x1b[${final}`;
  }
  const tilde = TILDE_CODES[key];
  if (tilde) return modified ? `\x1b[${tilde};${modifierParam(modifiers)}~` : `\x1b[${tilde}~`;
  if (key === "Escape") return modifiers.alt ? "\x1b\x1b" : "\x1b";
  if (key === "Tab") return modifiers.alt ? "\x1b\t" : "\t";
  return applyTerminalModifiers(key, modifiers);
}
