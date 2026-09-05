import { randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { getAgentDir, readSessionHeader } from "./session-reader";
import { sessionPathKey } from "./session-path";
import { SUBAGENT_META_TYPE } from "./subagents";
import type { SessionInfo, TrashedSessionInfo } from "./types";

export const SESSION_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const METADATA_FILE = "metadata.json";
const METADATA_VERSION = 1;
const INTERRUPTED_OPERATION_GRACE_MS = 60 * 1000;

interface TrashedSessionMember {
  id: string;
  originalPath: string;
  trashName: string;
}

interface TrashedSessionMetadata {
  version: typeof METADATA_VERSION;
  id: string;
  title: string;
  cwd: string;
  projectKey: string;
  deletedAt: string;
  created: string;
  modified: string;
  messageCount: number;
  members: TrashedSessionMember[];
}

interface TrashEntry {
  directory: string;
  metadata: TrashedSessionMetadata;
}

interface TrashOptions {
  trashRoot?: string;
  sessionsRoot?: string;
  now?: number;
}

export class SessionTrashNotFoundError extends Error {}
export class SessionTrashConflictError extends Error {}

function defaultTrashRoot(): string {
  return join(getAgentDir(), "session-trash");
}

function defaultSessionsRoot(): string {
  return join(getAgentDir(), "sessions");
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === ""
    || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function parseMetadata(value: unknown): TrashedSessionMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<TrashedSessionMetadata>;
  if (
    candidate.version !== METADATA_VERSION
    || typeof candidate.id !== "string"
    || !candidate.id
    || typeof candidate.title !== "string"
    || typeof candidate.cwd !== "string"
    || typeof candidate.projectKey !== "string"
    || !candidate.projectKey
    || typeof candidate.deletedAt !== "string"
    || !Number.isFinite(Date.parse(candidate.deletedAt))
    || typeof candidate.created !== "string"
    || typeof candidate.modified !== "string"
    || typeof candidate.messageCount !== "number"
    || !Array.isArray(candidate.members)
    || candidate.members.length === 0
  ) return null;

  const members: TrashedSessionMember[] = [];
  const ids = new Set<string>();
  for (const member of candidate.members) {
    if (
      !member
      || typeof member !== "object"
      || typeof member.id !== "string"
      || !member.id
      || ids.has(member.id)
      || typeof member.originalPath !== "string"
      || !member.originalPath
      || typeof member.trashName !== "string"
      || !member.trashName
      || basename(member.trashName) !== member.trashName
    ) return null;
    ids.add(member.id);
    members.push({
      id: member.id,
      originalPath: member.originalPath,
      trashName: member.trashName,
    });
  }
  if (!ids.has(candidate.id)) return null;

  return {
    version: METADATA_VERSION,
    id: candidate.id,
    title: candidate.title,
    cwd: candidate.cwd,
    projectKey: candidate.projectKey,
    deletedAt: candidate.deletedAt,
    created: candidate.created,
    modified: candidate.modified,
    messageCount: candidate.messageCount,
    members,
  };
}

function recoverInterruptedOperations(
  directories: readonly Dirent[],
  trashRoot: string,
  sessionsRoot: string,
  now: number,
): void {
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const entryDirectory = resolve(trashRoot, directory.name);
    if (!isPathWithin(trashRoot, entryDirectory)) continue;
    try {
      const metadata = parseMetadata(JSON.parse(readFileSync(join(entryDirectory, METADATA_FILE), "utf8")));
      if (!metadata || metadata.members.some((member) => !isPathWithin(sessionsRoot, member.originalPath))) continue;
      if (
        directory.name.startsWith(".tmp-")
        && Date.parse(metadata.deletedAt) + INTERRUPTED_OPERATION_GRACE_MS > now
      ) continue;
      const locations = metadata.members.map((member) => ({
        member,
        originalExists: existsSync(member.originalPath),
        trashExists: existsSync(join(entryDirectory, member.trashName)),
      }));
      if (locations.some((location) => location.originalExists === location.trashExists)) continue;

      if (directory.name.startsWith(".tmp-")) {
        for (const { member, trashExists } of locations) {
          if (!trashExists) continue;
          mkdirSync(dirname(member.originalPath), { recursive: true });
          renameSync(join(entryDirectory, member.trashName), member.originalPath);
        }
        rmSync(entryDirectory, { recursive: true, force: true });
      } else if (locations.some((location) => !location.trashExists)) {
        for (const { member, trashExists } of locations) {
          if (!trashExists) continue;
          mkdirSync(dirname(member.originalPath), { recursive: true });
          renameSync(join(entryDirectory, member.trashName), member.originalPath);
        }
        rmSync(entryDirectory, { recursive: true, force: true });
      }
    } catch {
      // Keep ambiguous files untouched; the next access can retry safe recovery.
    }
  }
}

