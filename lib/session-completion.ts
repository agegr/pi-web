/** Notification state is separate from a wrapper's own running/idle state. */
export interface SessionCompletionState {
  pending: boolean;
  cancelled: boolean;
  completionId?: string;
}

declare global {
  var __piSessionCompletions: Map<string, SessionCompletionState> | undefined;
  var __piLastCompletionId: number | undefined;
}

/** Survives a root wrapper being reaped while a long-running descendant is still active. */
export function sessionCompletionState(sessionId: string): SessionCompletionState {
  const states = globalThis.__piSessionCompletions ??= new Map();
  let state = states.get(sessionId);
  if (!state) {
    state = { pending: false, cancelled: false };
    states.set(sessionId, state);
  }
  return state;
}

export function forgetSessionCompletion(sessionId: string): void {
  globalThis.__piSessionCompletions?.delete(sessionId);
}

/** Numeric, monotonically increasing IDs let clients ignore late, older snapshots. */
export function nextCompletionId(): string {
  const id = Math.max(Date.now(), (globalThis.__piLastCompletionId ?? 0) + 1);
  globalThis.__piLastCompletionId = id;
  return String(id);
}
