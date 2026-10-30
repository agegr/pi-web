import {
  DEFAULT_PI_WEB_SETTINGS,
  piWebSettingsFromResponse,
  type PiWebSettings,
  type PiWebSettingsKey,
  type PiWebSettingsPatch,
} from "./pi-web-settings-shared";

// The browser's copy of the server's `pi-web-settings.json`
// (`app/api/pi-web-settings`): read once per page and again when the page comes
// back into view, so another tab's, another browser's or another device's
// change lands without a reload. Writes are optimistic and put back on refusal.
//
// One live store for the whole page (components subscribe through
// `hooks/usePiWebSetting.ts`), so the three settings reach the composer, the
// settings panel and the thinking blocks from their first render on.

export const PI_WEB_SETTINGS_URL = "/api/pi-web-settings";

/** Announced on `window` when the thinking default changes, for the mounted blocks. */
export const THINKING_EXPANDED_EVENT = "pi-thinking-expanded-changed";

let snapshot: PiWebSettings = { ...DEFAULT_PI_WEB_SETTINGS };
let lastError: string | null = null;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getPiWebSettingsSnapshot(): PiWebSettings {
  return snapshot;
}

/** The server's defaults: what a server render and the first client render show. */
export function getPiWebSettingsServerSnapshot(): PiWebSettings {
  return DEFAULT_PI_WEB_SETTINGS as PiWebSettings;
}

export function subscribePiWebSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The last failed read or write, for the settings panel; null once one succeeds. */
export function getPiWebSettingsError(): string | null {
  return lastError;
}

function setSnapshot(next: PiWebSettings): void {
  const thinkingChanged = next.thinkingExpandedDefault !== snapshot.thinkingExpandedDefault;
  snapshot = next;
  notify();
  // A block already on screen follows the preference, as the browser-local one did.
  if (thinkingChanged && typeof window !== "undefined") {
    window.dispatchEvent(new Event(THINKING_EXPANDED_EVENT));
  }
}

function setError(error: string | null): void {
  if (lastError === error) return;
  lastError = error;
  notify();
}

/** Reads every setting from the server; a failed read keeps the defaults. */
async function fetchSettings(): Promise<void> {
  try {
    const response = await fetch(PI_WEB_SETTINGS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { settings?: unknown };
    const settings = piWebSettingsFromResponse(data.settings);
    if (!settings) throw new Error("Malformed settings");
    setSnapshot(settings);
    setError(null);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

/** The first read of this page, shared by every subscriber. */
export function ensurePiWebSettingsLoaded(): Promise<void> {
  loaded ??= fetchSettings();
  return loaded;
}

/** Reads again (returning to the page), picking up changes made elsewhere. */
export function refreshPiWebSettings(): Promise<void> {
  loaded ??= fetchSettings();
  return fetchSettings();
}

/** A value without a request, for tests that render with one preference. */
export function primePiWebSettingsForTests(settings: Partial<PiWebSettings>): void {
  snapshot = { ...DEFAULT_PI_WEB_SETTINGS, ...settings };
  notify();
}

/** Forgets the page's read, so the next subscriber loads again (tests, a sign-out). */
export function resetPiWebSettingsForTests(): void {
  snapshot = { ...DEFAULT_PI_WEB_SETTINGS };
  lastError = null;
  loaded = null;
  listeners.clear();
}

/**
 * Stores `patch` and answers whether the server took it. The store shows the new
 * value at once and puts the previous one back if the write fails, so a switch
 * never claims a preference the server does not hold.
 */
export async function updatePiWebSettings(patch: PiWebSettingsPatch): Promise<boolean> {
  const previous = snapshot;
  setSnapshot({ ...snapshot, ...patch });
  try {
    const response = await fetch(PI_WEB_SETTINGS_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { settings?: unknown };
    const settings = piWebSettingsFromResponse(data.settings);
    if (!settings) throw new Error("Malformed settings");
    setSnapshot(settings);
    setError(null);
    return true;
  } catch (error) {
    setSnapshot(previous);
    setError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function setPiWebSetting<K extends PiWebSettingsKey>(key: K, value: PiWebSettings[K]): Promise<boolean> {
  return updatePiWebSettings({ [key]: value } as PiWebSettingsPatch);
}
