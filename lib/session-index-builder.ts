/**
 * Index builder — parses JSONL session files and populates the SQLite index.
 *
 * Full scan: reads an entire file line by line, extracting metadata and
 * content previews. Used on first access or when mtime/size indicates a
 * full re-index is needed.
 *
 * Incremental scan: reads only new lines (beyond lastIndexedLine). Used
 * when the file has grown since the last index pass.
 *
 * @see docs/PLAN-SQLITE-SESSION-INDEX.md
 */

import { createReadStream, readdirSync, readFileSync, statSync } from "fs";
import { createInterface } from "readline";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  getSessionById,
  getEntriesBySession,
  insertEntry,
  upsertSession,
  initSchema,
  type IndexedEntry,
  type IndexedSessionInfo,
} from "./session-index";

const MAX_CONTENT_PREVIEW = 500;

// ── JSONL parsing helpers ────────────────────────────────────────────────────

type RawEntry = Record<string, unknown>;

function parseLine(line: string): RawEntry | null {
  if (!line.trim()) return null;
  try {
    const entry = JSON.parse(line) as RawEntry;
    return entry && typeof entry === "object" ? entry : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is RawEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTextContent(message: RawEntry): string {
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  // Pick non-empty text blocks; assistant answers often start with a bare
  // "\n\n" text block that shouldn't become the preview.
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        isRecord(block)
        && block.type === "text"
        && typeof block.text === "string"
        && block.text.trim().length > 0,
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Surface tool names for an assistant answer that has no text blocks
 *  (a pure tool-call turn) so the minimap row isn't a bare serial number. */
function extractAssistantToolNames(message: RawEntry): string {
  const content = message.content;
  if (!Array.isArray(content)) return "";
  const names = content
    .filter(
      (block): block is { type: string; name: string } => (
        isRecord(block)
        && (block.type === "toolCall" || block.type === "tool_use")
        && typeof block.name === "string"
        && block.name.length > 0
      ),
    )
    .map((block) => block.name);
  return names.length > 0 ? `[${names.join(", ")}]` : "";
}

function extractToolResultInfo(message: RawEntry): { toolName: string | null; contentSize: number | null } {
  if (message.role !== "toolResult") return { toolName: null, contentSize: null };
  const toolName = typeof message.toolName === "string" ? message.toolName : null;
  const content = message.content;
  let size = 0;
  if (typeof content === "string") {
    size = Buffer.byteLength(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        size += Buffer.byteLength(block.text);
      }
    }
  }
  return { toolName, contentSize: size };
}

function extractTimestamp(entry: RawEntry): string {
  if (typeof entry.timestamp === "string") return entry.timestamp;
  if (typeof entry.message === "object" && entry.message !== null) {
    const msg = entry.message as RawEntry;
    if (typeof msg.timestamp === "number") return new Date(msg.timestamp).toISOString();
  }
  return new Date(0).toISOString();
}

function extractParentId(entry: RawEntry): string | null {
  return typeof entry.parentId === "string" ? entry.parentId : null;
}

function entryToIndexed(entry: RawEntry, sessionId: string, lineIndex: number): IndexedEntry | null {
  const id = typeof entry.id === "string" ? entry.id : null;
  if (!id) return null;

  const type = typeof entry.type === "string" ? entry.type : "unknown";
  const role = isRecord(entry.message) ? (typeof entry.message.role === "string" ? entry.message.role : null) : null;
  const timestamp = extractTimestamp(entry);
  const parentId = extractParentId(entry);

  let contentPreview = "";
  let toolName: string | null = null;
  let contentSizeBytes: number | null = null;
  let firstKeptEntryId: string | null = null;
  let hasText = false;

  if (role === "user" || role === "assistant") {
    let text = extractTextContent(entry.message as RawEntry);
    if (text.length > 0) hasText = true;
    if (!text && role === "assistant") {
      // Pure tool-call answer: surface the tool name(s) so the timeline
      // preview isn't empty.
      text = extractAssistantToolNames(entry.message as RawEntry);
    }
    contentPreview = text.length > MAX_CONTENT_PREVIEW ? text.slice(0, MAX_CONTENT_PREVIEW) : text;
  } else if (role === "toolResult") {
    const info = extractToolResultInfo(entry.message as RawEntry);
    toolName = info.toolName;
    contentSizeBytes = info.contentSize;
    contentPreview = toolName ? `[${toolName}]` : "";
  } else if (type === "compaction") {
    const summary = typeof entry.summary === "string" ? entry.summary : "";
    contentPreview = summary.length > MAX_CONTENT_PREVIEW ? summary.slice(0, MAX_CONTENT_PREVIEW) : summary;
    firstKeptEntryId = typeof entry.firstKeptEntryId === "string" ? entry.firstKeptEntryId : null;
  }

  return {
    id,
    sessionId,
    lineIndex,
    type,
    role,
    timestamp,
    parentId,
    contentPreview,
    toolName,
    contentSizeBytes,
    firstKeptEntryId,
    hasText,
  };
}

// ── Full scan ────────────────────────────────────────────────────────────────

export async function indexSessionFile(
  filePath: string,
  sessionId?: string,
): Promise<{ indexedLines: number; sessionInfo: IndexedSessionInfo | null }> {
  const stats = statSync(filePath);
  const header = readSessionHeader(filePath);
  if (!header) return { indexedLines: 0, sessionInfo: null };

  const resolvedId = sessionId ?? (typeof header.id === "string" ? header.id : null);
  if (!resolvedId) return { indexedLines: 0, sessionInfo: null };

  // Create the session record FIRST so entries can reference it via FK
  const headerTime = typeof header.timestamp === "string" && header.timestamp ? new Date(header.timestamp).getTime() : NaN;
  const sessionInfo: IndexedSessionInfo = {
    id: resolvedId,
    filePath,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    name: null,
    created: typeof header.timestamp === "string" ? header.timestamp : new Date(0).toISOString(),
    modified: !Number.isNaN(headerTime)
      ? new Date(headerTime).toISOString()
      : stats.mtime.toISOString(),
    messageCount: 0,
    firstMessage: "(no messages)",
    fileSize: stats.size,
    lastIndexedLine: 0,
    lastIndexedMtime: stats.mtimeMs,
    parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : null,
  };
  upsertSession(sessionInfo);

  let messageCount = 0;
  let firstMessage = "";
  let name: string | undefined;
  let lineCount = 0;
  let lastActivityTime: number | undefined;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineCount++;
    const entry = parseLine(line);
    if (!entry) continue;

    if (entry.type === "session") continue;

    if (entry.type === "session_info") {
      name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
    }

    const indexed = entryToIndexed(entry, resolvedId, lineCount);
    if (indexed) {
      insertEntry(indexed);
    }

    if (entry.type === "message") {
      messageCount++;
      const msg = entry.message as RawEntry | undefined;
      if (msg && typeof msg.timestamp === "number") {
        lastActivityTime = Math.max(lastActivityTime ?? 0, msg.timestamp);
      }
      if (!firstMessage && msg?.role === "user") {
        firstMessage = extractTextContent(msg) || "(no messages)";
      }
    }
  }

  // Update session with final stats
  const modified =
    typeof lastActivityTime === "number" && lastActivityTime > 0
      ? new Date(lastActivityTime).toISOString()
      : !Number.isNaN(headerTime)
        ? new Date(headerTime).toISOString()
        : stats.mtime.toISOString();

  upsertSession({
    ...sessionInfo,
    name: name ?? null,
    modified,
    messageCount,
    firstMessage: firstMessage || "(no messages)",
    lastIndexedLine: lineCount,
  });

  return { indexedLines: lineCount, sessionInfo: { ...sessionInfo, name: name ?? null, modified, messageCount, firstMessage: firstMessage || "(no messages)", lastIndexedLine: lineCount } };
}

// ── Incremental scan ─────────────────────────────────────────────────────────

export async function incrementallyIndexSessionFile(
  filePath: string,
): Promise<{ indexedLines: number; isNewFile: boolean }> {
  const stats = statSync(filePath);
  const header = readSessionHeader(filePath);
  if (!header) return { indexedLines: 0, isNewFile: false };

  const headerId = typeof header.id === "string" ? header.id : null;
  if (!headerId) return { indexedLines: 0, isNewFile: false };
  const existing = getSessionById(headerId);
  if (existing && existing.lastIndexedLine > 0) {
    // Check if file changed since last index
    if (existing.lastIndexedMtime === stats.mtimeMs && existing.fileSize === stats.size) {
      return { indexedLines: 0, isNewFile: false };
    }

    // Incremental: read from lastIndexedLine + 1
    const startLine = existing.lastIndexedLine;
    const indexedLines = await indexSessionIncremental(filePath, headerId, startLine);
    return { indexedLines, isNewFile: false };
  }

  // Full scan (new or stale file)
  const result = await indexSessionFile(filePath, headerId);
  return { indexedLines: result.indexedLines, isNewFile: true };
}

async function indexSessionIncremental(
  filePath: string,
  sessionId: string,
  startLine: number,
): Promise<number> {
  let lineCount = 0;
  let newEntries = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineCount++;
    if (lineCount <= startLine) continue;

    const entry = parseLine(line);
    if (!entry) continue;

    const indexed = entryToIndexed(entry, sessionId, lineCount);
    if (indexed) {
      insertEntry(indexed);
      newEntries++;
    }
  }

  // Update session metadata
  const stats = statSync(filePath);
  const existing = getSessionById(sessionId);
  if (existing) {
    const allEntries = getEntriesBySession(sessionId, undefined, 100000);
    upsertSession({
      ...existing,
      messageCount: allEntries.filter((e) => e.type === "message").length,
      fileSize: stats.size,
      lastIndexedLine: lineCount,
      lastIndexedMtime: stats.mtimeMs,
    });
  }

  return newEntries;
}

