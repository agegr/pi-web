import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync } from "fs";
import { dirname, join, normalize as normalizePath } from "path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { sessionPathKey } from "./session-path";
import { getCachedProjectInfo, resolveProject, type ProjectInfo } from "./worktree";

export { getAgentDir };

/**
 * Path to the SDK's sessions directory. Computed inline (instead of imported)
 * because `getSessionsDir` is not re-exported from the package's main entry
 * point — the SDK keeps it private to `dist/core/`. Mirrors the SDK's own
 * `getSessionsDir()` in `dist/config.js` so we agree on the location.
 */
function getSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

export async function attachSessionProjectInfo(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return sessions.map((session) => {
    const project = session.cwd ? projectByCwd.get(session.cwd) : undefined;
    return {
      ...session,
      projectRoot: project?.projectRoot ?? session.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

/**
 * Synchronous, cache-only variant of `attachSessionProjectInfo` for callers
 * that cannot block on git (the hot /api/sessions path, stale-while-revalidate
 * refreshes, etc.). Reads from the same `__piProjectCache` that `resolveProject`
 * populates, so the result matches what `attachSessionProjectInfo` would have
 * returned once enrichment has run at least once for that cwd.
 *
 * Cwd-less sessions keep `projectRoot = ""` to match the async path's behaviour.
 */
export function applyCachedProjectInfo(session: SessionInfo): SessionInfo {
  const project = session.cwd ? getCachedProjectInfo(session.cwd) : null;
  const projectRoot = project?.projectRoot || session.cwd || "";
  const worktreeBranch = project?.isWorktree && project.branch ? project.branch : undefined;
  if (session.projectRoot === projectRoot && session.worktreeBranch === worktreeBranch) return session;
  return { ...session, projectRoot, worktreeBranch };
}

/**
 * Fire-and-forget enrichment: resolves project info for every unique cwd
 * in `sessions` and lets `__piProjectCache` (60s TTL) fill in. Designed to
 * be called from the request hot path *after* the response has been sent,
 * so the UI sees the cached values immediately and the next refresh gets
 * the freshly-computed worktree groupings.
 *
 * Returns the in-flight promise for tests that want to await completion.
 * Errors are swallowed — git failures should not propagate to the caller
 * and are no-ops for the cache (the miss path already falls back to cwd).
 */
export function scheduleProjectEnrichment(sessions: SessionInfo[]): Promise<void> {
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  if (uniqueCwds.length === 0) return Promise.resolve();
  // Skip cwds whose cache entry is already fresh — those won't trigger a
  // git call inside resolveProject anyway, but skipping here also avoids
  // walking the list to find that out for callers that schedule repeatedly.
  return Promise.all(
    uniqueCwds.map((cwd) => resolveProject(cwd).catch(() => undefined)),
  ).then(() => undefined);
}

export function mergeSessionLists(
  persistedSessions: SessionInfo[],
  supplementalSessions: SessionInfo[],
): SessionInfo[] {
  const byId = new Map(supplementalSessions.map((session) => [session.id, session]));
  // A disk scan is authoritative once the JSONL exists. In particular, this
  // replaces a transient registry snapshot without briefly rendering two rows.
  for (const session of persistedSessions) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(sessionPathKey(s.path), s.id);

  const sessions = piSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(sessionPathKey(s.parentSessionPath)) : undefined,
      transient: false,
    };
  });
  return attachSessionProjectInfo(sessions);
}

export async function listAllSessions(options: { force?: boolean } = {}): Promise<SessionInfo[]> {
  if (options.force) invalidateSessionListCache();
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // In-memory cache (cheapest). Survives within one process; wiped on
  // restart, hot reload, or invalidate().
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__piSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  // Disk cache: survives process restarts so cold boots don't pay the full
  // JSONL scan + git tax. Skipped on `force` and when the cached directory
  // mtime predates the on-disk sessions directory (a file was added/removed/
  // rewritten since we wrote the cache).
  if (!options.force) {
    const diskCache = loadListCacheFromDisk();
    const currentDirMtime = getSessionsDirMtime();
    if (diskCache && currentDirMtime > 0 && diskCache.sessionsDirMtimeMs >= currentDirMtime) {
      globalThis.__piSessionListCache = { data: diskCache.sessions, ts: Date.now() };
      return diskCache.sessions;
    }
  }

  const loadPromise = loadAllSessions().then((data) => {
    // If a mutation invalidated this scan, make this caller join (or start) a
    // scan for the current generation. Returning the stale result here made a
    // refresh race indistinguishable from a successful refresh.
    if ((globalThis.__piSessionListGeneration ?? 0) !== generation) {
      return listAllSessions();
    }
    globalThis.__piSessionListCache = { data, ts: Date.now() };
    // Persist to disk for next cold boot. Errors are swallowed — disk write
    // failures should not break the response. Wrapped in queueMicrotask so
    // the response is not delayed by the I/O.
    queueMicrotask(() => {
      writeListCacheToDisk(data).catch((error) => {
        console.warn("pi-web: failed to persist session list cache:", error);
      });
    });
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;

const LIST_CACHE_FILENAME = ".pi-web-list-cache.json";
const LIST_CACHE_SCHEMA_VERSION = 1;

function getListCachePath(): string {
  return join(getAgentDir(), LIST_CACHE_FILENAME);
}

interface ListCacheFile {
  schemaVersion: number;
  savedAt: number;
  sessionsDirMtimeMs: number;
  sessions: SessionInfo[];
}

/** mtime (ms) of the sessions directory, or 0 if it does not exist. */
function getSessionsDirMtime(): number {
  try {
    return statSync(getSessionsDir()).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Read the disk-cached session list. Returns null on any failure (missing
 * file, corrupt JSON, schema mismatch) so the caller can transparently fall
 * back to a fresh scan. The cache is treated as advisory — never trust it
 * over a mtime check.
 */
function loadListCacheFromDisk(): ListCacheFile | null {
  try {
    const raw = readFileSync(getListCachePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ListCacheFile>;
    if (!parsed || parsed.schemaVersion !== LIST_CACHE_SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.sessions)) return null;
    if (typeof parsed.sessionsDirMtimeMs !== "number") return null;
    return {
      schemaVersion: LIST_CACHE_SCHEMA_VERSION,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
      sessionsDirMtimeMs: parsed.sessionsDirMtimeMs,
      sessions: parsed.sessions as SessionInfo[],
    };
  } catch {
    return null;
  }
}

async function writeListCacheToDisk(sessions: SessionInfo[]): Promise<void> {
  const cachePath = getListCachePath();
  // Safeguard: an empty scan result must NEVER clobber a non-empty cache.
  // Two layers of protection:
  //   1. Don't overwrite an existing non-empty cache with empty data — the
  //      SDK occasionally returns [] during transient FS hiccups
  //      (junction races under `with-clean-home.js`, antivirus stalls,
  //      concurrent readdirs on Windows). Catching this here keeps the
  //      user's real session list alive across cold boots.
  //   2. Don't create a fresh empty cache if the sessions dir actually
  //      contains JSONL files — a first-time write of `[]` over real data
  //      would persist "no sessions" through every subsequent cold boot.
  //      This is the case the user hit when the instrumentation prewarm
  //      raced the dev-mode junction setup.
  if (sessions.length === 0) {
    const existing = loadListCacheFromDisk();
    if (existing && existing.sessions.length > 0) {
      console.warn(
        "pi-web: refusing to overwrite non-empty session list cache with empty result; keeping existing cache",
      );
      return;
    }
    if (!existing) {
      const jsonlCount = countJsonlSessions();
      if (jsonlCount > 0) {
        console.warn(
          `pi-web: scan returned empty but found ${jsonlCount} JSONL files in sessions dir; skipping cache write to avoid data loss`,
        );
        return;
      }
    }
  }
  const file: ListCacheFile = {
    schemaVersion: LIST_CACHE_SCHEMA_VERSION,
    savedAt: Date.now(),
    sessionsDirMtimeMs: getSessionsDirMtime(),
    sessions,
  };
  // writePrivateFileAtomicSync throws on failure (e.g. EACCES). Surface as
  // a rejected promise so the queueMicrotask caller logs and moves on.
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writePrivateFileAtomicSync(cachePath, JSON.stringify(file));
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Count `.jsonl` files under the sessions dir (top-level + one level deep,
 * matching the SDK's listing depth). Returns 0 if the dir is unreadable.
 * Cheap synchronous scan used only by the empty-write safeguard, which
 * is already a rare error path.
 */
function countJsonlSessions(): number {
  try {
    const sessionsDir = getSessionsDir();
    let count = 0;
    const topEntries = readdirSync(sessionsDir, { withFileTypes: true });
    for (const entry of topEntries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        count += 1;
      } else if (entry.isDirectory()) {
        for (const inner of readdirSync(join(sessionsDir, entry.name))) {
          if (inner.endsWith(".jsonl")) count += 1;
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
  // Delete the disk cache so the next read falls through to a fresh scan.
  // Failures here are non-fatal (file may already be absent).
  try {
    unlinkSync(getListCachePath());
  } catch {
    /* expected: file may not exist */
  }
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  // Verify the cached path actually points at an existing file. The disk
  // cache stores paths that were valid in a prior process / dev server's
  // cleanHome (see scripts/with-clean-home.js); under `pnpm dev` the
  // cleanHome is regenerated each start, so cached paths may dangle. A
  // stale `existsSync` check is cheap and prevents opening a missing file.
  if (cached && existsSync(cached)) return cached;

  // Cache miss or stale path: do a fresh scan so `cacheSessionPath` can
  // repopulate the in-memory path cache with the CURRENT process's paths.
  // `force: true` bypasses the in-memory + disk list caches so the scan
  // actually runs (otherwise we'd just return the same stale data).
  await listAllSessions({ force: true });
  const refreshed = getPathCache().get(sessionId);
  if (refreshed && existsSync(refreshed)) return refreshed;
  return null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = sessionPathKey(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const pathKey = sessionPathKey(normalizedPath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
  const previousSessionId = reverseCache.get(pathKey);
  const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
  if (previousPathKey && previousPathKey !== pathKey && reverseCache.get(previousPathKey) === sessionId) {
    reverseCache.delete(previousPathKey);
  }
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    previousOwnerPath &&
    sessionPathKey(previousOwnerPath) === pathKey
  ) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, normalizedPath);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  const pathKey = filePath ? sessionPathKey(filePath) : undefined;
  if (pathKey && reverseCache.get(pathKey) === sessionId) {
    reverseCache.delete(pathKey);
  }
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let foundNewline = false;

    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      foundNewline = newlineIndex !== -1;
    }

    if (!foundNewline && position >= maxHeaderBytes) return null;
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    try {
      const header = JSON.parse(firstLine) as SessionHeader;
      return header.type === "session" ? header : null;
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  const contextEntries = piBuildContextEntries(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  );

  // Convert the SDK-selected context entries and their IDs together. This keeps
  // fork/navigation targets aligned while preserving pi's compaction ordering.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of contextEntries) {
    const localEntry = entry as unknown as SessionEntry;
    const m = entryToUiMessage(localEntry, options);
    if (m) {
      messages.push(m);
      entryIds.push(localEntry.id);
    }
  }

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  // Supported message roles: user, assistant, toolResult, bashExecution.
  // bashExecution messages enter the case "message" branch (entry.type === "message").
  // The early return at line below ("!options.deferThinking || message.role !== "assistant"")
  // passes non-assistant messages — including bashExecution — through unchanged.
  // normalizeToolCalls is a secondary guard (returns non-assistant messages as-is).
  switch (entry.type) {
    case "message": {
      const message = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}
