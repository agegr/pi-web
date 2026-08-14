// Project sidecar records into the browser-facing trajectory response,
// filtered to the currently selected Pi branch.

import { fullPayload } from "./trajectory-privacy";
import type {
  TrajectoryDetailLevel,
  TrajectoryReadResult,
  TrajectoryRecord,
  TrajectoryRecordView,
  TrajectoryRequest,
  TrajectoryResponse,
  TrajectoryStats,
  TrajectoryStatus,
  TrajectoryTokenStats,
  TrajectoryTurn,
} from "./trajectory-types";

export interface ProjectionOptions {
  leafId: string | null;
  detailLevel: TrajectoryDetailLevel;
  branchEntryIds: ReadonlySet<string>;
  cursor?: number;
}

const EMPTY_TOKENS: TrajectoryTokenStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function count(records: TrajectoryRecord[], kind: TrajectoryRecord["kind"]): number {
  return records.filter((r) => r.kind === kind).length;
}

function toView(record: TrajectoryRecord, detailLevel: TrajectoryDetailLevel): TrajectoryRecordView {
  const data = record.data;
  const summary = typeof data?.summary === "string" ? data.summary : record.kind;
  const view: TrajectoryRecordView = {
    sequence: record.sequence,
    id: record.id,
    kind: record.kind,
    timestamp: record.timestamp,
    status: record.status ?? "running",
    summary,
  };
  if (record.endTimestamp !== undefined) {
    view.endTimestamp = record.endTimestamp;
    view.durationMs = record.endTimestamp - record.timestamp;
  }
  if (record.turnId) view.turnId = record.turnId;
  if (record.requestId) view.requestId = record.requestId;
  if (record.stepId) view.stepId = record.stepId;
  if (detailLevel === "full" && data) view.data = fullPayload(data);
  return view;
}

function buildRequests(
  records: TrajectoryRecord[],
): Array<{ sequence: number; request: TrajectoryRequest }> {
  const firstTokenByRequest = new Map<string, TrajectoryRecord>();
  const endByRequest = new Map<string, TrajectoryRecord>();
  for (const r of records) {
    if (r.kind === "request_first_token" && r.requestId) firstTokenByRequest.set(r.requestId, r);
    if (r.kind === "request_end" && r.requestId) endByRequest.set(r.requestId, r);
  }
  return records
    .filter((r) => r.kind === "request_start")
    .map((start) => {
      const firstToken = firstTokenByRequest.get(start.requestId ?? "");
      const end = endByRequest.get(start.requestId ?? "");
      const usage = end?.data?.usage as TrajectoryTokenStats | undefined;
      const request: TrajectoryRequest = {
        id: start.requestId ?? start.id,
        startTimestamp: start.timestamp,
        status: end?.status ?? "running",
      };
      if (typeof start.data?.model === "string") request.model = start.data.model;
      if (typeof start.data?.provider === "string") request.provider = start.data.provider;
      if (typeof start.data?.thinkingLevel === "string") request.thinkingLevel = start.data.thinkingLevel;
      if (firstToken) {
        request.firstTokenTimestamp = firstToken.timestamp;
        request.ttftMs = firstToken.timestamp - start.timestamp;
      }
      if (end) {
        request.endTimestamp = end.timestamp;
        request.durationMs = end.timestamp - start.timestamp;
      }
      if (usage) request.usage = usage;
      if (typeof end?.data?.error === "string") request.error = end.data.error;
      return { sequence: start.sequence, request };
    });
}

function buildTurns(
  records: TrajectoryRecord[],
): Array<{ sequence: number; turn: TrajectoryTurn }> {
  const endByTurn = new Map<string, TrajectoryRecord>();
  for (const r of records) {
    if (r.kind === "turn_end" && r.turnId) endByTurn.set(r.turnId, r);
  }
  const turns = records
    .filter((r) => r.kind === "turn_start" && r.turnId)
    .map((start) => {
      const end = endByTurn.get(start.turnId!);
      const turn: TrajectoryTurn = {
        id: start.turnId!,
        startTimestamp: start.timestamp,
        status: end?.status ?? "running",
        requestCount: 0,
        toolCount: 0,
      };
      if (end?.timestamp !== undefined) turn.endTimestamp = end.timestamp;
      if (typeof start.data?.summary === "string") turn.summary = start.data.summary;
      return { sequence: start.sequence, turn };
    });
  const byId = new Map(turns.map((t) => [t.turn.id, t.turn]));
  for (const r of records) {
    const turn = r.turnId ? byId.get(r.turnId) : undefined;
    if (!turn) continue;
    if (r.kind === "request_start") turn.requestCount += 1;
    if (r.kind === "tool_start") turn.toolCount += 1;
  }
  return turns;
}

function buildStats(
  records: TrajectoryRecord[],
  requests: TrajectoryRequest[],
  turns: TrajectoryTurn[],
): TrajectoryStats {
  const stats: TrajectoryStats = {
    requests: count(records, "request_start"),
    tools: count(records, "tool_start"),
    turns: turns.length,
    tokens: { ...EMPTY_TOKENS },
    cost: 0,
    totalActiveMs: 0,
    compactions: count(records, "compaction_start"),
    retries: count(records, "retry_start"),
    subagents: count(records, "subagent_link"),
    errors: count(records, "error") + requests.filter((r) => r.status === "error").length,
  };
  for (const request of requests) {
    if (request.usage) {
      stats.tokens.input += request.usage.input;
      stats.tokens.output += request.usage.output;
      stats.tokens.cacheRead += request.usage.cacheRead;
      stats.tokens.cacheWrite += request.usage.cacheWrite;
      stats.tokens.total += request.usage.total;
    }
    if (request.durationMs !== undefined) stats.totalActiveMs += request.durationMs;
  }
  return stats;
}

export function projectTrajectory(
  result: TrajectoryReadResult,
  options: ProjectionOptions,
): TrajectoryResponse {
  const cursor = options.cursor ?? 0;
  // Branch filtering and aggregate stats use the full branch record set;
  // cursor only trims the returned record list.
  const branchRecords = result.records.filter(
    (r) => r.leafId == null || options.branchEntryIds.has(r.leafId),
  );
  const records = branchRecords.filter((r) => r.sequence > cursor);

  const views = records.map((r) => toView(r, options.detailLevel));
  const allRequests = buildRequests(branchRecords);
  const allTurns = buildTurns(branchRecords);
  const stats = buildStats(
    branchRecords,
    allRequests.map((e) => e.request),
    allTurns.map((e) => e.turn),
  );
  const requestSequences = new Set(
    records.filter((r) => r.kind === "request_start").map((r) => r.sequence),
  );
  const turnSequences = new Set(
    records.filter((r) => r.kind === "turn_start").map((r) => r.sequence),
  );
  const requests = allRequests
    .filter((e) => requestSequences.has(e.sequence))
    .map((e) => e.request);
  const turns = allTurns
    .filter((e) => turnSequences.has(e.sequence))
    .map((e) => e.turn);

  return {
    schemaVersion: 1,
    detailLevel: options.detailLevel,
    session: {
      id: result.header?.sessionId ?? "",
      leafId: options.leafId,
      supported: true,
    },
    stats,
    turns,
    requests,
    records: views,
    warnings: [...result.warnings],
    hasOlderRecords: cursor > 0,
    nextCursor: null,
  };
}
