/**
 * SQLite session index — fast reads, search, and navigation.
 *
 * Uses node:sqlite (Node.js 22+ built-in) with FTS5.
 * JSONL files remain the write format; this library maintains a read index.
 *
 * @see docs/PLAN-SQLITE-SESSION-INDEX.md
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const SESSION_INDEX_DB_NAME = "pi-web-index.db";

export interface IndexedSessionInfo {
  id: string;
  filePath: string;
  cwd: string;
  name: string | null;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  fileSize: number;
  lastIndexedLine: number;
  lastIndexedMtime: number;
  parentSessionPath: string | null;
}

export interface IndexedEntry {
  id: string;
  sessionId: string;
  lineIndex: number;
  type: string;
  role: string | null;
  timestamp: string;
  parentId: string | null;
  contentPreview: string;
  toolName: string | null;
  contentSizeBytes: number | null;
  firstKeptEntryId: string | null;
  /** Whether this entry carries meaningful text (vs. a pure tool-call marker). */
  hasText: boolean;
}

export interface FtsMatch {
  sessionId: string;
  lineIndex: number;
  entryId: string;
  content: string;
}

// ── Connection management ────────────────────────────────────────────────────

let dbInstance: DatabaseSync | null = null;
let dbPath: string | null = null;

export function getIndexPath(agentDir = getAgentDir()): string {
  return join(agentDir, SESSION_INDEX_DB_NAME);
}

export function isIndexAvailable(dbPath = getIndexPath()): boolean {
  return existsSync(dbPath);
}

export function getIndexDbPath(): string {
  return dbPath ?? getIndexPath();
}

export function getDb(): DatabaseSync {
  if (dbInstance && dbPath) return dbInstance;
  dbPath = getIndexPath();
  dbInstance = new DatabaseSync(dbPath, { open: true });
  dbInstance.exec("PRAGMA journal_mode = WAL");
  dbInstance.exec("PRAGMA synchronous = NORMAL");
  dbInstance.exec("PRAGMA busy_timeout = 5000");
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbPath = null;
  }
}

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  filePath TEXT NOT NULL UNIQUE,
  cwd TEXT NOT NULL,
  name TEXT,
  created TEXT NOT NULL,
  modified TEXT NOT NULL,
  messageCount INTEGER NOT NULL DEFAULT 0,
  firstMessage TEXT,
  fileSize INTEGER NOT NULL,
  lastIndexedLine INTEGER NOT NULL DEFAULT 0,
  lastIndexedMtime REAL NOT NULL DEFAULT 0,
  parentSessionPath TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_modified ON sessions(modified DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL REFERENCES sessions(id),
  lineIndex INTEGER NOT NULL,
  type TEXT NOT NULL,
  role TEXT,
  timestamp TEXT NOT NULL,
  parentId TEXT,
  contentPreview TEXT,
  toolName TEXT,
  contentSizeBytes INTEGER,
  firstKeptEntryId TEXT,
  hasText INTEGER NOT NULL DEFAULT 0,
  UNIQUE(sessionId, lineIndex)
);
CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(sessionId, lineIndex);
CREATE INDEX IF NOT EXISTS idx_entries_role ON entries(sessionId, role);
CREATE INDEX IF NOT EXISTS idx_entries_time ON entries(sessionId, timestamp);
CREATE INDEX IF NOT EXISTS idx_entries_parent ON entries(parentId);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  sessionId UNINDEXED,
  lineIndex UNINDEXED,
  entryId UNINDEXED,
  content,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(sessionId, lineIndex, entryId, content)
  VALUES (new.sessionId, new.lineIndex, new.id, new.contentPreview);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  DELETE FROM entries_fts WHERE sessionId = old.sessionId AND lineIndex = old.lineIndex;
