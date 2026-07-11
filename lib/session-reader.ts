import { SessionManager, buildSessionContext as piBuildSessionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, SessionEntry, SessionInfo, SessionContext } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { resolveProject, type ProjectInfo } from "./worktree";

export { getAgentDir };

export async function listAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(s.path, s.id);

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(piSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  const cache = getPathCache();
  return piSessions.map((s) => {
    // Populate path cache so resolveSessionPath works without a full scan
    cache.set(s.id, s.path);
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
      parentSessionId: s.parentSessionPath ? pathToId.get(s.parentSessionPath) : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

// Types that produce messages in the UI
const MESSAGE_PRODUCING_TYPES = new Set(["message", "compaction", "branch_summary", "custom_message"]);

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  // ── Step 1: Use pi-coding-agent for trimmed messages + settings ──
  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  // ── Step 2: Build lightweight entryIndex (no string parsing) ──
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

  // ── Step 3: Build entryIds aligned to piCtx.messages ──
  // Walk path from leaf to root, collect entries that produce UI messages
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], entryIndex, thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], entryIndex, thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Walk path from leaf to root
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Collect entries that produce UI messages (root → leaf order)
  // Only count entries where entryToUiMessage returns non-null
  const convertibleEntries: { entry: SessionEntry; entryId: string }[] = [];
  for (const e of path) {
    if (!MESSAGE_PRODUCING_TYPES.has(e.type)) continue;
    // Check if entry actually produces a UI message
    const testMsg = entryToUiMessage(e);
    if (testMsg) {
      convertibleEntries.push({ entry: e, entryId: e.id });
    }
  }

  // Align: take the last N convertible entries where N = piCtx.messages.length
  // This handles compaction trimming from the front
  const trimCount = convertibleEntries.length - piCtx.messages.length;
  const entryIds = trimCount > 0
    ? convertibleEntries.slice(trimCount).map((c) => c.entryId)
    : convertibleEntries.map((c) => c.entryId);

  // Fallback: if alignment fails, use legacy full traversal
  if (piCtx.messages.length === 0 && convertibleEntries.length > 0) {
    console.warn("[buildSessionContext] piCtx.messages empty, falling back to legacy");
    const messages: AgentMessage[] = [];
    const legacyEntryIds: string[] = [];
    for (const { entry, entryId } of convertibleEntries) {
      const m = entryToUiMessage(entry);
      if (m) {
        messages.push(m);
        legacyEntryIds.push(entryId);
      }
    }
    return { messages, entryIds: legacyEntryIds, entryIndex, thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Convert compactionSummary role to user message (pi injects it but MessageView doesn't handle the role)
  const messages = (piCtx.messages as unknown as AgentMessage[]).map((m) => {
    if ((m as { role?: string }).role === "compactionSummary") {
      const raw = m as unknown as Record<string, unknown>;
      return {
        role: "user" as const,
        content: `*The conversation history before this point was compacted into the following summary:*\n\n${raw.summary ?? ""}`,
        timestamp: raw.timestamp as number | undefined,
      };
    }
    return m;
  });

  return {
    messages,
    entryIds,
    entryIndex,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

/**
 * Build paginated full history (root → leaf) with all message-producing entries.
 * offset: skip first N message-producing entries; limit: return at most N entries.
 * Returns { messages, entryIds, total } where total is the full count of message-producing entries.
 */
export function buildFullHistory(
  entries: SessionEntry[],
  leafId?: string | null,
  offset = 0,
  limit = 200
): { messages: AgentMessage[]; entryIds: string[]; total: number } {
  // Build byId index
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  // Find target leaf
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], total: 0 };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], total: 0 };
  }

  // Walk path from leaf to root (same as buildSessionContext)
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Single pass: collect all convertible messages, then paginate
  const allMessages: { msg: AgentMessage; entryId: string }[] = [];
  for (const e of path) {
    if (!MESSAGE_PRODUCING_TYPES.has(e.type)) continue;
    const m = entryToUiMessage(e);
    if (!m) continue; // skip entries that don't produce UI messages
    // Convert compaction to user message (same as buildSessionContext)
    if (m.role === "custom" && (m as { customType?: string }).customType === "compaction") {
      const raw = m as unknown as Record<string, unknown>;
      const summary = (raw.content as string) ?? (raw.summary as string) ?? "";
      allMessages.push({
        msg: {
          role: "user" as const,
          content: `*The conversation history before this point was compacted into the following summary:*\n\n${summary}`,
          timestamp: raw.timestamp as number | undefined,
        },
        entryId: e.id,
      });
    } else {
      allMessages.push({ msg: m, entryId: e.id });
    }
  }

  const total = allMessages.length;
  const page = allMessages.slice(offset, offset + limit);
  return {
    messages: page.map((p) => p.msg),
    entryIds: page.map((p) => p.entryId),
    total,
  };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(entry: SessionEntry): AgentMessage | null {
  switch (entry.type) {
    case "message":
      return normalizeToolCalls(entry.message);
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
