import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type {
  FileEntry,
  SessionEntry,
  SessionHeader,
  SessionInfo,
  SessionTreeNode,
  SessionMessageEntry,
  SessionInfoEntry,
  LabelEntry,
  AgentMessage,
  SessionContext,
  CompactionEntry,
  TextContent,
} from "./types";
import { normalizeToolCalls } from "./normalize";

function getAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) {
    if (envDir === "~") return homedir();
    if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
    return envDir;
  }
  return join(homedir(), ".pi", "agent");
}

export function getSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

// Build a map of "provider:modelId" -> ModelInfo from ~/.pi/agent/models.json
let _modelCache: Map<string, ModelInfo> | null = null;
function getModelCache(): Map<string, ModelInfo> {
  if (_modelCache) return _modelCache;
  _modelCache = new Map();
  const path = join(getAgentDir(), "models.json");
  if (!existsSync(path)) return _modelCache;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      providers?: Record<string, { models?: { id: string; name?: string }[] }>;
    };
    for (const [provider, providerData] of Object.entries(data.providers ?? {})) {
      for (const model of providerData.models ?? []) {
        if (model.id && model.name) {
          _modelCache.set(`${provider}:${model.id}`, { id: model.id, name: model.name, provider });
        }
      }
    }
  } catch { /* ignore */ }
  return _modelCache;
}

export function getModelNameMap(): Map<string, string> {
  const result = new Map<string, string>();
  for (const info of getModelCache().values()) result.set(info.id, info.name);
  return result;
}

export function getModelList(): ModelInfo[] {
  return Array.from(getModelCache().values());
}

export function invalidateModelCache(): void {
  _modelCache = null;
}

export function getDefaultModel(): { provider: string; modelId: string } | null {
  const path = join(getAgentDir(), "settings.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      defaultProvider?: string;
      defaultModel?: string;
    };
    if (!data.defaultProvider) return null;
    if (data.defaultModel) {
      return { provider: data.defaultProvider, modelId: data.defaultModel };
    }
    // Only provider saved — pick the first model from that provider in models.json
    const first = Array.from(getModelCache().values()).find((m) => m.provider === data.defaultProvider);
    if (first) return { provider: first.provider, modelId: first.id };
  } catch { /* ignore */ }
  return null;
}

export function parseSessionFile(filePath: string): FileEntry[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const entries: FileEntry[] = [];
  for (const line of content.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as FileEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function extractTextContent(message: AgentMessage): string {
  const content = (message as { content: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join(" ");
}

// Extract session UUID from a session file path like ".../2026-03-18T12-11-02-213Z_20a1e7e5-991f-4b91-856d-14dd2d256f20.jsonl"
function extractSessionIdFromPath(filePath: string): string | undefined {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  // format: <timestamp>_<uuid>.jsonl
  const match = base.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1];
}

export function buildSessionInfo(filePath: string): SessionInfo | null {
  try {
    const entries = parseSessionFile(filePath);
    if (entries.length === 0) return null;

    // Skip files without a valid session header (incomplete fork artifacts)
    const maybeHeader = entries[0] as SessionHeader;
    if (maybeHeader.type !== "session") return null;

    const stats = statSync(filePath);
    const id = maybeHeader.id;
    const cwd = maybeHeader.cwd ?? "";
    const created = maybeHeader.timestamp;
    const parentSessionId = maybeHeader.parentSession
      ? extractSessionIdFromPath(maybeHeader.parentSession)
      : undefined;

    let messageCount = 0;
    let firstMessage = "";
    let name: string | undefined;

    for (const entry of entries) {
      if (entry.type === "session_info") {
        const e = entry as SessionInfoEntry;
        if (e.name) name = e.name.trim();
      }
      if (entry.type !== "message") continue;
      messageCount++;
      const msg = (entry as SessionMessageEntry).message;
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const text = extractTextContent(msg);
      if (!firstMessage && msg.role === "user") firstMessage = text;
    }

    return {
      path: filePath,
      id,
      cwd,
      name,
      created,
      modified: stats.mtime.toISOString(),
      messageCount,
      firstMessage: firstMessage || "(no messages)",
      parentSessionId,
    };
  } catch {
    return null;
  }
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const sessionsDir = getSessionsDir();
  const sessions: SessionInfo[] = [];
  if (!existsSync(sessionsDir)) return sessions;

  try {
    const dirs = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(sessionsDir, e.name));

    for (const dir of dirs) {
      try {
        const files = readdirSync(dir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => join(dir, f));
        for (const file of files) {
          const info = buildSessionInfo(file);
          if (info) sessions.push(info);
        }
      } catch {
        // skip unreadable dir
      }
    }
  } catch {
    // skip
  }

  sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return sessions;
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = parseSessionFile(filePath);
  return entries.filter((e): e is SessionEntry => e.type !== "session");
}

export function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
  const labelsById = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "label") {
      const l = entry as LabelEntry;
      if (l.label) labelsById.set(l.targetId, l.label);
      else labelsById.delete(l.targetId);
    }
  }

  const nodeMap = new Map<string, SessionTreeNode>();
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
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  // sort children by timestamp
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort(
      (a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
    );
    stack.push(...node.children);
  }

  return roots;
}