END;
`;

export function initSchema(): void {
  const db = getDb();
  db.exec(SCHEMA_SQL);
  // Migration: add missing columns if the DB predates them.
  try { db.exec("ALTER TABLE entries ADD COLUMN firstKeptEntryId TEXT"); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE entries ADD COLUMN hasText INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE sessions ADD COLUMN parentSessionPath TEXT"); } catch { /* already exists */ }
}

// ── Session operations ───────────────────────────────────────────────────────

export function upsertSession(info: IndexedSessionInfo): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, filePath, cwd, name, created, modified, messageCount, firstMessage, fileSize, lastIndexedLine, lastIndexedMtime, parentSessionPath)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      filePath = excluded.filePath,
      cwd = excluded.cwd,
      name = excluded.name,
      created = excluded.created,
      modified = excluded.modified,
      messageCount = excluded.messageCount,
      firstMessage = excluded.firstMessage,
      fileSize = excluded.fileSize,
      lastIndexedLine = excluded.lastIndexedLine,
      lastIndexedMtime = excluded.lastIndexedMtime,
      parentSessionPath = excluded.parentSessionPath
  `).run(
    info.id, info.filePath, info.cwd, info.name, info.created, info.modified,
    info.messageCount, info.firstMessage, info.fileSize, info.lastIndexedLine, info.lastIndexedMtime,
    info.parentSessionPath,
  );
}

export function deleteSession(sessionId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM entries_fts WHERE sessionId = ?").run(sessionId);
  db.prepare("DELETE FROM entries WHERE sessionId = ?").run(sessionId);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function getSessionById(id: string): IndexedSessionInfo | null {
  const row = getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToSessionInfo(row) : null;
}

export function getAllSessions(): IndexedSessionInfo[] {
  const rows = getDb().prepare("SELECT * FROM sessions ORDER BY modified DESC").all() as Record<string, unknown>[];
  return rows.map(rowToSessionInfo);
}

export function getSessionsByCwd(cwd: string): IndexedSessionInfo[] {
  const rows = getDb().prepare("SELECT * FROM sessions WHERE cwd = ? ORDER BY modified DESC").all(cwd) as Record<string, unknown>[];
  return rows.map(rowToSessionInfo);
}

function rowToSessionInfo(row: Record<string, unknown>): IndexedSessionInfo {
  return {
    id: row.id as string,
    filePath: row.filePath as string,
    cwd: row.cwd as string,
    name: row.name as string | null,
    created: row.created as string,
    modified: row.modified as string,
    messageCount: row.messageCount as number,
    firstMessage: row.firstMessage as string,
    fileSize: row.fileSize as number,
    lastIndexedLine: row.lastIndexedLine as number,
    lastIndexedMtime: row.lastIndexedMtime as number,
    parentSessionPath: (row.parentSessionPath as string) ?? null,
  };
}

// ── Entry operations ─────────────────────────────────────────────────────────

export function insertEntry(entry: IndexedEntry): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO entries (id, sessionId, lineIndex, type, role, timestamp, parentId, contentPreview, toolName, contentSizeBytes, firstKeptEntryId, hasText)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(
    entry.id, entry.sessionId, entry.lineIndex, entry.type, entry.role,
    entry.timestamp, entry.parentId, entry.contentPreview, entry.toolName, entry.contentSizeBytes, entry.firstKeptEntryId,
    entry.hasText ? 1 : 0,
  );
}

