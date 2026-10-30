import { getPiWebSettingsSnapshot, setPiWebSetting, THINKING_EXPANDED_EVENT } from "./pi-web-settings-store";

// The "thinking starts expanded" preference lives on the server with the
// other Settings › General › Chat choices (`pi-web-settings.json`,
// `lib/pi-web-settings-store.ts`). These two are the names the chat already
// used: a mounted block reads the value once and follows
// THINKING_EXPANDED_EVENT, which the store announces on every change.

export { THINKING_EXPANDED_EVENT };

export function isThinkingExpandedByDefault(): boolean {
  return getPiWebSettingsSnapshot().thinkingExpandedDefault;
}

/** The server's answer to the write: false when it was refused. */
export function setThinkingExpandedByDefault(expanded: boolean): Promise<boolean> {
  return setPiWebSetting("thinkingExpandedDefault", expanded);
}
