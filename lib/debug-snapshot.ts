import { AGENT_EVENT_HEARTBEAT_MS } from "./agent-event-wire";
import { countAgentEventStreams, listAgentEventStreams } from "./agent-event-stream";
import type {
  DebugEventStream,
  DebugParentNotification,
  DebugServerGlobal,
  DebugSessionDetail,
  DebugSessionSummary,
  DebugSnapshotResponse,
  DebugSubagentRun,
} from "./debug-types";
import { countFileWatches } from "./file-watch-registry";
import {
  getRpcSessionDebugSnapshots,
  getRpcSessionLifecycle,
  getRpcStartingSessionIds,
  SESSION_IDLE_TIMEOUT_MS,
  type RpcSessionDebugEntry,
} from "./rpc-manager";
import { listRegisteredSessionLivenessProviders, listSessionLivenessProviders } from "./session-liveness";
import { hasUnsettledSubagentRun, subagentDebugSnapshot } from "./subagent-runtime";
import { getTerminalStats } from "./terminal-manager";

// Each source on its own: one that throws reads as empty, so the panel always gets a well-formed
// answer. Not logged: the panel polls every two seconds.
function read<T>(source: () => T, fallback: T): T {
  try {
    return source();
  } catch {
    return fallback;
  }
}

const NO_TERMINALS: DebugServerGlobal["terminals"] = { count: 0, listeners: 0, detached: 0, exited: 0, nextCleanupAt: null };

/** Ids in the subagent run map: a subagent between its wrapper's close and its result entry. */
function subagentRunIds(): Set<string> {
  const runs = globalThis.__piSubagentRuns;
  return runs instanceof Map ? new Set(runs.keys()) : new Set();
}

// Field by field, so a row never carries more than the contract names.
function toEventStream(stream: DebugEventStream): DebugEventStream {
  const { holder, openedAt, connectedAt, lastWriteAt, droppedEvents, queuedBytes } = stream;
  return { holder, openedAt, connectedAt, lastWriteAt, droppedEvents, queuedBytes };
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
}

function buildDetail(
  sessionId: string,
  entry: RpcSessionDebugEntry | undefined,
  starting: readonly string[],
  streams: readonly (DebugEventStream & { sessionId: string })[],
): DebugSessionDetail {
  const subagents = read<{ runs: DebugSubagentRun[]; notifications: DebugParentNotification[] }>(
    () => subagentDebugSnapshot(sessionId),
    { runs: [], notifications: [] },
  );
  return {
    sessionId,
    wrapper: entry?.snapshot ?? null,
    lifecycle: read(() => getRpcSessionLifecycle(sessionId), null),
    starting: starting.includes(sessionId),
    // The only place extension code runs: each of this session's providers says whether it is active.
    providers: read(
      () => listSessionLivenessProviders({ sessionId, ...(entry?.sessionFile ? { sessionFile: entry.sessionFile } : {}) })
        ?.map(({ name, active, byFile }) => ({ name, active, byFile })) ?? null,
      null,
    ),
    eventStreams: streams.filter((stream) => stream.sessionId === sessionId).map(toEventStream),
    subagents: {
      active: read(() => hasUnsettledSubagentRun(sessionId), false),
      runs: subagents.runs,
      notifications: subagents.notifications,
    },
    mcp: entry ? read(() => entry.readMcp(), null) : null,
  };
}

/**
 * What `GET /api/agent/debug` answers (lib/debug-types.ts): the server's registries as counts,
 * states and times, with `sessionId`'s detail. Synchronous and read-only: it starts no wrapper,
 * opens no stream, moves no idle timer and never calls `send()`.
 * `sessions` holds every id with a wrapper or an event stream.
 */
export function buildDebugSnapshot(sessionId: string | null, now = Date.now()): DebugSnapshotResponse {
  const wrappers = read(() => getRpcSessionDebugSnapshots(), []);
  const starting = read(() => getRpcStartingSessionIds(), []);
  // Registered, not asked: a summary runs no extension code.
  const providers = read(() => listRegisteredSessionLivenessProviders(), null) ?? [];
  const streams = read(() => listAgentEventStreams(), []);
  const subagentIds = read(subagentRunIds, new Set<string>());

  const wrapperById = new Map<string, RpcSessionDebugEntry>();
  for (const entry of wrappers) {
    if (!wrapperById.has(entry.snapshot.sessionId)) wrapperById.set(entry.snapshot.sessionId, entry);
  }
  const streamsBySession = countBy(streams, (stream) => stream.sessionId);

  const ids = new Set<string>([
    ...wrapperById.keys(),
    ...streams.map((stream) => stream.sessionId),
  ]);
  const sessions: DebugSessionSummary[] = [...ids].map((id) => {
    const entry = wrapperById.get(id);
    const snapshot = entry?.snapshot;
    const sessionFile = entry?.sessionFile ?? null;
    return {
      sessionId: id,
      state: snapshot?.state ?? "none",
      running: snapshot?.run.running ?? false,
      awaitingInput: snapshot?.awaitingInput ?? false,
      subagent: snapshot?.subagent === true || subagentIds.has(id),
      eventStreams: streamsBySession.get(id) ?? 0,
      providers: providers.filter((provider) => provider.sessionId === id
        || (sessionFile !== null && provider.sessionFile === sessionFile)).length,
      nextIdleCheckAt: snapshot?.idle.nextCheckAt ?? null,
      forcedByStop: snapshot?.idle.forcedByStop ?? false,
      starts: read(() => getRpcSessionLifecycle(id)?.starts ?? 0, 0),
    };
  });

  const byHolder = new Map<string | null, number>();
  for (const stream of streams) byHolder.set(stream.holder, (byHolder.get(stream.holder) ?? 0) + 1);

  const server: DebugServerGlobal = {
    startedAt: Math.round(now - process.uptime() * 1000),
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    heartbeatMs: AGENT_EVENT_HEARTBEAT_MS,
    wrappers: {
      alive: wrappers.filter((entry) => entry.snapshot.state === "alive").length,
      closing: wrappers.filter((entry) => entry.snapshot.state === "closing").length,
      starting: starting.length,
    },
    eventStreams: {
      // The closer registry also counts streams opened before a hot reload of the stream module.
      total: read(() => countAgentEventStreams(), streams.length),
      byHolder: [...byHolder].map(([holder, count]) => ({ holder, count })),
    },
    fileWatches: read(() => countFileWatches(), 0),
    terminals: read(() => getTerminalStats(now), NO_TERMINALS),
  };

  return {
    now,
    server,
    sessions,
    session: sessionId === null
      ? null
      : buildDetail(sessionId, wrapperById.get(sessionId), starting, streams),
  };
}
