// The sidebar's own UI state for sessions and projects: which session families
// are pinned or archived, which projects are pinned, and the order of the
// project groups. It is pi-web's state,
// never written into a session's `.jsonl`, so the pi CLI does not see it. The
// server keeps it in `pi-web-session-state.json` in the agent dir
// (`lib/session-ui-state.ts`); this module holds the types and the pure rules
// both sides apply, so the client can apply a change optimistically exactly as
// the server will. Client-safe: no Node imports.

export const SESSION_UI_STATE_VERSION = 1;
/** The session ids pi writes (UUIDs); same as `lib/session-reader.ts`. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
export const MAX_SESSION_UI_IDS_PER_REQUEST = 500;
/** Longest projectKey or project root a request or the file may carry. */
const MAX_PROJECT_STRING_LENGTH = 4096;
/** Most projectKeys `projectOrder` holds. */
export const MAX_PROJECT_ORDER_KEYS = 1000;
/**
 * Most UTF-8 bytes `projectOrder` takes as JSON. Keys may be 4096 characters,
 * a CJK character is 3 bytes and a Windows `\` doubles in JSON: the count
 * alone would let the list outgrow the file's own size limit, and a file over
 * it can no longer be read or written (pins and archive included).
 */
export const PROJECT_ORDER_MAX_BYTES = 256 * 1024;

/** Epoch ms, keyed by the FAMILY ROOT session id. */
export interface SessionUiFamilyState { pinnedAt?: number; archivedAt?: number }
/** Keyed by projectKey (`workspaceKeyOf`). */
export interface SessionUiProjectState { pinnedAt: number; root: string }
export interface SessionUiState {
  version: 1;
  /** Monotonic, bumped by the server on every changing write. */
  revision: number;
  sessions: Record<string, SessionUiFamilyState>;
  projects: Record<string, SessionUiProjectState>;
  /**
   * projectKeys of the sidebar's groups, top first, pinned and other projects
   * in one list (each band keeps the relative order of its own keys). Keys of
   * projects no longer shown stay, so a project that comes back takes its old
   * place. Absent while empty.
   */
  projectOrder?: string[];
}
/** Where a moved project goes, next to its anchor. */
export type ProjectMovePosition = "before" | "after";
/** One family's flags before a change, for undo; null = absent. */
export interface SessionUiFlagsSnapshot { id: string; pinnedAt: number | null; archivedAt: number | null }

export type SessionUiStateRequest =
  | { action: "set"; ids: string[]; pinned: boolean }
  | { action: "set"; ids: string[]; archived: boolean }
  /** Undo: writes back exact prior values (null = absent). */
  | { action: "restore"; entries: SessionUiFlagsSnapshot[] }
  | { action: "pin-project"; projectKey: string; root: string; pinned: boolean }
  /** New projects, top first: the ones `projectOrder` lacks go in front of it. Never pushes a key out. */
  | { action: "add-projects"; keys: string[] }
  /**
   * A drag or Move up/down: `projectKey` goes right before or after
   * `anchorKey`. `add` (the moved project's band's unsaved keys, top first) is
   * added first, so the move lands where the user saw it.
   */
  | { action: "move-project"; projectKey: string; anchorKey: string; position: ProjectMovePosition; add: string[] };

export interface SessionUiStateResponse { state: SessionUiState }

/** Why `POST /api/sessions/ui-state` refused; `error` is English diagnostic text. */
export type SessionUiStateRefusalReason = "request-denied" | "content-type" | "invalid-request" | "locked" | "internal";
export interface SessionUiStateErrorResponse { error: string; reason: SessionUiStateRefusalReason }

const hasOwn = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Epoch ms as the file and requests carry them. */
function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

/** `__proto__` would set the record's prototype instead of adding a key. */
function isProjectString(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_PROJECT_STRING_LENGTH
    && value !== "__proto__";
}

const utf8 = new TextEncoder();

/** What one key adds to `projectOrder` as JSON: the quoted, escaped key and its comma. */
function orderEntryBytes(key: string): number {
  return utf8.encode(JSON.stringify(key)).length + 1;
}

/** `projectOrder` as JSON: its brackets and entries, one comma fewer than entries. */
function orderBytes(order: readonly string[]): number {
  let bytes = 1;
  for (const key of order) bytes += orderEntryBytes(key);
  return bytes;
}

