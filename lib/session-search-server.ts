import { statSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  createSessionSearchDocuments,
  searchSessionDocuments,
  type GlobalSessionSearchHit,
  type SessionSearchDocument,
} from "./session-search";
import { buildSessionContext, listAllSessions } from "./session-reader";
import type { SessionEntry, SessionInfo } from "./types";

interface CachedSessionSearchIndex {
  mtimeMs: number;
  size: number;
  documents: SessionSearchDocument[];
}

declare global {
  var __piSessionSearchIndex: Map<string, CachedSessionSearchIndex> | undefined;
}

function cache(): Map<string, CachedSessionSearchIndex> {
  if (!globalThis.__piSessionSearchIndex) globalThis.__piSessionSearchIndex = new Map();
  return globalThis.__piSessionSearchIndex;
}

function documentsForSession(session: SessionInfo): SessionSearchDocument[] {
  const stats = statSync(session.path);
  const cached = cache().get(session.path);
  if (cached?.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.documents;

  const manager = SessionManager.open(session.path);
  const context = buildSessionContext(
    manager.getEntries() as unknown as SessionEntry[],
    manager.getLeafId(),
    { deferThinking: true, deferToolResultImages: true },
  );
  const documents = createSessionSearchDocuments(context.messages, context.entryIds);
  cache().set(session.path, { mtimeMs: stats.mtimeMs, size: stats.size, documents });
  return documents;
}

/** Search saved sessions newest-first, re-indexing only JSONL files that changed. */
export async function searchAllSessions(
  query: string,
  limit = 50,
): Promise<{ results: GlobalSessionSearchHit[]; hasMore: boolean }> {
  const sessions = await listAllSessions();
  const livePaths = new Set(sessions.filter((session) => !session.transient).map((session) => session.path));
  for (const path of cache().keys()) {
    if (!livePaths.has(path)) cache().delete(path);
  }

  const results: GlobalSessionSearchHit[] = [];
  for (const session of sessions) {
    if (session.transient || !session.path) continue;
    try {
      const matches = searchSessionDocuments(
        documentsForSession(session),
        query,
        limit - results.length + 1,
      );
      for (const match of matches) {
        results.push({ sessionId: session.id, ...match });
        if (results.length > limit) {
          return { results: results.slice(0, limit), hasMore: true };
        }
      }
    } catch {
      // A session may be deleted or mid-write while the search walks the list.
      // Skip that file; the next query retries it from its new metadata.
    }
  }
  return { results, hasMore: false };
}
