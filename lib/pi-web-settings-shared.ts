// Client-safe: the shape and rules of `pi-web-settings.json`, this fork's own
// server-side preferences (Settings › General › Chat). The file sits beside
// `pi-web-session-state.json` in the agent dir; `lib/pi-web-settings.ts` does
// the locked read-modify-write on the server and `lib/pi-web-settings-store.ts`
// is the browser's copy, so a choice made on the phone reaches the desktop.
//
// Only what differs from the defaults is written, so the file stays short and a
// preference that goes back to its default leaves no trace.

export const PI_WEB_SETTINGS_VERSION = 1;

/**
 * What a bare Enter (or Shift+Enter) does in the composer: send, or a newline
 * (`ctrlEnter` sends with Ctrl+Enter / ⌘+Enter).
 */
export type EnterSendMode = "enter" | "ctrlEnter";

export interface PiWebSettings {
  /** New thinking blocks start expanded. */
  thinkingExpandedDefault: boolean;
  /** Selecting text in a reply offers to quote it into the composer. */
  quoteSelection: boolean;
  enterSendMode: EnterSendMode;
}

export const DEFAULT_PI_WEB_SETTINGS: Readonly<PiWebSettings> = Object.freeze({
  thinkingExpandedDefault: false,
  quoteSelection: false,
  enterSendMode: "enter",
});

export type PiWebSettingsKey = keyof PiWebSettings;
export const PI_WEB_SETTINGS_KEYS: readonly PiWebSettingsKey[] = ["thinkingExpandedDefault", "quoteSelection", "enterSendMode"];

export type PiWebSettingsPatch = Partial<PiWebSettings>;

export type ParsedPiWebSettingsRequest =
  | { ok: true; patch: PiWebSettingsPatch }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isEnterSendMode(value: unknown): value is EnterSendMode {
  return value === "enter" || value === "ctrlEnter";
}

/**
 * The settings a file's contents describe: defaults for what it leaves out or
 * spells wrong (a hand edit should not take the whole file down), null when it
 * is not an object or names another version. Unknown fields are the caller's to
 * keep.
 */
export function normalizePiWebSettings(raw: unknown): PiWebSettings | null {
  if (!isRecord(raw)) return null;
  if (hasOwn(raw, "version") && raw.version !== PI_WEB_SETTINGS_VERSION) return null;
  const settings: PiWebSettings = { ...DEFAULT_PI_WEB_SETTINGS };
  if (typeof raw.thinkingExpandedDefault === "boolean") settings.thinkingExpandedDefault = raw.thinkingExpandedDefault;
  if (typeof raw.quoteSelection === "boolean") settings.quoteSelection = raw.quoteSelection;
  if (isEnterSendMode(raw.enterSendMode)) settings.enterSendMode = raw.enterSendMode;
  return settings;
}

/**
 * A request body: any subset of the three settings, at least one, each in its
 * own type. Unknown fields are ignored, so a newer browser's extra preference
 * does not make an older server refuse the whole request.
 */
export function parsePiWebSettingsRequest(body: unknown): ParsedPiWebSettingsRequest {
  if (!isRecord(body)) return { ok: false, error: "Expected a JSON object" };
  const patch: PiWebSettingsPatch = {};
  let count = 0;
  if (hasOwn(body, "thinkingExpandedDefault")) {
    if (typeof body.thinkingExpandedDefault !== "boolean") return { ok: false, error: "thinkingExpandedDefault must be a boolean" };
    patch.thinkingExpandedDefault = body.thinkingExpandedDefault;
    count++;
  }
  if (hasOwn(body, "quoteSelection")) {
    if (typeof body.quoteSelection !== "boolean") return { ok: false, error: "quoteSelection must be a boolean" };
    patch.quoteSelection = body.quoteSelection;
    count++;
  }
  if (hasOwn(body, "enterSendMode")) {
    if (!isEnterSendMode(body.enterSendMode)) return { ok: false, error: 'enterSendMode must be "enter" or "ctrlEnter"' };
    patch.enterSendMode = body.enterSendMode;
    count++;
  }
  if (count === 0) {
    return { ok: false, error: "Send at least one of thinkingExpandedDefault, quoteSelection or enterSendMode" };
  }
  return { ok: true, patch };
}

/** `state` with `patch` over it, and whether anything differs. */
export function applyPiWebSettingsPatch(state: PiWebSettings, patch: PiWebSettingsPatch): { settings: PiWebSettings; changed: boolean } {
  const settings: PiWebSettings = {
    thinkingExpandedDefault: patch.thinkingExpandedDefault ?? state.thinkingExpandedDefault,
    quoteSelection: patch.quoteSelection ?? state.quoteSelection,
    enterSendMode: patch.enterSendMode ?? state.enterSendMode,
  };
  const changed = settings.thinkingExpandedDefault !== state.thinkingExpandedDefault
    || settings.quoteSelection !== state.quoteSelection
    || settings.enterSendMode !== state.enterSendMode;
  return { settings, changed };
}

/** The document written to the file: the version, then what is not the default. */
export function piWebSettingsDocument(
  settings: PiWebSettings,
  extras: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const document: Record<string, unknown> = { version: PI_WEB_SETTINGS_VERSION };
  if (settings.thinkingExpandedDefault !== DEFAULT_PI_WEB_SETTINGS.thinkingExpandedDefault) {
    document.thinkingExpandedDefault = settings.thinkingExpandedDefault;
  }
  if (settings.quoteSelection !== DEFAULT_PI_WEB_SETTINGS.quoteSelection) {
    document.quoteSelection = settings.quoteSelection;
  }
  if (settings.enterSendMode !== DEFAULT_PI_WEB_SETTINGS.enterSendMode) {
    document.enterSendMode = settings.enterSendMode;
  }
  return { ...document, ...extras };
}

/** The settings as a browser holds them: only the known keys, each in its type. */
export function piWebSettingsFromResponse(value: unknown): PiWebSettings | null {
  return normalizePiWebSettings(isRecord(value) ? { ...value, version: PI_WEB_SETTINGS_VERSION } : value);
}