export function getEntriesBySession(sessionId: string, role?: string, limit = 500): IndexedEntry[] {
  const db = getDb();
  const query = role
    ? "SELECT * FROM entries WHERE sessionId = ? AND role = ? ORDER BY lineIndex DESC LIMIT ?"
    : "SELECT * FROM entries WHERE sessionId = ? ORDER BY lineIndex DESC LIMIT ?";
  const params = role ? [sessionId, role, limit] : [sessionId, limit];
  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function getEntriesByRange(sessionId: string, lineStart: number, lineEnd: number): IndexedEntry[] {
  const rows = getDb().prepare(
    "SELECT * FROM entries WHERE sessionId = ? AND lineIndex >= ? AND lineIndex <= ? ORDER BY lineIndex ASC",
  ).all(sessionId, lineStart, lineEnd) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function getEntryCount(sessionId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM entries WHERE sessionId = ?").get(sessionId) as { count: number };
  return row.count;
}

export function getLastIndexedLine(sessionId: string): number {
  const row = getDb().prepare(
    "SELECT MAX(lineIndex) as maxLine FROM entries WHERE sessionId = ?",
  ).get(sessionId) as { maxLine: number | null };
  return row.maxLine ?? -1;
}

export function getEntryTimeline(sessionId: string, limit = 1000): IndexedEntry[] {
  const rows = getDb().prepare(`
    SELECT * FROM entries
    WHERE sessionId = ? AND (role IN ('user', 'assistant', 'toolResult') OR type = 'compaction')
    ORDER BY lineIndex ASC
    LIMIT ?
  `).all(sessionId, limit) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

function rowToEntry(row: Record<string, unknown>): IndexedEntry {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string,
    lineIndex: row.lineIndex as number,
    type: row.type as string,
    role: row.role as string | null,
    timestamp: row.timestamp as string,
    parentId: row.parentId as string | null,
    contentPreview: (row.contentPreview as string) ?? "",
    toolName: row.toolName as string | null,
    contentSizeBytes: row.contentSizeBytes as number | null,
    firstKeptEntryId: (row.firstKeptEntryId as string) ?? null,
    hasText: row.hasText === 1 || row.hasText === true,
  };
}

// ── Search operations (FTS5) ─────────────────────────────────────────────────

export interface SearchOptions {
  sessionId?: string;
  limit?: number;
  roles?: string[];
}

export interface SearchResult {
  sessionId: string;
  lineIndex: number;
  entryId: string;
  role: string | null;
  timestamp: string;
  content: string;
  snippet: string;
}

export function searchEntries(query: string, options: SearchOptions = {}): SearchResult[] {
  const db = getDb();
  const limit = options.limit ?? 30;
  const escapeQuery = query.replace(/[\"]/g, '\\"');

  try {
    const result = options.sessionId
      ? db.prepare(
          `SELECT e.id, e.sessionId, e.lineIndex, e.role, e.timestamp,
                  snippet(entries_fts, 3, '<mark>', '</mark>', '...', 30) as snippet
           FROM entries_fts f
           JOIN entries e ON e.sessionId = f.sessionId AND e.lineIndex = f.lineIndex
           WHERE entries_fts MATCH ? AND e.sessionId = ? AND e.role IN ('user','assistant')
           ORDER BY bm25(entries_fts)
           LIMIT ?`,
        ).all(escapeQuery, options.sessionId, limit)
      : db.prepare(
          `SELECT e.id, e.sessionId, e.lineIndex, e.role, e.timestamp,
                  snippet(entries_fts, 3, '<mark>', '</mark>', '...', 30) as snippet
           FROM entries_fts f
           JOIN entries e ON e.sessionId = f.sessionId AND e.lineIndex = f.lineIndex
           WHERE entries_fts MATCH ? AND e.role IN ('user','assistant')
           ORDER BY bm25(entries_fts)
           LIMIT ?`,
        ).all(escapeQuery, limit);
    return (result as Record<string, unknown>[]).map((row) => ({
      sessionId: row.sessionId as string,
      lineIndex: row.lineIndex as number,
      entryId: row.id as string,
      role: row.role as string | null,
      timestamp: row.timestamp as string,
      content: "",
      snippet: row.snippet as string,
    }));
  } catch {
    return [];
  }
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getIndexStats(): { sessions: number; entries: number; dbSizeBytes: number } {
  const db = getDb();
  const sessionCount = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;
  const entryCount = (db.prepare("SELECT COUNT(*) as c FROM entries").get() as { c: number }).c;
  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(dbPath ?? getIndexPath()).size;
  } catch {
    dbSizeBytes = 0;
  }
  return { sessions: sessionCount, entries: entryCount, dbSizeBytes };
}

// ── Test seam ────────────────────────────────────────────────────────────────

export function resetDbForTests(): void {
  closeDb();
}
