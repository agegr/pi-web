/**
 * Centralized globalThis state for the subagent dispatch subsystem.
 *
 * Consolidates per-parent active-dispatch tracking into a single typed
 * registry on globalThis.  Hot-reload safe: globalThis survives Next.js
 * Turbopack HMR; plain module-level Maps would be recreated on every reload.
 *
 * The upstream runtime (subagent-runtime.ts) owns its own globalThis slots
 * (__piSubagentRuns, __piSubagentQueue).  This module only manages the
 * dispatch-level bookkeeping needed by the dispatch API (G1) and the
 * concurrency cap (G5, deferred to a later slice).
 */

// ---------------------------------------------------------------------------
// Registry type
// ---------------------------------------------------------------------------

interface SubagentDispatchState {
  /** dispatch-id → parent-session-id (active dispatches for concurrency tracking). */
  active: Map<string, string>;
}

declare global {
  var __piSubagentDispatchState: SubagentDispatchState | undefined;
  var __piDispatchActive: Map<string, string> | undefined;
}

// ---------------------------------------------------------------------------
// Registry access
// ---------------------------------------------------------------------------

function ensureRegistry(): SubagentDispatchState {
  if (!globalThis.__piSubagentDispatchState) {
    globalThis.__piSubagentDispatchState = { active: new Map() };
  }
  return globalThis.__piSubagentDispatchState;
}

/**
 * Active dispatches keyed by dispatch-id (value = parent-session-id).
 *
 * Backward-compatible: if the legacy __piDispatchActive globalThis property
 * exists (set directly by tests), it is used in place of the registry slot.
 */
export function getActiveDispatches(): Map<string, string> {
  if (!globalThis.__piDispatchActive) {
    globalThis.__piDispatchActive = ensureRegistry().active;
  }
  return globalThis.__piDispatchActive;
}
