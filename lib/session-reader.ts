import {
  SessionManager,
  buildSessionContext as ompBuildSessionContext,
  getAgentDir,
  listAllSessions as ompListAllSessions,
} from "@oh-my-pi/pi-coding-agent";
import type { AgentMessage as OmpAgentMessage } from "@oh-my-pi/pi-agent-core";
import { calculatePromptTokens, estimateTokens, hasContextTokenUsage } from "@oh-my-pi/pi-agent-core/compaction";
import { closeSync, openSync, readSync } from "fs";
import { normalize as normalizePath } from "path";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext } from "./types";
import type { ContextUsage } from "./omp-types";
import type { SessionEntry as OmpSessionEntry, SessionInfo as OmpSessionInfo } from "@oh-my-pi/pi-coding-agent";
import { getOmpRuntime } from "./omp-runtime";
import { normalizeToolCalls } from "./normalize";
import { sessionPathKey } from "./session-path";
import { resolveProject, type ProjectInfo } from "./worktree";

export { getAgentDir };

async function loadAllSessions(): Promise<SessionInfo[]> {
  const ompSessions: OmpSessionInfo[] = await ompListAllSessions();
  const pathToId = new Map<string, string>();
  for (const s of ompSessions) pathToId.set(sessionPathKey(s.path), s.id);

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(ompSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return ompSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.title,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(sessionPathKey(s.parentSessionPath)) : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const generation = globalThis.__ompSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  if (globalThis.__ompSessionListCache && Date.now() - globalThis.__ompSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__ompSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__ompSessionListPromise && globalThis.__ompSessionListPromiseGeneration === generation) {
    return globalThis.__ompSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // An invalidation may happen while the scan is in flight. Do not let that
    // older result repopulate the cache after a session mutation.
    if ((globalThis.__ompSessionListGeneration ?? 0) === generation) {
      globalThis.__ompSessionListCache = { data, ts: Date.now() };
    }
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__ompSessionListPromise === trackedPromise) {
      globalThis.__ompSessionListPromise = undefined;
      globalThis.__ompSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__ompSessionListPromise = trackedPromise;
  globalThis.__ompSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __ompSessionPathCache: Map<string, string> | undefined;
  var __ompPathToSessionIdCache: Map<string, string> | undefined;
  var __ompSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __ompSessionListPromiseGeneration: number | undefined;
  var __ompSessionListGeneration: number | undefined;
  var __ompSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;

export function invalidateSessionListCache(): void {
  globalThis.__ompSessionListGeneration = (globalThis.__ompSessionListGeneration ?? 0) + 1;
  globalThis.__ompSessionListCache = undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__ompSessionPathCache) globalThis.__ompSessionPathCache = new Map();
  return globalThis.__ompSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__ompPathToSessionIdCache) globalThis.__ompPathToSessionIdCache = new Map();
  return globalThis.__ompPathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
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

export async function getSessionEntries(filePath: string): Promise<SessionEntry[]> {
  const manager = await SessionManager.open(filePath);
  return manager.getEntries() as unknown as SessionEntry[];
}

/**
 * Entries on the branch that ends at `leafId`, root-first.
 *
 * Corrupt or pre-fix files can contain parent cycles; stop at the first repeat
 * so loading a session is bounded.
 */
function collectBranchPath(
  entries: SessionEntry[],
  byId: Map<string, SessionEntry>,
  leafId?: string | null,
): SessionEntry[] {
  if (leafId === null) return [];

  const leaf = (leafId ? byId.get(leafId) : undefined) ?? entries[entries.length - 1];
  if (!leaf) return [];

  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let current: SessionEntry | undefined = leaf;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

/**
 * Displayable entries for the chat window, in render order.
 *
 * omp's `buildSessionContext` returns rendered messages but not the entry ids
 * behind them, and the browser needs those ids to fork and to navigate between
 * in-session branches. This mirrors omp's own live-chat transcript —
 * `{ transcript: true, collapseCompactedHistory: true }` — so the browser and
 * the TUI show the same thing: history replaced by the latest compaction is
 * elided, the summary renders at the compaction point, and everything kept or
 * newer follows.
 */
function collectDisplayEntries(
  entries: SessionEntry[],
  byId: Map<string, SessionEntry>,
  leafId?: string | null,
): SessionEntry[] {
  const path = collectBranchPath(entries, byId, leafId);

  // Only the latest compaction on the path is active; earlier ones were
  // themselves superseded.
  let compactionIdx = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].type === "compaction") {
      compactionIdx = i;
      break;
    }
  }
  if (compactionIdx === -1) return path;

  const compaction = path[compactionIdx] as Extract<SessionEntry, { type: "compaction" }>;
  const kept: SessionEntry[] = [];
  let foundFirstKept = false;
  for (let i = 0; i < compactionIdx; i++) {
    if (path[i].id === compaction.firstKeptEntryId) foundFirstKept = true;
    if (foundFirstKept) kept.push(path[i]);
  }

  return [...kept, compaction, ...path.slice(compactionIdx + 1)];
}

