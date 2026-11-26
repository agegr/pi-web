import { getLiveRpcSession } from "./rpc-manager";
import { readSessionEntry, resolveSessionPath } from "./session-reader";
import type { SessionEntry } from "./types";

/**
 * One entry of a session by id, as the deferred thinking and tool-result image routes read it.
 * An open session answers from its wrapper's in-memory `SessionManager`, as the session and
 * context routes read it. An entry the wrapper does not hold (another pi process appended it)
 * falls back to the file. Null when there is no such session.
 */
export async function readSessionEntryById(
  sessionId: string,
  entryId: string,
): Promise<{ entry: SessionEntry | undefined } | null> {
  const live = getLiveRpcSession(sessionId);
  const liveEntry = live?.inner.sessionManager.getEntry(entryId);
  if (liveEntry) return { entry: liveEntry as unknown as SessionEntry };

  const filePath = live?.sessionFile || await resolveSessionPath(sessionId);
  if (!filePath) return live ? { entry: undefined } : null;
  return { entry: await readSessionEntry(filePath, entryId) };
}
