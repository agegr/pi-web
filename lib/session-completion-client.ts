/** IDs are process-global, monotonically increasing decimal numbers from the server. */
type CompletionHistory = { observed: boolean; latestObserved: number; latestNotified: number };

/** Client-local state; never shared between browsers or hook instances. */
export class SessionCompletionTracker {
  private histories = new Map<string, CompletionHistory>();

  private observe(sessionId: string, completionId: unknown, live: boolean): boolean {
    const history = this.histories.get(sessionId) ?? { observed: false, latestObserved: 0, latestNotified: 0 };
    const wasObserved = history.observed;
    history.observed = true;
    this.histories.set(sessionId, history);
    // Missing IDs do not erase history when a wrapper is reaped or restarted.
    if (typeof completionId !== "string" || !/^\d+$/.test(completionId)) return false;
    const id = Number(completionId);
    if (!Number.isSafeInteger(id) || id <= 0 || id < history.latestObserved) return false;
    const newer = id > history.latestObserved;
    history.latestObserved = id;
    // The first HTTP/connected snapshot is silent history, not a notification.
    // A genuine live event (never replayed by the server) may equal that initial
    // snapshot: the transports can race. Announce it once, but never older IDs.
    const notify = id > history.latestNotified && (live || (newer && wasObserved));
    if (notify) history.latestNotified = id;
    return notify;
  }

  connected(sessionId: string, completionId: unknown): boolean {
    return this.observe(sessionId, completionId, false);
  }

  snapshot(sessionId: string, completionId: unknown): boolean {
    return this.observe(sessionId, completionId, false);
  }

  complete(sessionId: string, completionId: unknown): boolean {
    return this.observe(sessionId, completionId, true);
  }
}

/** The sidebar's first successful poll is a baseline for the entire registry. */
export class BackgroundCompletionTracker {
  private initialized = false;
  private consumed = new Map<string, number>();
  private pending = new Map<string, number>();

  /** A supplied set confirms only those IDs; the rest wait for a fresh catalogue. */
  poll(completionIds: Record<string, string>, confirmedIds?: ReadonlySet<string>): string[] {
    for (const [sessionId, completionId] of Object.entries(completionIds)) {
      const id = Number(completionId);
      if (!Number.isSafeInteger(id) || id <= 0
        || id <= (this.consumed.get(sessionId) ?? 0)
        || id <= (this.pending.get(sessionId) ?? 0)) continue;
      this.pending.set(sessionId, id);
    }
    const completed: string[] = [];
    for (const [sessionId, id] of this.pending) {
      // The first poll is history even when the catalogue has not loaded yet.
      if (this.initialized && confirmedIds && !confirmedIds.has(sessionId)) continue;
      this.consumed.set(sessionId, id);
      this.pending.delete(sessionId);
      if (this.initialized) completed.push(sessionId);
    }
    this.initialized = true;
    // Missing wrappers do not erase either consumed or unresolved completions.
    return completed;
  }

  needsCatalogue(knownIds: ReadonlySet<string>): boolean {
    return [...this.pending.keys()].some((id) => !knownIds.has(id));
  }
}

/** Only catalogue-confirmed, unselected main sessions may alert. */
export function backgroundCompletionSessions(
  completed: readonly string[],
  sessions: readonly { id: string; relation?: { kind: string } }[],
  selectedSessionId: string | null,
): string[] {
  const eligible = new Set(sessions.filter((s) => s.relation?.kind !== "subagent").map((s) => s.id));
  return completed.filter((id) => id !== selectedSessionId && eligible.has(id));
}