// ── Session header ───────────────────────────────────────────────────────────

function readSessionHeader(filePath: string): RawEntry | null {
  const firstLine = readFileSync(filePath, "utf8").split("\n")[0]?.trim();
  if (!firstLine) return null;
  const entry = parseLine(firstLine);
  return entry && entry.type === "session" ? entry : null;
}

// ── File enumeration ─────────────────────────────────────────────────────────

export function getSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

export function enumerateSessionFiles(): string[] {
  const sessionsDir = getSessionsDir();
  try {
    const dirs = readdirSync(sessionsDir, { withFileTypes: true });
    const files: string[] = [];
    for (const dir of dirs) {
      if (!dir.isDirectory() && !dir.isSymbolicLink()) continue;
      const dirPath = join(sessionsDir, dir.name);
      const subFiles = readdirSync(dirPath);
      for (const f of subFiles) {
        if (f.endsWith(".jsonl")) files.push(join(dirPath, f));
      }
    }
    return files;
  } catch {
    return [];
  }
}

// ── Build all ────────────────────────────────────────────────────────────────

export async function buildFullIndex(): Promise<{ sessions: number; entries: number }> {
  initSchema();
  const files = enumerateSessionFiles();
  let sessionCount = 0;
  let entryCount = 0;

  for (const filePath of files) {
    try {
      const { indexedLines, sessionInfo } = await indexSessionFile(filePath);
      if (sessionInfo) {
        sessionCount++;
        entryCount += indexedLines;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return { sessions: sessionCount, entries: entryCount };
}
