import { SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { closeSync, openSync, readSync } from "fs";
import { normalize as normalizePath } from "path";
import type {
  AgentMessage,
  AssistantMessage,
  CompactionEntry,
  ModelChangeEntry,
  SessionEntry,
  SessionHeader,
  SessionInfo,
  SessionContext,
  SessionMessageEntry,
  ThinkingLevelChangeEntry,
} from "./types";
import type { SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { resolveProject, type ProjectInfo } from "./worktree";

export { getAgentDir };

async function loadAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(normalizePath(s.path), s.id);

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(piSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return piSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(normalizePath(s.parentSessionPath)) : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  globalThis.__piSessionListPromise ??= loadAllSessions().finally(() => {
    globalThis.__piSessionListPromise = undefined;
  });
  return globalThis.__piSessionListPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
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
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = normalizePath(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const pathKey = normalizePath(filePath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousSessionId = reverseCache.get(pathKey);
  if (previousPath && previousPath !== pathKey && reverseCache.get(previousPath) === sessionId) {
    reverseCache.delete(previousPath);
  }
  if (previousSessionId && previousSessionId !== sessionId && pathCache.get(previousSessionId) === pathKey) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, pathKey);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  if (filePath && reverseCache.get(filePath) === sessionId) {
    reverseCache.delete(filePath);
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

// Types that produce messages when rendered in the chat UI.
// Excludes metadata entries (model_change, thinking_level_change, label,
// session_info, and the extension-only "custom" entry — which the SDK does
// NOT route into LLM context).
const MESSAGE_PRODUCING_TYPES = new Set(["message", "compaction", "branch_summary", "custom_message"]);
// Check whether an entry produces a UI message without paying for full
// conversion. branch_summary is only produced when it actually carries a
// summary string.
function producesUiMessage(entry: SessionEntry): boolean {
  if (!MESSAGE_PRODUCING_TYPES.has(entry.type)) return false;
  if (entry.type === "branch_summary") return !!entry.summary;
  return true;
}

// Walk entries from a target leaf up to the root, returning the path in
// root → leaf order. Returns an empty array when there is no leaf to walk
// (matches the SDK's buildSessionContext behaviour for empty pre-leaf states).
function walkPathToRoot(entries: SessionEntry[], byId: Map<string, SessionEntry>, leafId?: string | null): SessionEntry[] {
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) return [];
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) return [];

  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/**
 * Build the session context shown in the chat UI by default.
 *
 * `messages` and `entryIds` are constructed in lockstep, so for every index i
 * `entryIds[i]` is the session entry id whose content produced `messages[i]`.
 * Fork and navigate_tree map UI rows back to session entries via this
 * pairing, so any drift between the two arrays would break those operations.
 *
 * Ordering follows the SDK's buildSessionContext exactly:
 *  - When a compaction entry is on the active path, the compaction summary is
 *    emitted first (paired with the compaction entry id), then the kept
 *    messages (from `firstKeptEntryId` up to the compaction), then the
 *    messages after the compaction. Entries before `firstKeptEntryId` are
 *    intentionally dropped — they have been folded into the summary and are
 *    not part of the active context the LLM or Fork/navigate_tree see.
 *  - Without a compaction, every message-producing entry on the path is
 *    emitted in order.
 *
 * We do not call `piBuildSessionContext` for the message list: the SDK returns
 * only `messages` (without entry ids), and re-deriving entry ids from that
 * list is what introduced the alignment bug in the first iteration of this
 * optimization. Walking the path ourselves costs the same O(path) and keeps
 * the pairing trustworthy.
 */
export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  // Lightweight entryIndex (no string parsing). Used by BranchNavigator for
  // tree projection without needing the full path walk.
  const childMap = new Map<string, string[]>();
  for (const e of entries) {
    const p = e.parentId ?? "__root__";
    if (!childMap.has(p)) childMap.set(p, []);
    childMap.get(p)!.push(e.id);
  }
  const entryIndex: Record<string, import("./types").EntryMeta> = {};
  for (const e of entries) {
    entryIndex[e.id] = {
      id: e.id,
      type: e.type,
      parentId: e.parentId ?? null,
      childIds: childMap.get(e.id) ?? [],
    };
  }

  if (leafId === null) {
    return { messages: [], entryIds: [], entryIndex, thinkingLevel: "off", model: null };
  }

  const path = walkPathToRoot(entries, byId, leafId);
  if (path.length === 0) {
    return { messages: [], entryIds: [], entryIndex, thinkingLevel: "off", model: null };
  }

  // Extract active settings and the most-recent compaction along the path.
  // This mirrors the SDK's buildSessionContext extraction loop so the values
  // we report stay consistent with what pi would send to the LLM.
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  let compaction: CompactionEntry | null = null;
  for (const e of path) {
    if (e.type === "thinking_level_change") {
      thinkingLevel = (e as ThinkingLevelChangeEntry).thinkingLevel;
    } else if (e.type === "model_change") {
      const mc = e as ModelChangeEntry;
      model = { provider: mc.provider, modelId: mc.modelId };
    } else if (e.type === "message") {
      const msg = (e as SessionMessageEntry).message;
      if ((msg as { role?: string }).role === "assistant") {
        const am = msg as AssistantMessage;
        if (am.provider && am.model) {
          model = { provider: am.provider, modelId: am.model };
        }
      }
    } else if (e.type === "compaction") {
      compaction = e as CompactionEntry;
    }
  }

  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];

  // Push the UI message for an entry, keeping messages and entryIds in
  // lockstep. compaction entries are handled by the caller (they become the
  // leading summary) — pushing them again here would duplicate the summary.
  const pushIfMsg = (entry: SessionEntry) => {
    if (entry.type === "compaction") return;
    if (!producesUiMessage(entry)) return;
    const m = entryToUiMessage(entry, options);
    if (!m) return;
    messages.push(m);
    entryIds.push(entry.id);
  };

  if (compaction) {
    const compactionIdx = path.findIndex(
      (e) => e.type === "compaction" && e.id === (compaction as CompactionEntry).id
    );

    // 1. Compaction summary message — paired with the compaction entry id
    //    so Fork on the summary bubble works and navigate_tree can target it.
    //    We go through entryToUiMessage (the same path as buildFullHistory) so
    //    compaction keeps its upstream `custom|compaction` role and MessageView
    //    routes it to CompactionMessageView for the folded card UI. Hard-coding
    //    a user role here (as an earlier version of this PR did) makes that
    //    branch unreachable and deletes the file-list metadata view upstream
    //    ships with.
    const compactionMsg = entryToUiMessage(compaction, options);
    if (compactionMsg) {
      messages.push(compactionMsg);
      entryIds.push(compaction.id);
    }

    // 2. Kept messages — firstKeptEntryId (inclusive) up to (but not
    //    including) the compaction entry. We only start pushing once we've
    //    seen firstKeptEntryId on the path, matching the SDK exactly.
    let foundFirstKept = false;
    for (let i = 0; i < compactionIdx; i++) {
      if (path[i].id === compaction.firstKeptEntryId) foundFirstKept = true;
      if (foundFirstKept) pushIfMsg(path[i]);
    }

    // 3. Messages AFTER the compaction (post-compaction tail).
    for (let i = compactionIdx + 1; i < path.length; i++) {
      pushIfMsg(path[i]);
    }
  } else {
    // No compaction on this branch — every message-producing entry, in order.
    for (const e of path) {
      pushIfMsg(e);
    }
  }

  return { messages, entryIds, entryIndex, thinkingLevel, model };
}

/**
 * Build a paginated slice of the FULL root → leaf history.
 *
 * Unlike buildSessionContext, this does NOT apply compaction trimming:
 * pre-compaction messages and intermediate compaction summaries are all
 * emitted, in path order. Use this for "show me everything that happened on
 * this branch" views (the floating-history button).
 *
 * Two phases keep this O(path) cheap work + O(page) real conversion:
 *   1. Index pass — collect message-producing entries in path order using
 *      only type checks (no entryToUiMessage calls). Path walk is unavoidable
 *      but stays a tight loop here.
 *   2. Convert pass — entryToUiMessage (which runs normalizeToolCalls and
 *      walks content blocks) runs only on the entries in the requested page.
 *
 * `messages` and `entryIds` are again built in lockstep so every row's
 * entryId matches its message, keeping Fork/navigate_tree reliable.
 */
export function buildFullHistory(
  entries: SessionEntry[],
  leafId?: string | null,
  offset = 0,
  limit = 200
): { messages: AgentMessage[]; entryIds: string[]; total: number } {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const path = walkPathToRoot(entries, byId, leafId);
  if (path.length === 0) {
    return { messages: [], entryIds: [], total: 0 };
  }

  // Phase 1: cheap index pass — just record which path entries produce
  // messages. No string parsing, no normalizeToolCalls, no content walks.
  const producers: SessionEntry[] = [];
  for (const e of path) {
    if (producesUiMessage(e)) producers.push(e);
  }
  const total = producers.length;

  // Clamp offset/limit to the valid page range.
  const start = Math.max(0, Math.min(offset, total));
  const end = Math.min(start + Math.max(0, limit), total);

  // Phase 2: convert only the entries in the page slice.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (let i = start; i < end; i++) {
    const m = entryToUiMessage(producers[i]);
    if (!m) continue;
    messages.push(m);
    entryIds.push(producers[i].id);
  }

  return { messages, entryIds, total };
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

/**
 * Convert a session entry on the active branch into a UI message.
 *
 * Returns null for entries that do not map to chat history (metadata, labels,
 * session info, and the extension-only "custom" entry that the SDK does NOT
 * route into LLM context).
 *
 * compaction entries become a `custom|compaction` message that
 * `CompactionMessageView` (components/MessageView.tsx) renders with a folded
 * card UI (`parseCompactionSummary` extracts `<read-files>` / `<modified-files>`).
 * UserMessageView never sees them — they never become user-role here. Keeping
 * this shape in sync with upstream keeps the PR diff small and lets us mix
 * and match this file's behaviour with upstream fixes.
 *
 * When called with `options` (from buildSessionContext), `message` entries
 * respect deferThinking / deferToolResultImages for performance.
 */
function entryToUiMessage(
  entry: SessionEntry,
  options?: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  switch (entry.type) {
    case "message": {
      const message = options?.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      if (!options?.deferThinking || message.role !== "assistant") return message;
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
        customType: entry.customType ?? entry.type,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}
