import { readdirSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, renameSync, existsSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import { resolveSessionPath, invalidateSessionPathCache, getSessionsDir } from "./session-reader";
import { getRpcSession } from "@/lib/agent/rpc-manager";
import type { SessionInfo } from "@/lib/shared/types";

export async function deleteSession(sessionId: string): Promise<void> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) {
    throw new Error("Session not found");
  }

  // Read header before deleting to get parentSession path
  const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
  let parentSessionPath: string | undefined;
  try {
    const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
    if (header.type === "session") parentSessionPath = header.parentSession;
  } catch { /* ignore */ }

  // Re-attach all direct children to this session's parent (cascade re-parent)
  const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== filePath);
    for (const file of files) {
      const childPath = join(dir, file);
      try {
        const content = readFileSync(childPath, "utf8");
        const lines = content.split("\n");
        const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
        if (header.type === "session" && header.parentSession === filePath) {
          header.parentSession = parentSessionPath;
          lines[0] = JSON.stringify(header);
          writeFileSync(childPath, lines.join("\n"));
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* skip if dir unreadable */ }

  getRpcSession(sessionId)?.destroy();
  unlinkSync(filePath);
  invalidateSessionPathCache(sessionId);
}

export async function archiveSession(sessionId: string): Promise<void> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) {
    throw new Error("Session not found");
  }

  const dir = dirname(filePath);
  const archiveDir = join(dir, "archive");
  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
  }

  const destPath = join(archiveDir, basename(filePath));
  getRpcSession(sessionId)?.destroy();
  renameSync(filePath, destPath);
  invalidateSessionPathCache(sessionId);
}

function findArchivedSessionFile(sessionId: string): string | null {
  const sessionsDir = getSessionsDir();
  try {
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(sessionsDir, e.name));
    for (const dir of dirs) {
      const archiveDir = join(dir, "archive");
      if (!existsSync(archiveDir)) continue;
      const files = readdirSync(archiveDir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files) {
        const filePath = join(archiveDir, file);
        try {
          const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
          const header = JSON.parse(firstLine) as { type?: string; id?: string };
          if (header.type === "session" && header.id === sessionId) {
            return filePath;
          }
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* ignore */ }
  return null;
}

export async function unarchiveSession(sessionId: string): Promise<void> {
  const filePath = findArchivedSessionFile(sessionId);
  if (!filePath) {
    throw new Error("Archived session not found");
  }

  const dir = dirname(filePath); // .../archive
  const parentDir = dirname(dir); // original session dir
  const destPath = join(parentDir, basename(filePath));
  renameSync(filePath, destPath);
}

export function listArchivedSessions(): SessionInfo[] {
  const sessionsDir = getSessionsDir();
  const sessions: SessionInfo[] = [];
  try {
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(sessionsDir, e.name));
    for (const dir of dirs) {
      const archiveDir = join(dir, "archive");
      if (!existsSync(archiveDir)) continue;
      const files = readdirSync(archiveDir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files) {
        const filePath = join(archiveDir, file);
        try {
          const stat = existsSync(filePath) ? statSync(filePath) : undefined;
          const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
          const header = JSON.parse(firstLine) as { type?: string; id?: string; timestamp?: string; cwd?: string; parentSession?: string };
          if (header.type !== "session" || !header.id) continue;

          // Parse basic info from header; messageCount/firstMessage not available without full scan
          sessions.push({
            path: filePath,
            id: header.id,
            cwd: header.cwd ?? "",
            name: undefined,
            created: header.timestamp ?? new Date(0).toISOString(),
            modified: stat?.mtime.toISOString() ?? header.timestamp ?? new Date(0).toISOString(),
            messageCount: 0,
            firstMessage: "(archived)",
            parentSessionId: undefined,
          });
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* ignore */ }
  return sessions.sort((a, b) => b.modified.localeCompare(a.modified));
}

