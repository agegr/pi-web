import { generateSessionTitle } from "./session-title";
import { isAutoSessionTitleEnabled } from "./auto-title-settings";
import { invalidateSessionListCache } from "./session-reader";
import type { AgentSessionWrapper } from "./rpc-manager";
import type { AgentSessionLike } from "./pi-types";

declare global {
  var __piTitleGenerationLocks: Set<string> | undefined;
}

/**
 * Session ids with a title generation currently in flight. Shared (via
 * globalThis so it survives Next.js hot reload) between the automatic
 * post-run hook and the manual /auto-name route so the two can never run
 * concurrent shadow agents against the same session.
 */
function getTitleGenerationLocks(): Set<string> {
  if (!globalThis.__piTitleGenerationLocks) {
    globalThis.__piTitleGenerationLocks = new Set<string>();
  }
  return globalThis.__piTitleGenerationLocks;
}

export function isTitleGenerationInFlight(sessionId: string): boolean {
  return getTitleGenerationLocks().has(sessionId);
}

/** Returns a release function, or null when a generation is already running. */
export function acquireTitleGenerationLock(sessionId: string): (() => void) | null {
  const locks = getTitleGenerationLocks();
  if (locks.has(sessionId)) return null;
  locks.add(sessionId);
  return () => locks.delete(sessionId);
}

/**
 * Generate and persist a session title after an agent run settles, when the
 * session has no name yet. Sessions the user (or a previous automatic run)
 * already named are never touched, so this succeeds at most once per session;
 * a failed attempt simply retries on the next run end.
 */
export async function maybeAutoTitleSession(
  session: AgentSessionWrapper,
  generate: (source: AgentSessionLike) => Promise<{ title: string }> = (source) =>
    generateSessionTitle(source as unknown as Parameters<typeof generateSessionTitle>[0]),
  isEnabled: () => boolean = isAutoSessionTitleEnabled,
): Promise<string | null> {
  if (!session.isAlive()) return null;
  if (!isEnabled()) return null;
  const sessionId = session.sessionId;
  if (session.inner.sessionManager.getSessionName()) return null;

  const release = acquireTitleGenerationLock(sessionId);
  if (!release) return null;

  try {
    const result = await generate(session.inner);
    if (!session.isAlive()) return null;
    session.inner.setSessionName(result.title);
    invalidateSessionListCache();
    session.emitSessionNamed(result.title);
    return result.title;
  } finally {
    release();
  }
}
