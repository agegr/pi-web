// The bindings Pi Web acts on, and how a `keybindings.json` entry resolves to
// the keys to match. Pure functions only: the browser hook lives in
// `hooks/useKeybindings.ts`, so this module stays testable without React.

/** Bindings Pi Web can act on, named as pi names them in `keybindings.json`. */
export const WEB_KEYBINDINGS = {
  newSession: "app.session.new",
  followUp: "app.message.followUp",
} as const;

export type WebKeybinding = (typeof WEB_KEYBINDINGS)[keyof typeof WEB_KEYBINDINGS];

/**
 * Defaults for the bindings Pi Web reads, used until the file answers and when
 * it does not name them. `app.session.new` is empty in pi (the CLI starts a
 * session from its command line), so the web UI keeps its own Ctrl+Alt+N; the
 * follow-up default is pi's own.
 */
export const WEB_KEYBINDING_DEFAULTS: Record<WebKeybinding, string[]> = {
  "app.session.new": ["ctrl+alt+n"],
  "app.message.followUp": ["alt+enter"],
};

/** `keybindings.json` as the browser sees it: id → one key id or a list. */
export type KeybindingsConfig = Record<string, string | string[]>;

/**
 * The keys of one binding: the file's value when it names one, its default
 * otherwise, and nothing at all when the file turns it off (`[]` or `none`).
 */
export function bindingKeysFor(
  config: KeybindingsConfig,
  id: WebKeybinding,
): string[] {
  if (!Object.hasOwn(config, id)) return WEB_KEYBINDING_DEFAULTS[id];
  const value = config[id];
  if (typeof value === "string") return value === "none" || value === "" ? [] : [value];
  return value.filter((key) => key !== "none" && key !== "");
}

/**
 * Keeps only the entries a binding can use: a key id or a list of them.
 * Anything else in the file is ignored rather than trusted.
 */
export function sanitizeKeybindingsConfig(value: unknown): KeybindingsConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const config: KeybindingsConfig = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") config[id] = entry;
    else if (Array.isArray(entry)) {
      const keys = entry.filter((key): key is string => typeof key === "string");
      if (keys.length) config[id] = keys;
    }
  }
  return config;
}

/** A stable identity for a binding's keys, for `useEffect` and memo deps. */
export function keybindingsSignature(keys: string[]): string {
  return keys.join("\u0000");
}

/** The inverse of `keybindingsSignature`, for handing keys to `matchesKeyId`. */
export function keysFromSignature(signature: string): string[] {
  return signature ? signature.split("\u0000") : [];
}
