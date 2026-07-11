import { SessionManager, buildSessionContext as piBuildSessionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { closeSync, createReadStream, openSync, readSync } from "fs";
import { createInterface } from "readline";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext, SessionTreeNode } from "./types";
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
  const reverseCache = getPathToIdCache();
  return piSessions.map((s) => {
    // Populate both caches so detail routes avoid another full session scan.
    cache.set(s.id, s.path);
    reverseCache.set(s.path, s.id);
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
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToIdCache: Map<string, string> | undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToIdCache) globalThis.__piPathToIdCache = new Map();
  return globalThis.__piPathToIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const cached = getPathToIdCache().get(filePath);
  if (cached) return cached;

  // Cold-start fallback: sidebar may not have populated caches yet.
  await listAllSessions();
  return getPathToIdCache().get(filePath);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
  getPathToIdCache().set(filePath, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const filePath = getPathCache().get(sessionId);
  getPathCache().delete(sessionId);
  if (filePath && getPathToIdCache().get(filePath) === sessionId) {
    getPathToIdCache().delete(filePath);
  }
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let position = 0;
    let foundNewline = false;
    const maxHeaderBytes = 64 * 1024;

    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.alloc(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newline = data.indexOf(0x0a);
      chunks.push(newline === -1 ? data : data.subarray(0, newline));
      position += bytesRead;
      foundNewline = newline !== -1;
    }

    if (!foundNewline && position >= maxHeaderBytes) {
      throw new Error(`Session header exceeds ${maxHeaderBytes} bytes`);
    }
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    const header = JSON.parse(firstLine) as SessionHeader;
    return header.type === "session" ? header : null;
  } finally {
    closeSync(fd);
  }
}