function orderFits(count: number, bytes: number): boolean {
  return count <= MAX_PROJECT_ORDER_KEYS && bytes <= PROJECT_ORDER_MAX_BYTES;
}

/** The first of `keys` that fit both limits; a key too long for the bytes left is skipped. */
function fitProjectOrder(keys: readonly string[]): string[] {
  const kept: string[] = [];
  let bytes = 1;
  for (const key of keys) {
    if (kept.length >= MAX_PROJECT_ORDER_KEYS) break;
    const size = orderEntryBytes(key);
    if (bytes + size > PROJECT_ORDER_MAX_BYTES) continue;
    kept.push(key);
    bytes += size;
  }
  return kept;
}

export function emptySessionUiState(): SessionUiState {
  return { version: SESSION_UI_STATE_VERSION, revision: 0, sessions: {}, projects: {} };
}

function normalizeFamily(value: unknown): SessionUiFamilyState | null {
  if (!isPlainObject(value)) return null;
  const family: SessionUiFamilyState = {};
  if (isTimestamp(value.pinnedAt)) family.pinnedAt = value.pinnedAt;
  if (isTimestamp(value.archivedAt)) family.archivedAt = value.archivedAt;
  return family.pinnedAt === undefined && family.archivedAt === undefined ? null : family;
}

function normalizeProject(value: unknown): SessionUiProjectState | null {
  if (!isPlainObject(value) || !isTimestamp(value.pinnedAt) || !isProjectString(value.root)) return null;
  return { pinnedAt: value.pinnedAt, root: value.root };
}

