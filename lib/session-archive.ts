import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
} from "fs";
import { basename, dirname, join, resolve as resolvePath } from "path";
import type { SessionInfo } from "./types";
import { sessionPathKey } from "./session-path";
import {
  attachSessionProjectInfo,
  getSessionEntries,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  readSessionHeader,
  resolveSessionPath,
} from "./session-reader";

const ARCHIVE_DIR_NAME = "archive";

function sessionsRoot(): string {
  return join(getAgentDir(), "sessions");
}

/** ~/.pi/agent/sessions/<encoded-cwd>/archive — archive files are stored here.
 *  Pi's own session discovery (SessionManager.listAll) only scans one level of
 *  *.jsonl files, so archived sessions disappear from the main list naturally. */
function archiveDirForSessionFile(filePath: string): string {
  return join(dirname(filePath), ARCHIVE_DIR_NAME);
}

function isWithinArchive(filePath: string): boolean {
  const archiveDir = dirname(filePath);
  if (basename(archiveDir) !== ARCHIVE_DIR_NAME) return false;
  const projectDir = dirname(archiveDir);
  return resolvePath(dirname(projectDir)) === resolvePath(sessionsRoot());
}

function fileName(filePath: string): string {
  return basename(filePath);
}

/** Move a session jsonl into its project's archive/ directory (cascading to
 *  direct child sessions so the branch stays intact). */
export async function archiveSession(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return { ok: false, error: "Session not found" };
  if (isWithinArchive(filePath)) return { ok: false, error: "Session already archived" };

  const archiveDir = archiveDirForSessionFile(filePath);
  mkdirSync(archiveDir, { recursive: true });

  const dir = dirname(filePath);
  const moved = new Set<string>([filePath]);
  const toArchive: string[] = [filePath];
  let siblings: string[] = [];
  try {
    siblings = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch { /* sibling scan is best-effort */ }

  const queue = [filePath];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = sessionPathKey(current);
    for (const sibling of siblings) {
      const candidate = join(dir, sibling);
      if (moved.has(candidate) || sessionPathKey(candidate) === currentKey) continue;
      let header: { type?: string; parentSession?: string } | null = null;
      try {
        header = readSessionHeader(candidate);
      } catch {
        continue;
      }
      if (
        header?.type === "session"
        && header.parentSession
        && sessionPathKey(header.parentSession) === currentKey
      ) {
        moved.add(candidate);
        queue.push(candidate);
        toArchive.push(candidate);
      }
    }
  }

  for (const source of toArchive) {
    const dest = join(archiveDir, fileName(source));
    try {
      const id = readSessionHeader(source)?.id;
      renameSync(source, dest);
      if (id) invalidateSessionPathCache(id);
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  invalidateSessionListCache();
  return { ok: true };
}

/** Move a session jsonl back out of archive/ into its project directory. */
export async function unarchiveSession(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const filePath = findArchivedSessionPath(sessionId);
  if (!filePath) return { ok: false, error: "Session not found" };

  const dest = join(dirname(dirname(filePath)), fileName(filePath));
  try {
    renameSync(filePath, dest);
  } catch (error) {
    return { ok: false, error: String(error) };
  }

  invalidateSessionPathCache(sessionId);
  invalidateSessionListCache();
  return { ok: true };
}

/** Locate an archived session file by id (archived files are invisible to the
 *  normal resolveSessionPath catalogue, so we scan archive dirs directly). */
function findArchivedSessionPath(sessionId: string): string | null {
  const root = resolvePath(sessionsRoot());
  let projectDirs: string[] = [];
  try {
    projectDirs = readdirSync(root);
  } catch {
    return null;
  }
  const suffix = `_${sessionId}.jsonl`;
  for (const projectDirName of projectDirs) {
    const archiveDir = join(root, projectDirName, ARCHIVE_DIR_NAME);
    let files: string[];
    try {
      files = readdirSync(archiveDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(suffix)) continue;
      const candidate = join(archiveDir, file);
      try {
        if (readSessionHeader(candidate)?.id === sessionId) return candidate;
      } catch { /* skip malformed */ }
    }
  }
  return null;
}

function archivedSessionInfo(filePath: string): SessionInfo | null {
  try {
    const header = readSessionHeader(filePath);
    if (!header?.id || header.type !== "session") return null;

    let messageCount = 0;
    let firstMessage = "(no messages)";
    try {
      const entries = getSessionEntries(filePath);
      messageCount = entries.filter((entry) => entry.type === "message").length;
      const firstUser = entries.find(
        (entry) => entry.type === "message" && (entry as { message?: { role?: string; content?: unknown } }).message?.role === "user",
      ) as { message?: { role?: string; content?: unknown } } | undefined;
      if (firstUser) {
        const content = firstUser.message?.content;
        if (typeof content === "string") {
          firstMessage = content.slice(0, 200);
        } else if (Array.isArray(content)) {
          const text = content.find((c) => typeof c === "object" && c !== null && (c as { type?: string }).type === "text") as { text?: string } | undefined;
          firstMessage = text?.text?.slice(0, 200) ?? "(no text)";
        }
      }
    } catch { /* keep defaults */ }

    let modified = header.timestamp ?? new Date().toISOString();
    try {
      modified = statSync(filePath).mtime.toISOString();
    } catch { /* use header timestamp */ }

    return {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      created: header.timestamp,
      modified,
      messageCount,
      firstMessage,
      archived: true,
    };
  } catch {
    return null;
  }
}

/** List every archived session across all projects. */
export async function listArchivedSessions(): Promise<SessionInfo[]> {
  const root = resolvePath(sessionsRoot());
  const sessions: SessionInfo[] = [];
  let projectDirs: string[] = [];
  try {
    projectDirs = readdirSync(root);
  } catch {
    return sessions;
  }

  for (const projectDirName of projectDirs) {
    const projectDir = join(root, projectDirName);
    let stat;
    try {
      stat = statSync(projectDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const archiveDir = join(projectDir, ARCHIVE_DIR_NAME);
    let files: string[];
    try {
      files = readdirSync(archiveDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const info = archivedSessionInfo(join(archiveDir, file));
      if (info) sessions.push(info);
    }
  }

  sessions.sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0));
  return attachSessionProjectInfo(sessions);
}