/** `models.default` as the UI's `{ provider, modelId }` pair. */
function parseDefaultModel(models: Record<string, string>): { provider: string; modelId: string } | null {
  const selector = models.default;
  if (!selector) return null;
  const slash = selector.indexOf("/");
  if (slash <= 0) return null;
  return { provider: selector.slice(0, slash), modelId: selector.slice(slash + 1) };
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const ompEntries = entries as unknown as OmpSessionEntry[];
  const ompCtx = ompBuildSessionContext(
    ompEntries,
    leafId,
    byId as unknown as Map<string, OmpSessionEntry>,
    { transcript: true, collapseCompactedHistory: true },
  );

  // Convert the branch entries and their IDs together so fork/navigation
  // targets stay aligned with what the transcript renders.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of collectDisplayEntries(entries, byId, leafId)) {
    const m = entryToUiMessage(entry, options);
    if (m) {
      messages.push(m);
      entryIds.push(entry.id);
    }
  }

  return {
    messages,
    entryIds,
    thinkingLevel: ompCtx.thinkingLevel ?? "off",
    model: parseDefaultModel(ompCtx.models),
  };
}

type HistoricalAssistantMessage = Extract<OmpAgentMessage, { role: "assistant" }>;

function readContextSnapshot(message: OmpAgentMessage): Record<string, unknown> | undefined {
  if (!isRecord(message) || !("contextSnapshot" in message)) return undefined;
  return isRecord(message.contextSnapshot) ? message.contextSnapshot : undefined;
}

/**
 * Reconstruct the context usage recorded by omp for a historical session.
 *
 * A stopped session has no AgentSession wrapper, so there is no live stats
 * tracker to query. The latest successful assistant response carries the
 * provider's prompt-token snapshot; use it as the anchor and estimate only
 * messages appended after that response (for example, a pending tool result).
 */
export async function getHistoricalContextUsage(
  entries: SessionEntry[],
  leafId?: string | null,
): Promise<ContextUsage | undefined> {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) byId.set(entry.id, entry);

  const ompEntries = entries as unknown as OmpSessionEntry[];
  const ompById = byId as unknown as Map<string, OmpSessionEntry>;
  const ompContext = ompBuildSessionContext(ompEntries, leafId, ompById);
  const modelSelector = parseDefaultModel(ompContext.models);
  if (!modelSelector) return undefined;

  let contextWindowValue: number | null | undefined;
  try {
    const { modelRegistry } = await getOmpRuntime();
    contextWindowValue = modelRegistry.find(modelSelector.provider, modelSelector.modelId)?.contextWindow;
  } catch {
    return undefined;
  }
  if (typeof contextWindowValue !== "number" || !Number.isFinite(contextWindowValue) || contextWindowValue <= 0) {
    return undefined;
  }
  const contextWindow = contextWindowValue;

  const branch = collectBranchPath(entries, byId, leafId);
  let latestCompactionIndex = -1;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    if (branch[index].type === "compaction") {
      latestCompactionIndex = index;
      break;
    }
  }

  let anchor: HistoricalAssistantMessage | undefined;
  for (let index = branch.length - 1; index > latestCompactionIndex; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const assistant = entry.message as unknown as HistoricalAssistantMessage;
    const snapshot = readContextSnapshot(assistant);
    if (
      assistant.stopReason === "aborted"
      || assistant.stopReason === "error"
      || !assistant.usage
      || (!snapshot && !hasContextTokenUsage(assistant.usage))
    ) {
      continue;
    }
    anchor = assistant;
    break;
  }
  if (!anchor) return undefined;

  const snapshot = readContextSnapshot(anchor);
  const snapshotPromptTokens = snapshot?.promptTokens;
  const promptTokens = typeof snapshotPromptTokens === "number" && Number.isFinite(snapshotPromptTokens)
    ? snapshotPromptTokens
    : calculatePromptTokens(anchor.usage);

  if (!Number.isFinite(promptTokens) || promptTokens < 0) return undefined;

  const activeMessages = ompContext.messages as OmpAgentMessage[];
  let anchorIndex = -1;
  for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
    const message = activeMessages[index];
    if (
      message === anchor
      || (
        message.role === "assistant"
        && message.timestamp === anchor.timestamp
      )
    ) {
      anchorIndex = index;
      break;
    }
  }

  let tailTokens = 0;
  if (anchorIndex >= 0) {
    for (let index = anchorIndex + 1; index < activeMessages.length; index += 1) {
      tailTokens += estimateTokens(activeMessages[index]);
    }
  }

  const tokens = Math.max(0, promptTokens + tailTokens);
  return {
    tokens,
    contextWindow,
    percent: (tokens / contextWindow) * 100,
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
