// Shared trajectory sidecar contract: types are used by the recorder, the
// projection API and the browser views. No filesystem or React code here.

export type TrajectoryDetailLevel = "summary" | "full";

export type TrajectoryRecordKind =
  | "session_start"
  | "turn_start"
  | "turn_end"
  | "request_start"
  | "request_first_token"
  | "request_end"
  | "tool_start"
  | "tool_end"
  | "retry_start"
  | "retry_end"
  | "compaction_start"
  | "compaction_end"
  | "subagent_link"
  | "error";

export type TrajectoryStatus = "running" | "complete" | "aborted" | "error";

export interface TrajectoryHeader {
  schemaVersion: 1;
  type: "header";
  sessionId: string;
  createdAt: number;
}

/** Append-only sidecar record as written by the recorder. */
export interface TrajectoryRecord {
  schemaVersion: 1;
  type: "record";
  sequence: number;
  id: string;
  kind: TrajectoryRecordKind;
  timestamp: number;
  endTimestamp?: number;
  status?: TrajectoryStatus;
  leafId?: string | null;
  turnId?: string;
  requestId?: string;
  stepId?: string;
  data?: Record<string, unknown>;
}

export interface TrajectoryReadResult {
  header: TrajectoryHeader | null;
  records: TrajectoryRecord[];
  warnings: string[];
  incompleteTail: boolean;
}

// ============================================================================
// API projections (what the browser sees)
// ============================================================================

export interface TrajectoryTokenStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface TrajectoryStats {
  requests: number;
  tools: number;
  turns: number;
  tokens: TrajectoryTokenStats;
  totalActiveMs: number;
  compactions: number;
  retries: number;
  subagents: number;
  errors: number;
}

export interface TrajectoryTurn {
  id: string;
  startTimestamp: number;
  endTimestamp?: number;
  status: TrajectoryStatus;
  requestCount: number;
  toolCount: number;
  summary?: string;
}

export interface TrajectoryRequest {
  id: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  startTimestamp: number;
  firstTokenTimestamp?: number;
  endTimestamp?: number;
  status: TrajectoryStatus;
  ttftMs?: number;
  durationMs?: number;
  usage?: TrajectoryTokenStats;
  error?: string;
}

/** API-visible record row; payload is bounded and redacted by detail level. */
export interface TrajectoryRecordView {
  sequence: number;
  id: string;
  kind: TrajectoryRecordKind;
  timestamp: number;
  endTimestamp?: number;
  status: TrajectoryStatus;
  turnId?: string;
  requestId?: string;
  stepId?: string;
  /** Child session id for subagent_link records; visible even in summary mode. */
  childSessionId?: string;
  summary: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export interface TrajectoryResponse {
  schemaVersion: 1;
  detailLevel: TrajectoryDetailLevel;
  session: { id: string; leafId: string | null; supported: true };
  stats: TrajectoryStats;
  turns: TrajectoryTurn[];
  requests: TrajectoryRequest[];
  records: TrajectoryRecordView[];
  warnings: string[];
}

export interface TrajectoryUnsupportedResponse {
  schemaVersion: 1;
  detailLevel: "summary";
  code: "trajectory_unsupported";
  session: { id: string; supported: false; reason: "no_sidecar" | "missing_session" };
}