export async function readSessionEntry(filePath: string, entryId: string): Promise<SessionEntry | null> {
  const input = createReadStream(filePath);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      const parsed = JSON.parse(line) as SessionHeader | SessionEntry;
      if (parsed.type !== "session" && parsed.id === entryId) return parsed as SessionEntry;
    }
    return null;
  } finally {
    lines.close();
    input.destroy();
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

type EntryLocation = { parentId: string | null; offset: number; length: number };

export interface SessionSnapshot {
  header: SessionHeader | null;
  leafId: string | null;
  name?: string;
  tree: SessionTreeNode[];
  branch: SessionEntry[];
}

function treeEntry(entry: SessionEntry): SessionEntry {
  const base = {
    type: entry.type,
    id: entry.id,
    parentId: entry.parentId,
    timestamp: entry.timestamp,
  };
  if (entry.type !== "message") return base as SessionEntry;
  const content = entry.message.content;
  const preview = typeof content === "string"
    ? content.slice(0, 41)
    : Array.isArray(content)
      ? content
          .map((block) => {
            const text = (block as { type?: string; text?: unknown });
            return text.type === "text" && typeof text.text === "string" ? text.text : "";
          })
          .filter(Boolean)
          .join(" ")
          .slice(0, 41)
      : "";
  return {
    ...base,
    message: { role: entry.message.role, content: preview },
  } as SessionEntry;
}

/**
 * Stream a JSONL session once, retaining only tree metadata and byte offsets.
 * Full message payloads are then read only for the selected root-to-leaf branch.
 */
export async function readSessionSnapshot(
  filePath: string,
  requestedLeafId?: string | null,
  includeTree = true,
): Promise<SessionSnapshot> {
  let header: SessionHeader | null = null;
  let leafId: string | null = null;
  let name: string | undefined;
  const locations = new Map<string, EntryLocation>();
  const treeEntries: SessionEntry[] = [];
  const labels = new Map<string, string>();

  let absoluteOffset = 0;
  let lineOffset = 0;
  let fragments: Buffer[] = [];

  const processLine = (line: Buffer, offset: number) => {
    if (line.length === 0) return;
    const parsed = JSON.parse(line.toString("utf8").trimEnd()) as SessionHeader | SessionEntry;
    if (parsed.type === "session") {
      header = parsed as SessionHeader;
      return;
    }

    const entry = parsed as SessionEntry;
    locations.set(entry.id, { parentId: entry.parentId, offset, length: line.length });
    leafId = entry.id;
    if (entry.type === "session_info") name = entry.name?.trim() || undefined;
    if (entry.type === "label") {
      if (entry.label) labels.set(entry.targetId, entry.label);
      else labels.delete(entry.targetId);
    }
    if (includeTree) treeEntries.push(treeEntry(entry));
  };

  for await (const chunkValue of createReadStream(filePath)) {
    const chunk = chunkValue as Buffer;
    let segmentStart = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 0x0a) continue;
      const segment = chunk.subarray(segmentStart, i);
      const line = fragments.length === 0 ? segment : Buffer.concat([...fragments, segment]);
      processLine(line, lineOffset);
      fragments = [];
      segmentStart = i + 1;
      lineOffset = absoluteOffset + segmentStart;
    }
    if (segmentStart < chunk.length) fragments.push(chunk.subarray(segmentStart));
    absoluteOffset += chunk.length;
  }
  if (fragments.length > 0) processLine(Buffer.concat(fragments), lineOffset);

  const targetLeafId = requestedLeafId === undefined ? leafId : requestedLeafId;
  const branchLocations: EntryLocation[] = [];
  let currentId = targetLeafId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const location = locations.get(currentId);
    if (!location) break;
    branchLocations.push(location);
    currentId = location.parentId;
  }
  branchLocations.reverse();

  const branch: SessionEntry[] = [];
  if (branchLocations.length > 0) {
    const fd = openSync(filePath, "r");
    try {
      for (const location of branchLocations) {
        const buffer = Buffer.alloc(location.length);
        const bytesRead = readSync(fd, buffer, 0, location.length, location.offset);
        branch.push(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").trimEnd()) as SessionEntry);
      }
    } finally {
      closeSync(fd);
    }
  }

  const tree: SessionTreeNode[] = [];
  if (includeTree) {
    const nodes = new Map<string, SessionTreeNode>();
    for (const entry of treeEntries) {
      nodes.set(entry.id, { entry, children: [], label: labels.get(entry.id) });
    }
    for (const entry of treeEntries) {
      const node = nodes.get(entry.id)!;
      const parent = entry.parentId && entry.parentId !== entry.id ? nodes.get(entry.parentId) : undefined;
      if (parent) parent.children.push(node);
      else tree.push(node);
    }
  }

  return { header, leafId, name, tree, branch };
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean } = {},
): SessionContext {
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

  // Build UI history from the FULL branch path (root to leaf), without trimming.
  // pi's buildSessionContext targets LLM context: it drops everything before the last
  // compaction's firstKeptEntryId. Correct for the model, but it would hide compacted
  // history from the UI. We keep piCtx only for thinkingLevel/model, and render every
  // displayable entry on the path ourselves; compaction/branch_summary entries become
  // inline summary messages so the user still sees where context was compressed.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const e of path) {
    const m = entryToUiMessage(e, options.deferThinking ?? false);
    if (m) {
      messages.push(m);
      entryIds.push(e.id);
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

function embeddedImageInfo(block: unknown): { mime?: string; bytes: number } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  const flatData = block.data;
  if (typeof flatData === "string" && flatData.length > 0) {
    return {
      mime: typeof block.mimeType === "string" ? block.mimeType : undefined,
      bytes: Math.round(flatData.length * 3 / 4),
    };
  }

  const source = block.source;
  if (!isRecord(source) || source.type !== "base64") return null;
  const sourceData = source.data;
  if (typeof sourceData !== "string" || sourceData.length === 0) return null;
  return {
    mime: typeof source.media_type === "string" ? source.media_type : undefined,
    bytes: Math.round(sourceData.length * 3 / 4),
  };
}

function omitHistoricalEmbeddedImages(message: AgentMessage): AgentMessage {
  const rawContent = (message as { content?: unknown }).content;
  if (!Array.isArray(rawContent)) return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = rawContent.filter((block) => {
    const image = embeddedImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });

  if (omitted === 0) return message;
  content.push({
    type: "text",
    text: `[${omitted} embedded image${omitted === 1 ? "" : "s"} omitted from pi-web history payload${mimes.size ? `: ${[...mimes].join(", ")}` : ""}, ~${bytes.toLocaleString()} bytes]`,
  });
  return { ...message, content } as AgentMessage;
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(entry: SessionEntry, deferThinking: boolean): AgentMessage | null {
  switch (entry.type) {
    case "message": {
      const message = normalizeToolCalls(entry.message);
      if (deferThinking) {
        const deferred = omitHistoricalEmbeddedImages(message);
        if (deferred.role !== "assistant") return deferred;
        return {
          ...deferred,
          content: deferred.content.map((block) => (
            block.type === "thinking"
              ? { ...block, thinking: "", deferred: true }
              : block
          )),
        };
      }
      return message;
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
