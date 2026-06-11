import { SessionManager, buildSessionContext as piBuildSessionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionEntry, SessionInfo, SessionContext, SessionTreeNode, AssistantMessage } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { readdir, readFile, stat } from "fs/promises";
import { dirname, join } from "path";

export { getAgentDir };

export function getSessionsDir(): string {
  return `${getAgentDir()}/sessions`;
}

// ============================================================================
// Session caches: stored in globalThis for hot-reload safety
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined; // sessionId -> file path
  var __piSessionsCache: { sessions: SessionInfo[]; timestamp: number } | undefined; // listAllSessions result
}

const SESSIONS_CACHE_TTL_MS = 5_000;

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getSessionsCache(): { sessions: SessionInfo[]; timestamp: number } | undefined {
  return globalThis.__piSessionsCache;
}

function setSessionsCache(sessions: SessionInfo[]): void {
  globalThis.__piSessionsCache = { sessions, timestamp: Date.now() };
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const pathCache = getPathCache();
  const sessionsCache = getSessionsCache();
  const now = Date.now();

  // Return cached result if still valid
  if (sessionsCache && now - sessionsCache.timestamp < SESSIONS_CACHE_TTL_MS) {
    return sessionsCache.sessions;
  }

  let sessions: SessionInfo[] = [];

  try {
    const piSessions = await SessionManager.listAll();
    const pathToId = new Map<string, string>();
    for (const s of piSessions) pathToId.set(s.path, s.id);

    sessions = piSessions.map((s) => {
      const info: SessionInfo = {
        path: s.path,
        id: s.id,
        cwd: s.cwd,
        name: s.name,
        created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
        modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
        messageCount: s.messageCount,
        firstMessage: s.firstMessage || "(no messages)",
        parentSessionId: s.parentSessionPath ? pathToId.get(s.parentSessionPath) : undefined,
      };
      pathCache.set(s.id, s.path); // keep path cache in sync
      return info;
    });
  } catch (error) {
    console.error("[pi-web] SessionManager.listAll() failed, falling back to safe manual scan:", error);
    try {
      sessions = await safeManualScan();
    } catch (fallbackErr) {
      console.error("[pi-web] Safe manual scan also failed:", fallbackErr);
      sessions = [];
    }
    // Populate path cache from manual scan results
    for (const s of sessions) {
      pathCache.set(s.id, s.path);
    }
  }

  setSessionsCache(sessions);
  return sessions;
}

// Fallback scanner that walks the sessions directory and reads headers only.
async function safeManualScan(): Promise<SessionInfo[]> {
  const sessionsDir = getSessionsDir();
  const result: SessionInfo[] = [];
  const pathToId = new Map<string, string>();
  const visitedDirs = new Set<string>(); // avoid symlink loops

  async function walk(dir: string): Promise<void> {
    if (visitedDirs.has(dir)) return;
    visitedDirs.add(dir);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          try {
            const content = await readFile(fullPath, "utf8");
            const lines = content.split("\n");
            if (lines.length === 0) continue;
            const header = JSON.parse(lines[0]) as any;
            if (header.type !== "session") continue;

            const sessionId = header.id || `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            // Extract encoded cwd from parent directory name
            const parentDir = dirname(fullPath);
            const parts = parentDir.split(/[\\/]/);
            const encodedCwd = parts[parts.length - 1] || "";
            let cwd = "";
            try {
              cwd = decodeURIComponent(encodedCwd);
            } catch {
              cwd = encodedCwd;
            }

            const created = header.timestamp ? new Date(header.timestamp).toISOString() : new Date().toISOString();
            let modified: string;
            try {
              const stats = await stat(fullPath);
              modified = stats.mtime.toISOString();
            } catch {
              modified = created;
            }

            const info: SessionInfo = {
              path: fullPath,
              id: sessionId,
              cwd,
              name: undefined,
              created,
              modified,
              messageCount: 0,
              firstMessage: "(unreadable)",
            };
            result.push(info);
            pathToId.set(fullPath, sessionId);
          } catch {
            // Skip corrupted file
            continue;
          }
        }
      }
    } catch {
      // ignore unreadable directory
    }
  }

  await walk(sessionsDir);

  // Second pass: assign parentSessionId by reading header.parentSession (absolute path)
  for (const info of result) {
    try {
      const content = await readFile(info.path, "utf8");
      const firstLine = content.split("\n")[0];
      const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
      if (header.type === "session" && header.parentSession) {
        const parentId = pathToId.get(header.parentSession);
        if (parentId) {
          info.parentSessionId = parentId;
        }
      }
    } catch {
      // ignore
    }
  }

  return result;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const pathCache = getPathCache();
  const cached = pathCache.get(sessionId);
  if (cached) return cached;

  // Try to get from sessions cache first
  const sessionsCache = getSessionsCache();
  if (sessionsCache) {
    const found = sessionsCache.sessions.find((s) => s.id === sessionId);
    if (found) {
      pathCache.set(sessionId, found.path);
      return found.path;
    }
  }

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return pathCache.get(sessionId) ?? null;
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

export function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const labelsById = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type === "label") {
      const l = entry as { type: "label"; targetId: string; label?: string };
      if (l.label) labelsById.set(l.targetId, l.label);
      else labelsById.delete(l.targetId);
    }
  }

  const roots: SessionTreeNode[] = [];
  for (const entry of entries) {
    nodeMap.set(entry.id, { entry, children: [], label: labelsById.get(entry.id) });
  }
  for (const entry of entries) {
    const node = nodeMap.get(entry.id)!;
    if (!entry.parentId) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(entry.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }

  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
    stack.push(...node.children);
  }
  return roots;
}

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  // Build entryIds: parallel array to messages[], mapping each message back to its entry id.
  // Needed for fork and navigate_tree calls from the UI.
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Walk path from target leaf to root
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Find the last compaction on path (mirrors pi's buildSessionContext logic)
  let compactionId: string | undefined;
  let firstKeptEntryId: string | undefined;
  for (const e of path) {
    if (e.type === "compaction") {
      compactionId = e.id;
      firstKeptEntryId = (e as { firstKeptEntryId: string }).firstKeptEntryId;
    }
  }

  const entryIds: string[] = [];
  if (compactionId) {
    // The first message in piCtx.messages is the synthetic compaction summary — map to compaction entry id
    entryIds.push(compactionId);
    const compactionIdx = path.findIndex((e) => e.id === compactionId);
    const firstKeptIdx = firstKeptEntryId
      ? path.findIndex((e, i) => i < compactionIdx && e.id === firstKeptEntryId)
      : -1;
    const startIdx = firstKeptIdx >= 0 ? firstKeptIdx : compactionIdx;
    for (let i = startIdx; i < compactionIdx; i++) {
      if (path[i].type === "message") entryIds.push(path[i].id);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) {
      if (path[i].type === "message") entryIds.push(path[i].id);
    }
  } else {
    for (const e of path) {
      if (e.type === "message") entryIds.push(e.id);
    }
  }

  // pi injects compaction summary as {role:"compactionSummary", summary, tokensBefore}.
  // Convert to {role:"user"} so MessageView can render it the same as before.
  const messages = (piCtx.messages as AssistantMessage[]).map((msg) => {
    const raw = msg as unknown as Record<string, unknown>;
    if (raw.role === "compactionSummary") {
      return {
        role: "user" as const,
        content: `*The conversation history before this point was compacted into the following summary:*\n\n${raw.summary ?? ""}`,
        timestamp: raw.timestamp as number | undefined,
      };
    }
    return normalizeToolCalls(msg);
  });

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

export function getLeafId(entries: SessionEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries[entries.length - 1].id;
}
