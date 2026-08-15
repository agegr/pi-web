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
  TrajectoryTokenStats,
  TrajectoryTurn,
} from "./trajectory-types";

export interface ProjectionOptions {
  leafId: string | null;
  detailLevel: TrajectoryDetailLevel;
  branchEntryIds: ReadonlySet<string>;
}

const EMPTY_TOKENS: TrajectoryTokenStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function count(records: TrajectoryRecord[], kind: TrajectoryRecord["kind"]): number {
  return records.filter((r) => r.kind === kind).length;
}

function inferMissingTurnIds(records: TrajectoryRecord[]): TrajectoryRecord[] {
  if (records.some((record) => record.kind === "turn_start" && record.turnId)) return records;
  let n = 0;
  let current: string | undefined;
  return records.map((record) => {
    if (record.kind === "request_start") current = `turn-${n++}`;
    if (!current || record.turnId) return record;
    return { ...record, turnId: current };
  });
}

function applySpan(start: TrajectoryRecordView, end: TrajectoryRecordView): void {
  const duration = end.timestamp - start.timestamp;
  if (duration < 0) return;
  start.endTimestamp = end.timestamp;
  start.durationMs = duration;
  start.status = end.status;
  end.durationMs = duration;
  end.endTimestamp = end.timestamp;
}

function pairByKey(
  views: TrajectoryRecordView[],
  startKind: TrajectoryRecordView["kind"],
  endKind: TrajectoryRecordView["kind"],
  key: "requestId" | "stepId" | "turnId",
): void {
  const starts = new Map<string, TrajectoryRecordView>();
  for (const view of views) {
    const id = view[key];
    if (view.kind === startKind && id) starts.set(id, view);
  }
  for (const view of views) {
    const id = view[key];
    if (view.kind !== endKind || !id) continue;
    const start = starts.get(id);
    if (start) applySpan(start, view);
  }
}

function pairSequential(
  views: TrajectoryRecordView[],
  startKind: TrajectoryRecordView["kind"],
  endKind: TrajectoryRecordView["kind"],
): void {
  const open: TrajectoryRecordView[] = [];
  for (const view of views) {
    if (view.kind === startKind) open.push(view);
    else if (view.kind === endKind && open.length > 0) applySpan(open.pop()!, view);
  }
}

function applyPairedTiming(views: TrajectoryRecordView[]): TrajectoryRecordView[] {
  pairByKey(views, "request_start", "request_end", "requestId");
  pairByKey(views, "tool_start", "tool_end", "stepId");
  pairByKey(views, "turn_start", "turn_end", "turnId");
  pairSequential(views, "retry_start", "retry_end");
  pairSequential(views, "compaction_start", "compaction_end");
  return views;
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
  if (record.kind === "subagent_link" && typeof data?.childSessionId === "string") {
    view.childSessionId = data.childSessionId;
  }
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
  countTurnMembers(records, turns.map((entry) => entry.turn));
  return turns;
}

function synthesizeTurns(
  records: TrajectoryRecord[],
): Array<{ sequence: number; turn: TrajectoryTurn }> {
  const first = new Map<string, TrajectoryRecord>();
  const last = new Map<string, TrajectoryRecord>();
  for (const record of records) {
    if (!record.turnId) continue;
    if (!first.has(record.turnId)) first.set(record.turnId, record);
    last.set(record.turnId, record);
  }
  const turns = [...first.entries()].map(([id, start]) => {
    const end = last.get(id);
    const turn: TrajectoryTurn = {
      id,
      startTimestamp: start.timestamp,
      status: end?.status ?? "running",
      requestCount: 0,
      toolCount: 0,
    };
    if (end && end !== start) turn.endTimestamp = end.timestamp;
    return { sequence: start.sequence, turn };
  });
  countTurnMembers(records, turns.map((entry) => entry.turn));
  return turns;
}

function countTurnMembers(records: TrajectoryRecord[], turns: TrajectoryTurn[]): void {
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  for (const record of records) {
    const turn = record.turnId ? byId.get(record.turnId) : undefined;
    if (!turn) continue;
    if (record.kind === "request_start") turn.requestCount += 1;
    if (record.kind === "tool_start") turn.toolCount += 1;
  }
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
  const records = inferMissingTurnIds(
    result.records.filter((r) => r.leafId == null || options.branchEntryIds.has(r.leafId)),
  );
  const views = applyPairedTiming(records.map((r) => toView(r, options.detailLevel)));
  const requests = buildRequests(records).map((entry) => entry.request);
  const fromStarts = buildTurns(records);
  const turns = (fromStarts.length > 0 ? fromStarts : synthesizeTurns(records)).map((entry) => entry.turn);
  const stats = buildStats(records, requests, turns);

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
  };
}