function readTrashEntries(options: TrashOptions = {}): TrashEntry[] {
  const trashRoot = resolve(options.trashRoot ?? defaultTrashRoot());
  const sessionsRoot = resolve(options.sessionsRoot ?? defaultSessionsRoot());
  let directories: Dirent[];
  try {
    directories = readdirSync(trashRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  recoverInterruptedOperations(directories, trashRoot, sessionsRoot, options.now ?? Date.now());

  const entries: TrashEntry[] = [];
  for (const directory of directories) {
    if (!directory.isDirectory() || directory.name.startsWith(".")) continue;
    const entryDirectory = resolve(trashRoot, directory.name);
    if (!isPathWithin(trashRoot, entryDirectory)) continue;
    try {
      const metadata = parseMetadata(JSON.parse(readFileSync(join(entryDirectory, METADATA_FILE), "utf8")));
      if (!metadata) continue;
      if (metadata.members.some((member) => (
        !isPathWithin(sessionsRoot, member.originalPath)
        || !existsSync(join(entryDirectory, member.trashName))
      ))) continue;
      entries.push({ directory: entryDirectory, metadata });
    } catch {
      // Ignore incomplete or malformed entries rather than risking their data.
    }
  }
  return entries;
}

function planChildReparents(
  entriesToDelete: readonly TrashEntry[],
  allTrashEntries: readonly TrashEntry[],
): { path: string; content: string }[] {
  const deletedByPath = new Map<string, { originalPath: string; parentPath?: string }>();
  for (const entry of entriesToDelete) {
    for (const member of entry.metadata.members) {
      try {
        const header = readSessionHeader(join(entry.directory, member.trashName));
        deletedByPath.set(sessionPathKey(member.originalPath), {
          originalPath: member.originalPath,
          ...(header?.parentSession ? { parentPath: header.parentSession } : {}),
        });
      } catch {
        deletedByPath.set(sessionPathKey(member.originalPath), { originalPath: member.originalPath });
      }
    }
  }

  const survivingParent = (parentPath: string | undefined): string | undefined => {
    let current = parentPath;
    const visited = new Set<string>();
    while (current) {
      const key = sessionPathKey(current);
      if (visited.has(key)) return undefined;
      visited.add(key);
      const deleted = deletedByPath.get(key);
      if (!deleted) return current;
      current = deleted.parentPath;
    }
    return undefined;
  };

  const rewrites: { path: string; content: string }[] = [];
  const childPaths = new Set<string>();
  const directories = new Set([...deletedByPath.values()].map((entry) => dirname(entry.originalPath)));
  for (const directory of directories) {
    try {
      for (const file of readdirSync(directory)) {
        if (file.endsWith(".jsonl")) childPaths.add(join(directory, file));
      }
    } catch {
      // Unreadable session directories have no safe re-parent candidates.
    }
  }
  for (const entry of allTrashEntries) {
    for (const member of entry.metadata.members) {
      if (
        directories.has(dirname(member.originalPath))
        && !deletedByPath.has(sessionPathKey(member.originalPath))
      ) {
        childPaths.add(join(entry.directory, member.trashName));
      }
    }
  }

  for (const childPath of childPaths) {
    try {
      const content = readFileSync(childPath, "utf8");
      const lines = content.split("\n");
      const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
      if (header.type !== "session" || !header.parentSession) continue;
      if (!deletedByPath.has(sessionPathKey(header.parentSession))) continue;

      const parentPath = survivingParent(header.parentSession);
      header.parentSession = parentPath;
      lines[0] = JSON.stringify(header);
      const parentSessionId = parentPath ? readSessionHeader(parentPath)?.id : undefined;
      if (parentPath && parentSessionId) {
        for (let index = 1; index < lines.length; index += 1) {
          let entry: { type?: string; customType?: string; data?: unknown };
          try {
            entry = JSON.parse(lines[index]);
          } catch {
            continue;
          }
          if (
            entry.type !== "custom"
            || entry.customType !== SUBAGENT_META_TYPE
            || typeof entry.data !== "object"
            || entry.data === null
            || Array.isArray(entry.data)
          ) continue;
          entry.data = { ...entry.data, parentSessionId, parentSessionPath: parentPath };
          lines[index] = JSON.stringify(entry);
          break;
        }
      }
      rewrites.push({ path: childPath, content: lines.join("\n") });
    } catch {
      // Unreadable or malformed child files do not block permanent deletion.
    }
  }
  return rewrites;
}

function applyActiveChildReparents(rewrites: readonly { path: string; content: string }[]): void {
  for (const rewrite of rewrites) {
    try {
      writeFileSync(rewrite.path, rewrite.content, "utf8");
    } catch {
      // A child that cannot be updated does not block permanent deletion.
    }
  }
}

function toPublicInfo(metadata: TrashedSessionMetadata): TrashedSessionInfo {
  const deletedAtMs = Date.parse(metadata.deletedAt);
  return {
    id: metadata.id,
    title: metadata.title,
    cwd: metadata.cwd,
    projectKey: metadata.projectKey,
    deletedAt: metadata.deletedAt,
    expiresAt: new Date(deletedAtMs + SESSION_TRASH_RETENTION_MS).toISOString(),
    created: metadata.created,
    modified: metadata.modified,
    messageCount: metadata.messageCount,
    sessionCount: metadata.members.length,
  };
}

/** Includes the selected session and every nested subagent, but not independent forks. */
export function collectSessionsForTrash(
  sessions: readonly SessionInfo[],
  sessionId: string,
): SessionInfo[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const selected = byId.get(sessionId);
  if (!selected) return [];

  const included = new Set([sessionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of sessions) {
      if (
        included.has(session.id)
        || session.relation?.kind !== "subagent"
        || !included.has(session.relation.parentSessionId)
      ) continue;
      included.add(session.id);
      changed = true;
    }
  }
  return sessions.filter((session) => included.has(session.id));
}

/** Moves one visible session family without modifying its JSONL contents. */
export function moveSessionsToTrash(
  selected: SessionInfo,
  sessions: readonly SessionInfo[],
  options: TrashOptions = {},
): TrashedSessionInfo {
  const now = options.now ?? Date.now();
  const trashRoot = resolve(options.trashRoot ?? defaultTrashRoot());
  const sessionsRoot = resolve(options.sessionsRoot ?? defaultSessionsRoot());
  const uniqueSessions = [...new Map(sessions.map((session) => [session.id, session])).values()];
  if (!uniqueSessions.some((session) => session.id === selected.id)) {
    throw new Error("Selected session is missing from the trash set");
  }
  if (uniqueSessions.some((session) => !isPathWithin(sessionsRoot, session.path))) {
    throw new Error("Session path is outside the sessions directory");
  }
  if (uniqueSessions.some((session) => !existsSync(session.path))) {
    throw new SessionTrashNotFoundError("Session file not found");
  }

  const deletedAt = new Date(now).toISOString();
  const safeId = selected.id.replace(/[^A-Za-z0-9._-]/g, "_");
  const stagingDirectory = join(trashRoot, `.tmp-${randomUUID()}`);
  const finalDirectory = join(trashRoot, `${now}-${safeId}-${randomUUID()}`);
  const metadata: TrashedSessionMetadata = {
    version: METADATA_VERSION,
    id: selected.id,
    title: selected.name?.trim() || selected.firstMessage || selected.id,
    cwd: selected.cwd,
    projectKey: selected.projectKey ?? selected.cwd,
    deletedAt,
    created: selected.created,
    modified: selected.modified,
    messageCount: selected.messageCount,
    members: uniqueSessions.map((session, index) => ({
      id: session.id,
      originalPath: resolve(session.path),
      trashName: `${String(index).padStart(4, "0")}.jsonl`,
    })),
  };

  mkdirSync(trashRoot, { recursive: true });
  mkdirSync(stagingDirectory);
  const moved: TrashedSessionMember[] = [];
  try {
    writeFileSync(join(stagingDirectory, METADATA_FILE), `${JSON.stringify(metadata)}\n`, "utf8");
    for (const member of metadata.members) {
      renameSync(member.originalPath, join(stagingDirectory, member.trashName));
      moved.push(member);
    }
    renameSync(stagingDirectory, finalDirectory);
  } catch (error) {
    let rollbackFailed = false;
    for (const member of moved.reverse()) {
      const stagedPath = join(stagingDirectory, member.trashName);
      try {
        if (existsSync(stagedPath) && !existsSync(member.originalPath)) {
          mkdirSync(dirname(member.originalPath), { recursive: true });
          renameSync(stagedPath, member.originalPath);
        }
      } catch {
        rollbackFailed = true;
      }
    }
    if (!rollbackFailed) rmSync(stagingDirectory, { recursive: true, force: true });
    throw error;
  }

  return toPublicInfo(metadata);
}

/** Lists one project's trash and recovers stale interrupted file moves when safe. */
export function listTrashedSessions(
  projectKey: string,
  options: TrashOptions = {},
): TrashedSessionInfo[] {
  return readTrashEntries(options)
    .filter((entry) => entry.metadata.projectKey === projectKey)
    .map((entry) => toPublicInfo(entry.metadata))
    .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}

/** Restores every family member, or throws before overwriting an existing path. */
export function restoreTrashedSession(
  sessionId: string,
  options: TrashOptions = {},
): string[] {
  const matches = readTrashEntries(options).filter((entry) => entry.metadata.id === sessionId);
  if (matches.length !== 1) throw new SessionTrashNotFoundError("Trashed session not found");
  const entry = matches[0];
  if (entry.metadata.members.some((member) => existsSync(member.originalPath))) {
    throw new SessionTrashConflictError("A session file already exists at the restore location");
  }

  const restored: TrashedSessionMember[] = [];
  try {
    for (const member of entry.metadata.members) {
      mkdirSync(dirname(member.originalPath), { recursive: true });
      renameSync(join(entry.directory, member.trashName), member.originalPath);
      restored.push(member);
    }
  } catch (error) {
    for (const member of restored.reverse()) {
      try {
        const restoredPath = member.originalPath;
        if (existsSync(restoredPath)) renameSync(restoredPath, join(entry.directory, member.trashName));
      } catch {
        // Leave the entry visible for manual recovery if rollback cannot complete.
      }
    }
    throw error;
  }

  rmSync(entry.directory, { recursive: true, force: true });
  return entry.metadata.members.map((member) => member.id);
}

/** Permanently removes complete trash entries after validating the full requested set. */
export function permanentlyDeleteTrashedSessions(
  sessionIds: readonly string[],
  options: TrashOptions = {},
): string[] {
  const requestedIds = [...new Set(sessionIds.filter(Boolean))];
  const entries = readTrashEntries(options);
  const byId = new Map(entries.map((entry) => [entry.metadata.id, entry]));
  if (requestedIds.some((id) => !byId.has(id))) {
    throw new SessionTrashNotFoundError("One or more trashed sessions were not found");
  }
  const selectedEntries = requestedIds.map((id) => byId.get(id)!);
  for (const entry of selectedEntries) {
    const rewrites = planChildReparents([entry], entries);
    rmSync(entry.directory, { recursive: true, force: true });
    applyActiveChildReparents(rewrites);
  }
  return requestedIds;
}

/** Permanently removes entries at least 30 days old; failed removals remain retryable. */
export function purgeExpiredTrashedSessions(options: TrashOptions = {}): string[] {
  const now = options.now ?? Date.now();
  const entries = readTrashEntries(options);
  const expiredEntries = entries.filter((entry) => (
    Date.parse(entry.metadata.deletedAt) + SESSION_TRASH_RETENTION_MS <= now
  ));
  const purged: string[] = [];
  for (const entry of expiredEntries) {
    try {
      const rewrites = planChildReparents([entry], entries);
      rmSync(entry.directory, { recursive: true, force: true });
      applyActiveChildReparents(rewrites);
      purged.push(entry.metadata.id);
    } catch {
      // A later app open or refresh retries entries that could not be removed.
    }
  }
  return purged;
}
