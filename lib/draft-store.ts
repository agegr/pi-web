// Per-session draft store for the chat input.
//
// ChatWindow (and its ChatInput) is fully remounted whenever the user switches
// sessions (AppShell bumps `sessionKey`), which wipes the ChatInput's local
// `value` state. To avoid losing an unsent draft when the user briefly switches
// to another session and comes back, we persist the draft text here keyed by a
// stable draft key derived from the session id (or the new-session cwd).
//
// The store lives at module scope so it survives ChatWindow remounts. It is
// intentionally in-memory only (cleared on page reload).

const drafts = new Map<string, string>();

export function getDraft(key: string): string {
  return drafts.get(key) ?? "";
}

export function setDraft(key: string, value: string): void {
  if (value) drafts.set(key, value);
  else drafts.delete(key);
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

// Move a draft from one key to another. Used when a brand-new session gets its
// real id from pi, so the draft key transitions from "new:<cwd>" to the id.
export function moveDraft(fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  const value = drafts.get(fromKey);
  if (value === undefined) return;
  drafts.delete(fromKey);
  if (value) drafts.set(toKey, value);
}
