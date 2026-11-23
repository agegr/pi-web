import {
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "./image-attachments";
import type { SessionReferenceTarget } from "./session-reference-target";

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  /** Quoted sessions, kept in memory only, like the images: a chip that comes
   *  back after a reload would name a token the stored text never went through. */
  references?: SessionReferenceTarget[];
}

const drafts = new Map<string, ChatDraft>();

const PARKED_NEW_SESSION_PREFIX = "parked-new:";
/** AppShell's fresh composer key: `new:<draftId>:<cwd>`. */
const NEW_SESSION_PREFIX = "new:";

/** Where a fresh composer's draft waits once the page leaves it; the next fresh composer in that cwd takes it back. */
export function parkedNewSessionDraftKey(cwd: string): string {
  return `${PARKED_NEW_SESSION_PREFIX}${cwd}`;
}

// A session's draft text outlives a reload (#1718). Memory stays the source of
// truth while the page lives; localStorage is a write-through copy, read once
// per key the first time this page asks for that key. Images are never stored.
// One storage key per draft, so a write rewrites only the draft that changed.
const STORAGE_PREFIX = "pi-web:draft:";
/** Stored drafts kept, the most recently written first. */
export const MAX_STORED_DRAFTS = 50;
/**
 * Longer text stays in memory only, and its older stored copy is removed: a cut
 * prompt would come back looking whole. 20,000 UTF-16 units is pages of typed
 * prompt; 50 such drafts stay near 1M units, about a fifth of the ~5M a browser
 * grants an origin, which pi-web's other stored preferences share.
 */
export const MAX_STORED_DRAFT_LENGTH = 20_000;
/** Changed drafts are written at most this often while typing goes on. */
const STORE_INTERVAL_MS = 300;

interface DraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Keys whose stored copy this page has read or replaced. */
const seededKeys = new Set<string>();
const pendingStores = new Set<string>();
/** Keys kept out of storage, with how many holds each has. */
const storeHolds = new Map<string, number>();
let storeTimer: ReturnType<typeof setTimeout> | null = null;
let flushListenersAdded = false;

function getBrowserStorage(): DraftStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A fresh composer's keys hold a per-composer id; only a session id means the same draft after a reload. */
function isStoredDraftKey(key: string): boolean {
  return !key.startsWith(NEW_SESSION_PREFIX) && !key.startsWith(PARKED_NEW_SESSION_PREFIX);
}

function readStoredDraft(key: string): ChatDraft | null {
  if (seededKeys.has(key) || !isStoredDraftKey(key)) return null;
  seededKeys.add(key);
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const text = parsed && typeof parsed === "object" ? (parsed as { text?: unknown }).text : null;
    if (typeof text !== "string" || !text || text.length > MAX_STORED_DRAFT_LENGTH) return null;
    const draft: ChatDraft = { value: text, images: [] };
    drafts.set(key, draft);
    return draft;
  } catch {
    return null;
  }
}

