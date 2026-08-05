/**
 * Per-session chat-draft persistence — simple crash-loss prevention.
 *
 * Each open tab owns a PRIVATE draft slot per session: the storage key embeds
 * a per-tab id (sessionStorage — survives a refresh, dies with the tab), so
 * two tabs typing in the same session never write to the same slot and cannot
 * clobber each other. Every slot lives in localStorage (survives a hard
 * refresh AND closing the browser), so an unsent message is never lost.
 *
 * On reopen, all surviving slots for a session surface as items in the
 * queue-recovery dialog (see ChatWindow) — each is independently restorable or
 * discardable. Writes are debounced (300ms) so typing does not spam setItem
 * with multi-MB payloads, and `flushAllDrafts()` — hooked to beforeunload/
 * pagehide/visibilitychange — synchronously writes the in-memory drafts right
 * before the page goes away.
 *
 * Storage keys: `crashrestore-<sessionId>-<tabId>`. The tabId is a unique
 * string fixed for the current page (sessionStorage — survives a refresh,
 * dies with the tab), so every tab writes its own key and tabs never clobber
 * each other. On load, `listDraftSlots()` scans `crashrestore-<sessionId>-*`
 * and loads them all.
 *
 * Payload format: `<ts>:<base64(JSON)>` — base64 is a pseudo-cipher (not
 * readable at a glance, trivially reversible).
 */

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
}

export interface DraftSlotInfo {
  slotKey: string;
  draft: ChatDraft;
  /** Write time (Date.now() at last save), embedded in the stored payload. */
  ts: number;
  /** True when this slot belongs to the current tab. */
  own: boolean;
}

/** localStorage key prefix for a draft slot: `crashrestore-<draftKey>-<tabId>`. */
export const DRAFT_KEY_PREFIX = "crashrestore-";
/** sessionStorage key holding this tab's private slot id. */
const TAB_ID_KEY = "pi-draft-tab-id";
const WRITE_DEBOUNCE_MS = 300;

/** Own-slot cache: draftKey → draft (the fast path ChatInput reads/writes). */
const drafts = new Map<string, ChatDraft>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Serialized payload last written per key, so flushes skip unchanged entries. */
const lastWritten = new Map<string, string>();
/** Cached per-tab id (sessionStorage read once per page). */
let tabIdCache: string | null = null;

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0;
}

/** Per-tab id: stable across refreshes of the same tab, unique across tabs. */
function getTabId(): string {
  if (typeof window === "undefined") return "ssr";
  if (tabIdCache) return tabIdCache;
  try {
    let id = window.sessionStorage.getItem(TAB_ID_KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      window.sessionStorage.setItem(TAB_ID_KEY, id);
    }
    tabIdCache = id;
    return id;
  } catch {
    // sessionStorage unavailable (private mode): shared fallback — such tabs
    // degrade to last-writer-wins, acceptable for an edge case.
    tabIdCache = "fallback";
    return tabIdCache;
  }
}

/** Storage key for THIS tab's slot of the given session draft. */
export function draftSlotKey(draftKey: string): string {
  return `${DRAFT_KEY_PREFIX}${draftKey}-${getTabId()}`;
}

/**
 * base64 (UTF-8) of the JSON draft — the pseudo-cipher. Not meant to be
 * secure, just not readable at a glance in DevTools/localStorage dumps.
 */
function encodeDraft(draft: ChatDraft): string {
  const json = JSON.stringify(draft);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function parseDraftJson(raw: string): ChatDraft | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ChatDraft> | null;
    if (!parsed || typeof parsed.value !== "string") return null;
    return {
      value: parsed.value,
      images: Array.isArray(parsed.images)
        ? parsed.images.filter(
            (im): im is ChatDraftImage => !!im && typeof im.data === "string" && typeof im.mimeType === "string",
          )
        : [],
    };
  } catch {
    return null;
  }
}

