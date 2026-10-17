// Browser side of pi's keybindings: turn a `keydown` into the same key id
// pi's `keybindings.json` uses (`ctrl+enter`, `alt+enter`, `super+k`, …), so
// one file configures the terminal and the web UI.
//
// The ids are pi's `KeyId` spelling (`@earendil-works/pi-tui`): lowercase base
// key, modifiers in the order ctrl, alt, shift, super, joined with `+`.

export type KeyModifier = "ctrl" | "alt" | "shift" | "super";

const SPECIAL_KEYS: Record<string, string> = {
  Enter: "enter",
  Escape: "escape",
  Tab: "tab",
  Space: "space",
  Backspace: "backspace",
  Delete: "delete",
  Insert: "insert",
  Home: "home",
  End: "end",
  PageUp: "pageUp",
  PageDown: "pageDown",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  NumpadEnter: "enter",
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadMultiply: "*",
  NumpadDivide: "/",
  NumpadDecimal: ".",
};

/**
 * The base key of a `keydown`, from `event.code` so a remapped or non-US layout
 * still answers the same physical key (pi reads `KeyN`, not "the key that types
 * n"). Falls back to `event.key` for keys `code` does not name.
 */
export function baseKeyOf(event: Pick<KeyboardEvent, "code" | "key">): string | null {
  const { code, key } = event;
  if (SPECIAL_KEYS[code]) return SPECIAL_KEYS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code.slice(1).toLowerCase();
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  // Punctuation: `code` spells the US position (`Semicolon`), `key` the
  // character the layout produces. pi's ids use the character, which is what a
  // user writing `ctrl+;` in keybindings.json means.
  if (key && key.length === 1) return key.toLowerCase();
  return null;
}

/** Modifiers of a `keydown`, in pi's order, without the ones a base key implies. */
export function modifiersOf(event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): KeyModifier[] {
  const modifiers: KeyModifier[] = [];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey) modifiers.push("super");
  return modifiers;
}

/**
 * The key id of a `keydown`, or null when the key has no id (a bare modifier
 * press, a media key). Shift is kept, as pi's ids do: `shift+enter` is its own
 * binding, not "enter typed with Shift".
 */
export function keyIdOf(event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  const base = baseKeyOf(event);
  if (!base) return null;
  return [...modifiersOf(event), base].join("+");
}

/** Splits one configured value (`ctrl+enter`) into its modifier set and base key. */
export function parseKeyId(id: string): { modifiers: KeyModifier[]; base: string } | null {
  const parts = id.split("+");
  // `ctrl++` (a plus key) splits into a trailing empty part.
  if (parts.length > 1 && parts[parts.length - 1] === "") {
    parts.pop();
    parts[parts.length - 1] = "+";
  }
  const base = parts.pop();
  if (!base) return null;
  const modifiers: KeyModifier[] = [];
  for (const part of parts) {
    if (part !== "ctrl" && part !== "alt" && part !== "shift" && part !== "super") return null;
    if (!modifiers.includes(part)) modifiers.push(part);
  }
  return { modifiers, base };
}

/**
 * Normalizes a configured id so two spellings of one key compare equal
 * (`Ctrl+Enter` and `ctrl+enter`), and so `super`/`cmd`/`meta` are one thing.
 * An id that does not parse is returned lowercased, to compare as written.
 */
export function normalizeKeyId(id: string): string {
  const parsed = parseKeyId(id.trim().toLowerCase().replace(/\b(cmd|meta|command)\+/g, "super+"));
  if (!parsed) return id.trim().toLowerCase();
  return [...parsed.modifiers, parsed.base].join("+");
}

/**
 * Whether `event` is the key `id` names. Accepts the value shape
 * `keybindings.json` allows: one id, or a list of them.
 */
export function matchesKeyId(
  event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  id: string | readonly string[] | undefined,
): boolean {
  if (id === undefined) return false;
  const actual = keyIdOf(event);
  if (!actual) return false;
  const ids = typeof id === "string" ? [id] : id;
  return ids.some((candidate) => normalizeKeyId(candidate) === actual);
}

/** A configured binding's keys, however `keybindings.json` spelled them. */
export function bindingKeys(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

/**
 * How a key id reads in the UI: `ctrl+enter` becomes `Ctrl+Enter`, `super` the
 * platform's own name (⌘ on Apple, Win elsewhere). Empty means "not bound".
 */
export function formatKeyId(id: string, platform: "apple" | "other" = "other"): string {
  const parsed = parseKeyId(normalizeKeyId(id));
  if (!parsed) return id;
  const names: Record<KeyModifier, string> = {
    ctrl: "Ctrl",
    alt: platform === "apple" ? "Option" : "Alt",
    shift: "Shift",
    super: platform === "apple" ? "⌘" : "Win",
  };
  const base = parsed.base.length === 1 ? parsed.base.toUpperCase() : parsed.base[0].toUpperCase() + parsed.base.slice(1);
  return [...parsed.modifiers.map((modifier) => names[modifier]), base].join("+");
}

/** A binding's keys as one readable list, e.g. `Alt+Enter, Ctrl+Enter`. */
export function formatBindingKeys(value: unknown, platform: "apple" | "other" = "other"): string {
  return bindingKeys(value).map((id) => formatKeyId(id, platform)).join(", ");
}