export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }

  let leaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], thinkingLevel: "off", model: null };
  }
  if (leafId) {
    leaf = byId.get(leafId);
  }
  if (!leaf) {
    leaf = entries[entries.length - 1];
  }
  if (!leaf) {
    return { messages: [], entryIds: [], thinkingLevel: "off", model: null };
  }

  // walk from leaf to root
  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  let compaction: CompactionEntry | null = null;

  for (const entry of path) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    } else if (entry.type === "model_change") {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry.type === "message" && (entry as SessionMessageEntry).message.role === "assistant") {
      const msg = (entry as SessionMessageEntry).message as { provider: string; model: string };
      model = { provider: msg.provider, modelId: msg.model };
    } else if (entry.type === "compaction") {
      compaction = entry as CompactionEntry;
    }
  }

  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];

  const appendMessage = (entry: SessionEntry) => {
    if (entry.type === "message") {
      messages.push(normalizeToolCalls((entry as SessionMessageEntry).message));
      entryIds.push(entry.id);
    }
  };

  if (compaction) {
    // Inject compaction summary as a virtual user message matching agent's format
    const summaryMsg: AgentMessage = {
      role: "user",
      content: `*The conversation history before this point was compacted into the following summary:*\n\n${compaction.summary}`,
      timestamp: new Date(compaction.timestamp).getTime(),
    };
    messages.push(summaryMsg);
    entryIds.push(compaction.id);

    const compactionIdx = path.findIndex(
      (e) => e.type === "compaction" && e.id === compaction!.id
    );
    // Find firstKeptEntryId before the compaction node; if not found, skip all pre-compaction entries
    const firstKeptIdx = path.findIndex(
      (e, i) => i < compactionIdx && e.id === compaction!.firstKeptEntryId
    );
    const startIdx = firstKeptIdx >= 0 ? firstKeptIdx : compactionIdx;
    for (let i = startIdx; i < compactionIdx; i++) {
      appendMessage(path[i]);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) {
      appendMessage(path[i]);
    }
  } else {
    for (const entry of path) {
      appendMessage(entry);
    }
  }

  return { messages, entryIds, thinkingLevel, model };
}

export function getLeafId(entries: SessionEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries[entries.length - 1].id;
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety (same as rpc-manager registry)
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
}

export function resolveSessionPath(sessionId: string): string | null {
  const cache = getPathCache();
  const cached = cache.get(sessionId);
  if (cached && existsSync(cached)) return cached;

  const sessionsDir = getSessionsDir();
  if (!existsSync(sessionsDir)) return null;
  try {
    const dirs = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(sessionsDir, e.name));
    for (const dir of dirs) {
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
        for (const file of files) {
          const fullPath = join(dir, file);
          // Read only first line to check header id
          const firstLine = readFileSync(fullPath, "utf8").split("\n")[0];
          try {
            const header = JSON.parse(firstLine) as SessionHeader;
            if (header.type === "session" && header.id === sessionId) {
              cache.set(sessionId, fullPath);
              return fullPath;
            }
          } catch { /* skip malformed */ }
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return null;
}
