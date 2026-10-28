import { SUBAGENT_META_TYPE, type SubagentRunInfo } from "./subagents";
import { readRegularFileText } from "./regular-file";

type Relation = Pick<SubagentRunInfo, "sessionId" | "parentSessionId">;
type ParentMetadata = { parentSessionId: string; parentSessionPath: string };

/** Decode only subagent metadata at the observation boundary, never a fork header. */
export function readSubagentFamilyMetadata(entries: Iterable<unknown>): ParentMetadata | undefined {
  for (const value of entries) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (entry.type !== "custom" || entry.customType !== SUBAGENT_META_TYPE) continue;
    if (!entry.data || typeof entry.data !== "object" || Array.isArray(entry.data)) return;
    const data = entry.data as Record<string, unknown>;
    if (data.version !== 1 || typeof data.parentSessionId !== "string" || typeof data.parentSessionPath !== "string") return;
    return { parentSessionId: data.parentSessionId, parentSessionPath: data.parentSessionPath };
  }
}

/** SDK SessionManager.open may migrate/rewrite old files; observation must remain read-only. */
export function readSubagentFamilyMetadataFile(path: string): ParentMetadata | undefined {
  const text = readRegularFileText(path);
  if (!text) return;
  const lines = text.split("\n");
  function* entries() {
    for (const line of lines) {
      try { yield JSON.parse(line) as unknown; } catch { /* Ignore partial/malformed JSONL lines. */ }
    }
  }
  return readSubagentFamilyMetadata(entries());
}

export type FamilySettledCallback = (sessionId: string, options?: { deliveryFailed?: boolean }) => void;
export interface SubagentFamilyToken {
  readonly relation: Relation;
  readonly background: boolean;
}

interface FamilyTracking {
  parents: Map<string, string>;
  active: Set<SubagentFamilyToken>;
  results: WeakMap<SubagentRunInfo, SubagentFamilyToken>;
}

declare global {
  var __piSubagentFamilyTracking: FamilyTracking | undefined;
  var __piSubagentConsumedResults: Map<string, string> | undefined;
}

function tracking(): FamilyTracking {
  return globalThis.__piSubagentFamilyTracking ??= {
    parents: new Map(), active: new Set(), results: new WeakMap(),
  };
}

function ancestors(relation: Relation, parents: ReadonlyMap<string, string>): string[] {
  const seen = new Set([relation.sessionId]);
  const ids: string[] = [];
  for (let id: string | undefined = relation.parentSessionId; id && !seen.has(id); id = parents.get(id)) {
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Keep completed intermediate edges only while some execution/delivery still needs them. */
function pruneParents(state: FamilyTracking): void {
  const needed = new Set<string>();
  for (const token of state.active) {
    needed.add(token.relation.sessionId);
    for (const id of ancestors(token.relation, state.parents)) needed.add(id);
  }
  for (const id of state.parents.keys()) if (!needed.has(id)) state.parents.delete(id);
}

function recheck(token: SubagentFamilyToken, callback?: FamilySettledCallback, deliveryFailed = false): void {
  const state = tracking();
  const affected = ancestors(token.relation, state.parents);
  pruneParents(state);
  // Never await the observer: the family includes this delivery, whose promise the parent awaits.
  for (const id of affected) {
    try {
      callback?.(id, deliveryFailed ? { deliveryFailed: true } : undefined);
    } catch (error) {
      console.error("[pi-web] failed to recheck subagent family completion:", error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Each dispatch gets its own token, independent of session id, timestamps and subsequent resumes.
 * Occupancy starts synchronously, before ancestry is read. Only metadata
 * parents supplied by the runtime are followed; a session header's ordinary fork is never used.
 */
export function beginSubagentFamilyRun(
  run: SubagentRunInfo,
  readParent: (sessionId: string) => string | undefined,
): SubagentFamilyToken {
  const state = tracking();
  const token = { relation: { sessionId: run.sessionId, parentSessionId: run.parentSessionId }, background: run.runInBackground };
  state.parents.set(run.sessionId, run.parentSessionId);
  state.active.add(token);
  state.results.set(run, token);
  rememberSubagentFamilyParents(token, readParent);
  return token;
}

export function rememberSubagentFamilyParents(
  token: SubagentFamilyToken,
  readParent: (sessionId: string) => string | undefined,
): void {
  const state = tracking();
  const seen = new Set([token.relation.sessionId]);
  for (let id = token.relation.parentSessionId; id && !seen.has(id);) {
    seen.add(id);
    try {
      const parentId = readParent(id);
      if (!parentId) break;
      state.parents.set(id, parentId);
      id = parentId;
    } catch (error) {
      // Observation must not change whether a delegated task can run.
      console.error("[pi-web] failed to read subagent ancestry:", error instanceof Error ? error.message : error);
      break;
    }
  }
}

export function settleSubagentFamilyRun(
  token: SubagentFamilyToken,
  result: SubagentRunInfo,
  callback?: FamilySettledCallback,
): void {
  const state = tracking();
  state.results.set(result, token);
  // Background occupancy transfers to notifyParent without any remove/add gap.
  if (!token.background) state.active.delete(token);
  recheck(token, callback);
}

export function beginSubagentFamilyNotification(
  run: SubagentRunInfo,
  readParent: (sessionId: string) => string | undefined,
): SubagentFamilyToken {
  const state = tracking();
  const token = state.results.get(run);
  if (token && state.active.has(token)) return token;
  // Also support notifications of persisted results, outside a live dispatch.
  return beginSubagentFamilyRun({ ...run, runInBackground: true }, readParent);
}

export function releaseSubagentFamilyNotification(
  token: SubagentFamilyToken,
  callback?: FamilySettledCallback,
  deliveryFailed = false,
): void {
  tracking().active.delete(token);
  recheck(token, callback, deliveryFailed);
}

/** Active legacy run-map entries are inputs, not retained terminal run records. */
export function hasUnsettledSubagentFamily(sessionId: string, runs: Iterable<Relation>): boolean {
  const state = tracking();
  const relations = [...runs, ...[...state.active].map((token) => token.relation)];
  const parents = new Map(state.parents);
  for (const run of relations) parents.set(run.sessionId, run.parentSessionId);
  return relations.some((run) => ancestors(run, parents).includes(sessionId));
}

type SubagentRunIdentity = Pick<SubagentRunInfo, "sessionId" | "completedAt">;

/**
 * Keep the existing consumed-result protocol: at most one completedAt per session, so a mark
 * left after a delivered run never swallows the next resume (#987). Unlike family tokens,
 * these marks are result-delivery semantics and are intentionally unchanged.
 */
function getConsumedSubagentResults(): Map<string, string> {
  // A hot reload can leave the pre-#987 Set on globalThis.
  if (!(globalThis.__piSubagentConsumedResults instanceof Map)) globalThis.__piSubagentConsumedResults = new Map();
  return globalThis.__piSubagentConsumedResults;
}

export function markResultConsumed(run: SubagentRunIdentity): void {
  // An interrupted result without completedAt never notifies.
  if (!run.completedAt) return;
  getConsumedSubagentResults().set(run.sessionId, run.completedAt);
}

export function takeResultConsumed(run: SubagentRunIdentity): boolean {
  const consumed = getConsumedSubagentResults();
  if (!run.completedAt || consumed.get(run.sessionId) !== run.completedAt) return false;
  consumed.delete(run.sessionId);
  return true;
}
