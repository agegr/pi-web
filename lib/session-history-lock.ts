// Kept outside rpc-manager so read-only session routes can share the guard.
const state = globalThis as typeof globalThis & { __piHistoryEdits?: Set<string> };
export function sessionHistoryLocks(): Set<string> {
  return state.__piHistoryEdits ??= new Set();
}

export function assertSessionHistoryAvailable(sessionId: string): void {
  if (sessionHistoryLocks().has(sessionId)) throw new Error("Session history is being updated; try again shortly");
}
