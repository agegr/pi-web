/**
 * One completion, one chime per browser (#1688). A finished run is heard by
 * the page showing that session (its `agent_end`) and by every other visible
 * page whose sidebar poll sees the session leave the running set, a poll
 * later. Each page that chimes writes the session's id and the time here, in
 * localStorage shared by this browser's pages, and a page skips a completion
 * some page already chimed for.
 *
 * Best-effort, not a lock: two pages hearing the same completion within the
 * same few milliseconds can both chime, as before. Storage that fails or is
 * missing (privacy mode) chimes every time, as before.
 */

export const DONE_CHIME_STORAGE_KEY = "pi-web:done-chimes";
/**
 * Two pages showing the same session get its `agent_end` together: the
 * second one skips a chime for that session this recent.
 */
export const DONE_CHIME_SAME_EVENT_MS = 3_000;
/** Claims older than this are dropped when the record is written. */
export const DONE_CHIME_RECORD_MS = 24 * 60 * 60 * 1000;
const DONE_CHIME_RECORD_MAX = 200;

export interface DoneChimeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): DoneChimeStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRecord(storage: DoneChimeStorage): Record<string, number> {
  const raw = storage.getItem(DONE_CHIME_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record: Record<string, number> = {};
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === "number" && Number.isFinite(at)) record[id] = at;
    }
    return record;
  } catch {
    return {};
  }
}

/**
 * Whether this page should chime for `sessionIds` finishing: true when one of
 * them has no chime at or after `since` yet, and that one is recorded as
 * chimed `now`. `since` is the earliest moment the completion could have
 * happened, so a chime for an earlier run of the same session never counts.
 */
export function claimDoneChime(
  sessionIds: readonly string[],
  since: number,
  now: number = Date.now(),
  storage: DoneChimeStorage | null = getBrowserStorage(),
): boolean {
  if (sessionIds.length === 0) return false;
  if (!storage) return true;
  try {
    const record = readRecord(storage);
    const unclaimed = sessionIds.filter((id) => !(typeof record[id] === "number" && record[id] >= since));
    if (unclaimed.length === 0) return false;
    for (const id of unclaimed) record[id] = now;
    const kept = Object.entries(record)
      .filter(([, at]) => now - at <= DONE_CHIME_RECORD_MS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, DONE_CHIME_RECORD_MAX);
    storage.setItem(DONE_CHIME_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
    return true;
  } catch {
    return true;
  }
}