/** Tolerant: returns a clean state from unknown JSON, dropping malformed entries; null if the root shape is unusable. */
export function normalizeSessionUiState(value: unknown): SessionUiState | null {
  if (!isPlainObject(value)) return null;
  // Another version may mean other rules; it is not read as this one.
  if (value.version !== undefined && value.version !== SESSION_UI_STATE_VERSION) return null;
  if (value.sessions !== undefined && !isPlainObject(value.sessions)) return null;
  if (value.projects !== undefined && !isPlainObject(value.projects)) return null;
  const state = emptySessionUiState();
  const revision = value.revision;
  if (typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0) state.revision = revision;
  for (const [id, entry] of Object.entries(value.sessions ?? {})) {
    if (!isSessionId(id)) continue;
    const family = normalizeFamily(entry);
    if (family) state.sessions[id] = family;
  }
  for (const [key, entry] of Object.entries(value.projects ?? {})) {
    if (!isProjectString(key)) continue;
    const project = normalizeProject(entry);
    if (project) state.projects[key] = project;
  }
  // Anything but an array reads as no order: it is cheap to rebuild, and no
  // reason to set pins and archive aside with a file taken for corrupt.
  if (Array.isArray(value.projectOrder)) {
    const seen = new Set<string>();
    const keys = value.projectOrder.filter((key): key is string => {
      if (!isProjectString(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const order = fitProjectOrder(keys);
    if (order.length > 0) state.projectOrder = order;
  }
  return state;
}

type ParseResult = { ok: true; request: SessionUiStateRequest } | { ok: false; error: string };

function parseIds(value: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "ids must be a non-empty array" };
  if (value.length > MAX_SESSION_UI_IDS_PER_REQUEST) {
    return { ok: false, error: `ids may hold at most ${MAX_SESSION_UI_IDS_PER_REQUEST} session ids` };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (!isSessionId(id)) return { ok: false, error: "ids must be session ids" };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ok: true, ids };
}

function parseSnapshotValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isTimestamp(value) ? value : undefined;
}

/** A list of projectKeys: at most MAX_SESSION_UI_IDS_PER_REQUEST, each a project string, deduped keeping the first. */
function parseProjectKeys(value: unknown, name: string, allowEmpty: boolean): { ok: true; keys: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    return { ok: false, error: `${name} must be ${allowEmpty ? "an" : "a non-empty"} array` };
  }
  if (value.length > MAX_SESSION_UI_IDS_PER_REQUEST) {
    return { ok: false, error: `${name} may hold at most ${MAX_SESSION_UI_IDS_PER_REQUEST} projectKeys` };
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of value) {
    if (!isProjectString(key)) {
      return { ok: false, error: `${name} must hold non-empty strings of at most ${MAX_PROJECT_STRING_LENGTH} characters` };
    }
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return { ok: true, keys };
}

/** Validates an untrusted body. ids: non-empty, unique after dedupe, each matches SESSION_ID_PATTERN, at most MAX_SESSION_UI_IDS_PER_REQUEST. projectKey/root/anchorKey and every key of keys/add: non-empty strings <= 4096 chars, at most MAX_SESSION_UI_IDS_PER_REQUEST of them. */
export function parseSessionUiStateRequest(body: unknown): ParseResult {
  if (!isPlainObject(body)) return { ok: false, error: "Expected a JSON object" };
  switch (body.action) {
    case "set": {
      const hasPinned = hasOwn(body, "pinned");
      if (hasPinned === hasOwn(body, "archived")) return { ok: false, error: "Send exactly one of pinned or archived" };
      const value = hasPinned ? body.pinned : body.archived;
      if (typeof value !== "boolean") return { ok: false, error: `${hasPinned ? "pinned" : "archived"} must be a boolean` };
      const ids = parseIds(body.ids);
      if (!ids.ok) return ids;
      return {
        ok: true,
        request: hasPinned
          ? { action: "set", ids: ids.ids, pinned: value }
          : { action: "set", ids: ids.ids, archived: value },
      };
    }
    case "restore": {
      const raw = body.entries;
      if (!Array.isArray(raw)) return { ok: false, error: "entries must be an array" };
      if (raw.length > MAX_SESSION_UI_IDS_PER_REQUEST) {
        return { ok: false, error: `entries may hold at most ${MAX_SESSION_UI_IDS_PER_REQUEST} sessions` };
      }
      const entries: SessionUiFlagsSnapshot[] = [];
      const seen = new Set<string>();
      for (const entry of raw) {
        if (!isPlainObject(entry) || !isSessionId(entry.id)) return { ok: false, error: "Each entry needs a session id" };
        // Two prior values for one family would leave which one wins to chance.
        if (seen.has(entry.id)) return { ok: false, error: "entries must name each session once" };
        seen.add(entry.id);
        const pinnedAt = parseSnapshotValue(entry.pinnedAt);
        const archivedAt = parseSnapshotValue(entry.archivedAt);
        if (pinnedAt === undefined || archivedAt === undefined) {
          return { ok: false, error: "pinnedAt and archivedAt must be timestamps or null" };
        }
        entries.push({ id: entry.id, pinnedAt, archivedAt });
      }
      return { ok: true, request: { action: "restore", entries } };
    }
    case "pin-project": {
      if (!isProjectString(body.projectKey)) {
        return { ok: false, error: `projectKey must be a non-empty string of at most ${MAX_PROJECT_STRING_LENGTH} characters` };
      }
      if (!isProjectString(body.root)) {
        return { ok: false, error: `root must be a non-empty string of at most ${MAX_PROJECT_STRING_LENGTH} characters` };
      }
      if (typeof body.pinned !== "boolean") return { ok: false, error: "pinned must be a boolean" };
      return { ok: true, request: { action: "pin-project", projectKey: body.projectKey, root: body.root, pinned: body.pinned } };
    }
    case "add-projects": {
      const keys = parseProjectKeys(body.keys, "keys", false);
      if (!keys.ok) return keys;
      return { ok: true, request: { action: "add-projects", keys: keys.keys } };
    }
    case "move-project": {
      const { projectKey, anchorKey, position } = body;
      if (!isProjectString(projectKey) || !isProjectString(anchorKey)) {
        return { ok: false, error: `projectKey and anchorKey must be non-empty strings of at most ${MAX_PROJECT_STRING_LENGTH} characters` };
      }
      if (projectKey === anchorKey) return { ok: false, error: "projectKey and anchorKey must differ" };
      if (position !== "before" && position !== "after") return { ok: false, error: "position must be \"before\" or \"after\"" };
      const add = body.add === undefined ? { ok: true as const, keys: [] } : parseProjectKeys(body.add, "add", true);
      if (!add.ok) return add;
      return { ok: true, request: { action: "move-project", projectKey, anchorKey, position, add: add.keys } };
    }
    default:
      return { ok: false, error: "action must be \"set\", \"restore\", \"pin-project\", \"add-projects\" or \"move-project\"" };
  }
}

function sameFamily(a: SessionUiFamilyState | undefined, b: SessionUiFamilyState): boolean {
  return a?.pinnedAt === b.pinnedAt && a?.archivedAt === b.archivedAt;
}

/** Stores `next` for `id` (an empty entry is removed) and says whether that changed anything. */
function writeFamily(sessions: Record<string, SessionUiFamilyState>, id: string, next: SessionUiFamilyState): boolean {
  const previous = hasOwn(sessions, id) ? sessions[id] : undefined;
  const empty = next.pinnedAt === undefined && next.archivedAt === undefined;
  if (empty) {
    if (!previous) return false;
    delete sessions[id];
    return true;
  }
  if (sameFamily(previous, next)) return false;
  sessions[id] = next;
  return true;
}

function nextFamily(
  previous: SessionUiFamilyState | undefined,
  request: Extract<SessionUiStateRequest, { action: "set" }>,
  now: number,
): SessionUiFamilyState {
  const next: SessionUiFamilyState = { ...previous };
  if ("pinned" in request) {
    if (!request.pinned) {
      delete next.pinnedAt;
    } else if (next.pinnedAt === undefined || next.archivedAt !== undefined) {
      // Pin and archive exclude each other: pinning an archived family restores it.
      next.pinnedAt = now;
      delete next.archivedAt;
    }
    return next;
  }
  if (request.archived) {
    // Archiving again refreshes the time, so a family that came back with new activity can be archived again.
    next.archivedAt = now;
    delete next.pinnedAt;
  } else {
    delete next.archivedAt;
  }
  return next;
}

function copyState(state: SessionUiState): SessionUiState {
  const sessions: Record<string, SessionUiFamilyState> = {};
  for (const [id, entry] of Object.entries(state.sessions)) sessions[id] = { ...entry };
  const projects: Record<string, SessionUiProjectState> = {};
  for (const [key, entry] of Object.entries(state.projects)) projects[key] = { ...entry };
  const copy: SessionUiState = { ...state, sessions, projects };
  // Only when present: an explicit undefined would not equal an absent field.
  if (state.projectOrder) copy.projectOrder = [...state.projectOrder];
  return copy;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** Stores `order` (an empty one removes the field) and says whether that changed anything. */
function writeProjectOrder(state: SessionUiState, order: string[]): boolean {
  if (sameOrder(state.projectOrder ?? [], order)) return false;
  if (order.length === 0) delete state.projectOrder;
  else state.projectOrder = order;
  return true;
}

/** `keys` that `order` lacks, each once, in their order. */
function missingProjectKeys(order: readonly string[], keys: readonly string[]): string[] {
  const present = new Set(order);
  const missing: string[] = [];
  for (const key of keys) {
    if (present.has(key)) continue;
    present.add(key);
    missing.push(key);
  }
  return missing;
}

/**
 * "add-projects": the keys `order` lacks go in front, in their order. Nothing
 * is pushed out, so adding stays idempotent. When not all of them fit, the
 * last ones that do are added: those render right above the saved keys, so
 * the ones left out (unsaved, and unsaved keys render first in their band)
 * keep their place on screen.
 */
function withProjectsAdded(order: readonly string[], keys: readonly string[]): string[] {
  const missing = missingProjectKeys(order, keys);
  let count = order.length;
  let bytes = orderBytes(order);
  let first = missing.length;
  while (first > 0) {
    const size = orderEntryBytes(missing[first - 1]);
    if (!orderFits(count + 1, bytes + size)) break;
    count++;
    bytes += size;
    first--;
  }
  return [...missing.slice(first), ...order];
}

/**
 * `key` right before or after `anchor`. A missing anchor goes to the top
 * first, which is where an unsaved project renders.
 */
function withProjectMoved(order: readonly string[], key: string, anchor: string, position: ProjectMovePosition): string[] {
  const list = order.filter((item) => item !== key);
  if (!list.includes(anchor)) list.unshift(anchor);
  const index = list.indexOf(anchor);
  list.splice(position === "before" ? index : index + 1, 0, key);
  return list;
}

/**
 * Where a project goes when it changes band, next to the boundary: a pin at
 * the bottom of the pinned band (after the last pinned key), an unpin at the
 * top of the others (before the first key not pinned). `pinned` holds the
 * pinned projects after the change.
 */
function withProjectRebanded(order: readonly string[], key: string, pinned: Record<string, SessionUiProjectState>, nowPinned: boolean): string[] {
  const list = order.filter((item) => item !== key);
  let index: number;
  if (nowPinned) {
    index = 0;
    list.forEach((item, position) => {
      if (hasOwn(pinned, item)) index = position + 1;
    });
  } else {
    index = list.findIndex((item) => !hasOwn(pinned, item));
    if (index < 0) index = list.length;
  }
  list.splice(index, 0, key);
  return list;
}

/**
 * `order` within both limits: keys the request does not name go from the end
 * first; if the named ones alone are too many, the first of them that fit stay.
 */
function capProjectOrder(order: string[], keep: ReadonlySet<string>): string[] {
  let count = order.length;
  let bytes = orderBytes(order);
  if (orderFits(count, bytes)) return order;
  const dropped = new Set<number>();
  for (let index = order.length - 1; index >= 0 && !orderFits(count, bytes); index--) {
    if (keep.has(order[index])) continue;
    dropped.add(index);
    count--;
    bytes -= orderEntryBytes(order[index]);
  }
  const kept = order.filter((_, index) => !dropped.has(index));
  return orderFits(count, bytes) ? kept : fitProjectOrder(kept);
}

/**
 * Pure. Returns a NEW state (never mutates input) and whether anything changed. Does NOT touch revision.
 * The project order never depends on `now`, and its requests are relative
 * (keys added if missing, one key placed next to one anchor), so a replay or
 * another window's write in between gives the same placements.
 */
export function applySessionUiStateRequest(
  state: SessionUiState,
  request: SessionUiStateRequest,
  now: number,
): { state: SessionUiState; changed: boolean } {
  const next = copyState(state);
  let changed = false;
  switch (request.action) {
    case "set":
      for (const id of request.ids) {
        const previous = hasOwn(next.sessions, id) ? next.sessions[id] : undefined;
        if (writeFamily(next.sessions, id, nextFamily(previous, request, now))) changed = true;
      }
      break;
    case "restore":
      for (const entry of request.entries) {
        const family: SessionUiFamilyState = {};
        if (entry.pinnedAt !== null) family.pinnedAt = entry.pinnedAt;
        if (entry.archivedAt !== null) family.archivedAt = entry.archivedAt;
        if (writeFamily(next.sessions, entry.id, family)) changed = true;
      }
      break;
    case "pin-project": {
      const { projectKey, root } = request;
      const previous = hasOwn(next.projects, projectKey) ? next.projects[projectKey] : undefined;
      if (request.pinned) {
        if (previous?.root !== root) {
          next.projects[projectKey] = { pinnedAt: now, root };
          changed = true;
        }
      } else if (previous) {
        delete next.projects[projectKey];
        changed = true;
      }
      // A project that changes band gets a saved place next to the boundary
      // (a new root for a pinned project is no change of band), never at the
      // cost of another key: a full list leaves a project it lacks unsaved.
      const rebanded = request.pinned ? previous === undefined : previous !== undefined;
      if (rebanded && next.projectOrder) {
        const order = withProjectRebanded(next.projectOrder, projectKey, next.projects, request.pinned);
        if (orderFits(order.length, orderBytes(order)) && writeProjectOrder(next, order)) changed = true;
      }
      break;
    }
    case "add-projects":
      if (writeProjectOrder(next, withProjectsAdded(next.projectOrder ?? [], request.keys))) changed = true;
      break;
    case "move-project": {
      const { projectKey, anchorKey, position, add } = request;
      const order = next.projectOrder ?? [];
      const moved = withProjectMoved([...missingProjectKeys(order, add), ...order], projectKey, anchorKey, position);
      const named = new Set([projectKey, anchorKey, ...add]);
      if (writeProjectOrder(next, capProjectOrder(moved, named))) changed = true;
      break;
    }
  }
  return { state: next, changed };
}

/**
 * `items` in slices of at most `size` (a request's limit), in order. A change
 * to more families than one request may carry ("Archive sessions older than 7
 * days" in a busy project, and its Undo) is sent as several requests.
 */
export function chunkForSessionUiRequests<T>(items: readonly T[], size = MAX_SESSION_UI_IDS_PER_REQUEST): T[][] {
  const step = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += step) chunks.push(items.slice(start, start + step));
  return chunks;
}

/** Snapshot of the current flags for undo; each id once, in the order given. */
export function snapshotSessionUiFlags(state: SessionUiState, ids: readonly string[]): SessionUiFlagsSnapshot[] {
  const seen = new Set<string>();
  const snapshot: SessionUiFlagsSnapshot[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = hasOwn(state.sessions, id) ? state.sessions[id] : undefined;
    snapshot.push({ id, pinnedAt: entry?.pinnedAt ?? null, archivedAt: entry?.archivedAt ?? null });
  }
  return snapshot;
}