function storedDraftTime(storage: DraftStorage, storageKey: string): number {
  try {
    const at = (JSON.parse(storage.getItem(storageKey) ?? "") as { at?: unknown } | null)?.at;
    return typeof at === "number" && Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

function storedDraftKeys(storage: DraftStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
}

function evictOldStoredDrafts(storage: DraftStorage): void {
  const keys = storedDraftKeys(storage);
  if (keys.length <= MAX_STORED_DRAFTS) return;
  keys
    .map((key) => ({ key, at: storedDraftTime(storage, key) }))
    .sort((a, b) => b.at - a.at)
    .slice(MAX_STORED_DRAFTS)
    .forEach(({ key }) => storage.removeItem(key));
}

function writeStoredDraft(storage: DraftStorage, key: string): void {
  const storageKey = STORAGE_PREFIX + key;
  const text = drafts.get(key)?.value ?? "";
  try {
    if (!text || text.length > MAX_STORED_DRAFT_LENGTH) {
      storage.removeItem(storageKey);
      return;
    }
    const added = storage.getItem(storageKey) === null;
    storage.setItem(storageKey, JSON.stringify({ text, at: Date.now() }));
    if (added) evictOldStoredDrafts(storage);
  } catch {
    // Full or refused storage: an older copy must not come back instead.
    try {
      storage.removeItem(storageKey);
    } catch {
      // Storage is best-effort; memory still holds the draft.
    }
  }
}

/** Writes the drafts changed since the last write. Leaving or hiding the page flushes at once. */
export function flushStoredDrafts(): void {
  if (storeTimer !== null) clearTimeout(storeTimer);
  storeTimer = null;
  const keys = [...pendingStores];
  pendingStores.clear();
  const storage = getBrowserStorage();
  if (!storage) return;
  for (const key of keys) writeStoredDraft(storage, key);
}

function flushWhenHidden(): void {
  if (document.visibilityState === "hidden") flushStoredDrafts();
}

function scheduleStoredDraft(key: string): void {
  if (!isStoredDraftKey(key) || storeHolds.has(key) || !getBrowserStorage()) return;
  pendingStores.add(key);
  if (!flushListenersAdded) {
    flushListenersAdded = true;
    window.addEventListener("pagehide", flushStoredDrafts);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", flushWhenHidden);
  }
  // Not reset by later changes: typing that goes on still gets written.
  if (storeTimer === null) storeTimer = setTimeout(flushStoredDrafts, STORE_INTERVAL_MS);
}

/** Written at once: a reload right after a send must not bring the text back. */
function removeStoredDraft(key: string): void {
  pendingStores.delete(key);
  if (!isStoredDraftKey(key)) return;
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Storage is best-effort.
  }
}

/**
 * Keeps a key's draft out of storage, its stored copy removed at once, until
 * the returned release runs: for text whose meaning a reload would lose (a
 * history edit's target, a command already running). Memory keeps the draft,
 * and the release stores it again.
 */
export function holdStoredDraft(key: string): () => void {
  storeHolds.set(key, (storeHolds.get(key) ?? 0) + 1);
  removeStoredDraft(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const holds = (storeHolds.get(key) ?? 1) - 1;
    if (holds > 0) {
      storeHolds.set(key, holds);
      return;
    }
    storeHolds.delete(key);
    if (drafts.get(key)?.value) scheduleStoredDraft(key);
  };
}

/** Removes every stored draft (signing out); drafts in this page's memory stay. */
export function clearStoredDrafts(): void {
  pendingStores.clear();
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storedDraftKeys(storage).forEach((key) => storage.removeItem(key));
  } catch {
    // Storage is best-effort.
  }
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  const copy: ChatDraft = {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
  };
  // Only when there are references: a draft's shape stays what callers wrote.
  if (draft.references?.length) copy.references = draft.references.map((reference) => ({ ...reference }));
  return copy;
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0 && !draft.references?.length;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key) ?? readStoredDraft(key);
  return draft ? cloneDraft(draft) : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    clearDraft(key);
    return;
  }
  seededKeys.add(key);
  const previous = drafts.get(key);
  drafts.set(key, cloneDraft(draft));
  if (!draft.value) removeStoredDraft(key);
  else if (previous?.value !== draft.value) scheduleStoredDraft(key);
}

export function clearDraft(key: string): void {
  seededKeys.add(key);
  drafts.delete(key);
  removeStoredDraft(key);
}

export function mergeRestoredSubmissionText(submitted: string, current: string): string {
  if (!submitted.trim()) return current;
  if (!current.trim()) return submitted;
  return `${submitted}\n\n${current}`;
}

export function mergeRestoredSubmissionDraft(
  submittedText: string,
  submittedImages: ChatDraftImage[] | undefined,
  currentText: string,
  currentImages: ChatDraftImage[],
): ChatDraft {
  const images = [...(submittedImages ?? []), ...currentImages]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(({ data, mimeType }) => ({ data, mimeType }));

  return {
    value: mergeRestoredSubmissionText(submittedText, currentText),
    images,
  };
}

export function restoreDraftSubmission(
  key: string,
  text: string,
  images?: ChatDraftImage[],
): ChatDraft {
  const current = getDraft(key) ?? { value: "", images: [] };
  const restored = mergeRestoredSubmissionDraft(
    text,
    images,
    current.value,
    current.images,
  );
  setDraft(key, restored);
  return restored;
}

export function rekeyDraft(
  previousKey: string,
  nextKey: string,
  currentDraft?: ChatDraft,
): ChatDraft | null {
  if (previousKey === nextKey) return currentDraft ? cloneDraft(currentDraft) : getDraft(nextKey);

  const storedPrevious = getDraft(previousKey);
  const previous = currentDraft && !isEmptyDraft(currentDraft)
    ? cloneDraft(currentDraft)
    : (storedPrevious ?? (currentDraft ? cloneDraft(currentDraft) : null));
  const next = getDraft(nextKey);
  clearDraft(previousKey);
  if (!previous) return next;

  const merged = next
    ? mergeRestoredSubmissionDraft(next.value, next.images, previous.value, previous.images)
    : previous;
  setDraft(nextKey, merged);
  return cloneDraft(merged);
}