/** Parses a stored slot payload. Legacy plain-JSON entries carry ts 0. */
function decodeSlot(raw: string): { draft: ChatDraft; ts: number } | null {
  try {
    // Legacy entries from the plain-JSON iteration.
    if (raw.startsWith("{")) {
      const draft = parseDraftJson(raw);
      return draft ? { draft, ts: 0 } : null;
    }
    // Current format: `<ts>:<base64>`. Older base64-only payloads have no
    // prefix (no colon in the base64 alphabet) → ts 0.
    let ts = 0;
    let b64 = raw;
    const idx = raw.indexOf(":");
    if (idx > 0) {
      const head = Number(raw.slice(0, idx));
      if (Number.isFinite(head)) {
        ts = head;
        b64 = raw.slice(idx + 1);
      }
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const draft = parseDraftJson(new TextDecoder().decode(bytes));
    return draft ? { draft, ts } : null;
  } catch {
    return null;
  }
}

/** Synchronous write of one draft. Safe to call from beforeunload. */
function writeNow(key: string): void {
  const draft = drafts.get(key);
  if (!draft) return;
  const raw = `${Date.now()}:${encodeDraft(draft)}`;
  if (lastWritten.get(key) === raw) return;
  try {
    window.localStorage.setItem(draftSlotKey(key), raw);
    lastWritten.set(key, raw);
  } catch {
    // quota exceeded (large image attachments): fall back to text-only so at
    // least the message text survives a refresh
    try {
      const textOnly: ChatDraft = { value: draft.value, images: [] };
      const compact = `${Date.now()}:${encodeDraft(textOnly)}`;
      window.localStorage.setItem(draftSlotKey(key), compact);
      lastWritten.set(key, compact);
    } catch {
      // give up — the in-memory draft still works; the next change retries
    }
  }
}

function scheduleWrite(key: string): void {
  clearTimeout(writeTimers.get(key));
  writeTimers.set(key, setTimeout(() => {
    writeTimers.delete(key);
    writeNow(key);
  }, WRITE_DEBOUNCE_MS));
}

/** Draft of the CURRENT tab for this session (in-memory cache, then storage). */
export function getDraft(key: string): ChatDraft | null {
  const cached = drafts.get(key);
  if (cached) return cloneDraft(cached);
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftSlotKey(key));
    if (!raw) return null;
    const parsed = decodeSlot(raw);
    if (!parsed) return null;
    drafts.set(key, cloneDraft(parsed.draft));
    return cloneDraft(parsed.draft);
  } catch {
    return null;
  }
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    clearDraft(key);
    return;
  }
  drafts.set(key, cloneDraft(draft));
  scheduleWrite(key);
}

export function clearDraft(key: string): void {
  drafts.delete(key);
  clearTimeout(writeTimers.get(key));
  writeTimers.delete(key);
  lastWritten.delete(key);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(draftSlotKey(key));
    } catch {
      // ignore
    }
  }
}

/**
 * All surviving draft slots for a session (closed tabs, other tabs, and this
 * tab's own leftover). Used by the recovery dialog; the caller decides which
 * to show (see ChatWindow).
 */
export function listDraftSlots(draftKey: string): DraftSlotInfo[] {
  if (typeof window === "undefined") return [];
  const prefix = `${DRAFT_KEY_PREFIX}${draftKey}-`;
  const ownKey = draftSlotKey(draftKey);
  const out: DraftSlotInfo[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const parsed = decodeSlot(window.localStorage.getItem(k) ?? "");
      if (!parsed) continue;
      out.push({ slotKey: k, draft: parsed.draft, ts: parsed.ts, own: k === ownKey });
    }
  } catch {
    // ignore
  }
  return out;
}

/** Remove one slot (typically a foreign/closed-tab slot being discarded). */
export function removeDraftSlot(slotKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(slotKey);
  } catch {
    // ignore
  }
}

/** Remove every slot for a session (used when the session is deleted). */
export function clearAllDrafts(draftKey: string): void {
  clearDraft(draftKey);
  if (typeof window === "undefined") return;
  const prefix = `${DRAFT_KEY_PREFIX}${draftKey}-`;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) window.localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

/**
 * Synchronous best-effort write of every in-memory draft (own slots). Safe to
 * call from beforeunload/pagehide/visibilitychange — writes whatever the
 * debounce has not flushed yet, so the last keystrokes survive a refresh.
 */
export function flushAllDrafts(): void {
  if (typeof window === "undefined") return;
  for (const key of drafts.keys()) {
    writeNow(key);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushAllDrafts);
  window.addEventListener("pagehide", flushAllDrafts);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAllDrafts();
  });
}
