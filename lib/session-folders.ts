import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Session-folder groupings are a display-only concept layered on top of the
 * session files pi already manages. Nothing here ever touches a session's
 * .jsonl file — deleting a folder only removes the grouping, never a session.
 */
export interface SessionFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: string;
}

export interface SessionFolderStore {
  version: 1;
  folders: SessionFolder[];
  /** sessionId -> folderId. Sessions missing from this map are "unfiled". */
  assignments: Record<string, string>;
}

function emptyStore(): SessionFolderStore {
  return { version: 1, folders: [], assignments: {} };
}

export function getStorePath(): string {
  return join(getAgentDir(), "session-folders.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeFolder(value: unknown): SessionFolder | null {
  if (!isRecord(value)) return null;
  const { id, name, parentId, order, createdAt } = value;
  if (typeof id !== "string" || typeof name !== "string") return null;
  return {
    id,
    name,
    parentId: typeof parentId === "string" ? parentId : null,
    order: typeof order === "number" ? order : 0,
    createdAt: typeof createdAt === "string" ? createdAt : new Date(0).toISOString(),
  };
}

function readStore(path: string): SessionFolderStore {
  if (!existsSync(path)) return emptyStore();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) return emptyStore();
    const folders = Array.isArray(parsed.folders)
      ? parsed.folders.map(sanitizeFolder).filter((f): f is SessionFolder => f !== null)
      : [];
    const assignments: Record<string, string> = {};
    if (isRecord(parsed.assignments)) {
      for (const [sessionId, folderId] of Object.entries(parsed.assignments)) {
        if (typeof folderId === "string") assignments[sessionId] = folderId;
      }
    }
    return { version: 1, folders, assignments };
  } catch {
    // Corrupt store — do not throw, just start fresh (never touches session files).
    return emptyStore();
  }
}

function writeStore(path: string, store: SessionFolderStore): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(path, JSON.stringify(store, null, 2));
}

/**
 * Every mutator below takes an optional `storePath` (defaulting to the real
 * `~/.pi/agent/session-folders.json`) so tests can point at a temp file
 * without ever touching a real agent directory — same pattern as
 * `provider-credential-store.ts`'s `authPath` parameter.
 */
export function listFolders(storePath: string = getStorePath()): SessionFolderStore {
  return readStore(storePath);
}

export class SessionFolderError extends Error {}

function assertParentExists(folders: SessionFolder[], parentId: string | null): void {
  if (parentId === null) return;
  if (!folders.some((f) => f.id === parentId)) {
    throw new SessionFolderError(`Parent folder not found: ${parentId}`);
  }
}

export function createFolder(
  name: string,
  parentId: string | null = null,
  storePath: string = getStorePath(),
): SessionFolder {
  const trimmed = name.trim();
  if (!trimmed) throw new SessionFolderError("Folder name is required");

  const store = readStore(storePath);
  assertParentExists(store.folders, parentId);

  const siblingCount = store.folders.filter((f) => f.parentId === parentId).length;
  const folder: SessionFolder = {
    id: randomUUID(),
    name: trimmed,
    parentId,
    order: siblingCount,
    createdAt: new Date().toISOString(),
  };
  store.folders.push(folder);
  writeStore(storePath, store);
  return folder;
}

export function renameFolder(
  id: string,
  name: string,
  storePath: string = getStorePath(),
): SessionFolder {
  const trimmed = name.trim();
  if (!trimmed) throw new SessionFolderError("Folder name is required");

  const store = readStore(storePath);
  const folder = store.folders.find((f) => f.id === id);
  if (!folder) throw new SessionFolderError(`Folder not found: ${id}`);
  folder.name = trimmed;
  writeStore(storePath, store);
  return folder;
}

/**
 * Move a folder under a new parent (or to the root when parentId is null).
 * Rejects moves that would create a cycle (making a folder its own descendant).
 */
export function moveFolder(
  id: string,
  parentId: string | null,
  storePath: string = getStorePath(),
): SessionFolder {
  const store = readStore(storePath);
  const folder = store.folders.find((f) => f.id === id);
  if (!folder) throw new SessionFolderError(`Folder not found: ${id}`);
  assertParentExists(store.folders, parentId);

  if (parentId !== null) {
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (cursor === id) throw new SessionFolderError("Cannot move a folder into its own descendant");
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = store.folders.find((f) => f.id === cursor)?.parentId ?? null;
    }
  }

  folder.parentId = parentId;
  writeStore(storePath, store);
  return folder;
}

/**
 * Delete a folder without deleting any sessions. Direct child sessions
 * become unfiled; direct child folders are promoted to the deleted folder's
 * parent. This is the only supported deletion semantics — folders are pure
 * display grouping, so removing one must never destroy session data.
 */
export function deleteFolder(id: string, storePath: string = getStorePath()): void {
  const store = readStore(storePath);
  const folder = store.folders.find((f) => f.id === id);
  if (!folder) throw new SessionFolderError(`Folder not found: ${id}`);

  const promotedParentId = folder.parentId;
  for (const child of store.folders) {
    if (child.parentId === id) child.parentId = promotedParentId;
  }
  for (const [sessionId, folderId] of Object.entries(store.assignments)) {
    if (folderId === id) delete store.assignments[sessionId];
  }
  store.folders = store.folders.filter((f) => f.id !== id);
  writeStore(storePath, store);
}

/** Assign a session to a folder, or pass folderId = null to unfile it. */
export function assignSession(
  sessionId: string,
  folderId: string | null,
  storePath: string = getStorePath(),
): void {
  if (!sessionId) throw new SessionFolderError("sessionId is required");

  const store = readStore(storePath);
  if (folderId !== null && !store.folders.some((f) => f.id === folderId)) {
    throw new SessionFolderError(`Folder not found: ${folderId}`);
  }
  if (folderId === null) {
    delete store.assignments[sessionId];
  } else {
    store.assignments[sessionId] = folderId;
  }
  writeStore(storePath, store);
}

/** Drop assignments for sessions that no longer exist. Best-effort cleanup. */
export function pruneMissingSessions(
  existingSessionIds: ReadonlySet<string>,
  storePath: string = getStorePath(),
): void {
  const store = readStore(storePath);
  let changed = false;
  for (const sessionId of Object.keys(store.assignments)) {
    if (!existingSessionIds.has(sessionId)) {
      delete store.assignments[sessionId];
      changed = true;
    }
  }
  if (changed) writeStore(storePath, store);
}
