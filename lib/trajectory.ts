import type { SessionEntry } from "./types";
import { PI_WEB_TIMING_CUSTOM_TYPE } from "./session-timing";

/**
 * One line of the trajectory ledger.
 *
 * Rows map 1:1 to session entries of the active branch, so the ledger never
 * invents or merges events: what Pi appended is what the table shows. Timing
 * is the same anchor chain `computeSessionTiming()` uses, so a row's duration
 * is the wall-clock that ended at that entry.
 */
export interface TrajectoryRow {
  id: string;
  parentId: string | null;
  kind: "user" | "assistant" | "tool" | "compaction" | "branch_summary" | "custom_message" | "other";
  turnIndex: number;
  timestamp: number;
  /** Anchor this row's duration is measured from. */
  startedAt: number;
  durationMs: number;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  toolCallCount?: number;
  isError?: boolean;
  args?: string;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost?: number;
  model?: string;
  provider?: string;
  stopReason?: string;
  /** Live TTFT/decode sample joined by assistant message timestamp. */
  timing?: TrajectoryTiming;
}

export interface TrajectoryTiming {
  ttftMs: number | null;
  decodeMs: number;
  outputTokens: number;
}

export interface TrajectoryTurn {
  index: number;
  startedAt: number;
  label: string;
  modelMs: number;
  toolMs: number;
  rows: TrajectoryRow[];
}

export interface TrajectoryView {
  rows: TrajectoryRow[];
  turns: TrajectoryTurn[];
  /** Every assistant row is a model request; coverage explains missing TTFT. */
  coverage: { assistantRows: number; timedRows: number };
  /** Live samples that matched no assistant row on this branch. */
  unmatchedTiming: number;
  /** Full-branch extent, so the time axis stays stable while paging. */
  span: { start: number; end: number };
}

/** Bounds so a 1000-row session cannot turn the response into a payload bomb. */
export const MAX_ROW_TEXT = 600;
export const MAX_ROW_ARGS = 1200;
export const MAX_TURN_LABEL = 80;
/** Default page size for the ledger; matches the chat's own history page size. */
export const DEFAULT_TRAJECTORY_PAGE = 200;
export const MAX_TRAJECTORY_PAGE = 2000;

interface TrajectoryEntry extends Omit<SessionEntry, "type" | "message" | "data"> {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      cost?: { total?: number };
    };
    model?: string;
    provider?: string;
    stopReason?: string;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    timestamp?: number;
  };
  customType?: string;
  data?: unknown;
}

/**
 * Build the trajectory ledger from one branch's entries.
 *
 * `entries` must already be the branch chain in append order (see
 * `sliceActiveBranch`), because `parentId` chains across branches would
 * otherwise interleave unrelated work.
 */
export function buildTrajectory(entries: readonly TrajectoryEntry[]): TrajectoryView {
  const liveSamples = collectLiveSamples(entries);
  const rows: TrajectoryRow[] = [];
  const turns: TrajectoryTurn[] = [];

  let previousTimestamp: number | undefined;
  let currentTurn: TrajectoryTurn | null = null;
  let timedRows = 0;
  let assistantRows = 0;

  for (const entry of entries) {
    // Instrumentation is not agent activity: it must not open a turn, move the
    // anchor, or appear as a row. It only feeds the join table above.
    if (entry.type === "custom") continue;

    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;

    const role = entry.type === "message" ? entry.message?.role : undefined;

    if (role === "user") {
      currentTurn = {
        index: turns.length,
        startedAt: timestamp,
        label: turnLabel(entry),
        modelMs: 0,
        toolMs: 0,
        rows: [],
      };
      turns.push(currentTurn);
      previousTimestamp = timestamp;
      const userRow = buildRow(entry, "user", currentTurn.index, timestamp, timestamp, 0);
      rows.push(userRow);
      currentTurn.rows.push(userRow);
      continue;
    }

    // A session can start mid-turn (branched, compacted); keep the rows visible
    // under a synthetic turn instead of dropping them.
    if (!currentTurn) {
      currentTurn = { index: turns.length, startedAt: timestamp, label: "", modelMs: 0, toolMs: 0, rows: [] };
      turns.push(currentTurn);
    }

    if (!isClockEntry(entry.type)) continue;

    const isBoundary = role === "bashExecution";
    const durationMs = !isBoundary && previousTimestamp !== undefined && timestamp > previousTimestamp
      ? timestamp - previousTimestamp
      : 0;
    const startedAt = isBoundary ? timestamp : (previousTimestamp ?? timestamp);
    previousTimestamp = timestamp;

    const kind = rowKind(entry, role);
    const row = buildRow(entry, kind, currentTurn.index, timestamp, startedAt, durationMs);

    if (kind === "assistant") {
      assistantRows += 1;
      const key = entry.message?.timestamp;
      const sample = typeof key === "number" ? liveSamples.get(key) : undefined;
      if (sample) {
        row.timing = sample;
        timedRows += 1;
      }
      currentTurn.modelMs += durationMs;
    } else if (kind === "tool") {
      currentTurn.toolMs += durationMs;
    } else if (kind === "compaction" || kind === "branch_summary") {
      currentTurn.modelMs += durationMs;
    }

    rows.push(row);
    currentTurn.rows.push(row);
  }

  return {
    rows,
    turns,
    coverage: { assistantRows, timedRows },
    unmatchedTiming: liveSamples.size - timedRows,
    span: spanOf(rows),
  };
}

function spanOf(rows: readonly TrajectoryRow[]): { start: number; end: number } {
  if (rows.length === 0) return { start: 0, end: 0 };
  let start = rows[0].startedAt;
  let end = rows[0].timestamp;
  for (const row of rows) {
    if (row.startedAt < start) start = row.startedAt;
    if (row.timestamp > end) end = row.timestamp;
  }
  return { start, end };
}

function collectLiveSamples(entries: readonly TrajectoryEntry[]): Map<number, TrajectoryTiming> {
  const samples = new Map<number, TrajectoryTiming>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== PI_WEB_TIMING_CUSTOM_TYPE) continue;
    const data = entry.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
    const record = data as Record<string, unknown>;
    const key = record.messageTimestamp;
    if (typeof key !== "number" || !Number.isFinite(key)) continue;
    const decodeMs = nonNegative(record.decodeMs) ?? 0;
    const outputTokens = nonNegative(record.outputTokens) ?? 0;
    samples.set(key, {
      ttftMs: nonNegativeOrNull(record.ttftMs),
      decodeMs,
      outputTokens,
    });
  }
  return samples;
}

function rowKind(entry: TrajectoryEntry, role: string | undefined): TrajectoryRow["kind"] {
  if (role === "assistant") return "assistant";
  if (role === "toolResult") return "tool";
  if (role === "user") return "user";
  if (entry.type === "compaction") return "compaction";
  if (entry.type === "branch_summary") return "branch_summary";
  if (entry.type === "custom_message") return "custom_message";
  return "other";
}

function buildRow(
  entry: TrajectoryEntry,
  kind: TrajectoryRow["kind"],
  turnIndex: number,
  timestamp: number,
  startedAt: number,
  durationMs: number,
): TrajectoryRow {
  const message = entry.message;
  const row: TrajectoryRow = {
    id: entry.id,
    parentId: entry.parentId ?? null,
    kind,
    turnIndex,
    timestamp,
    startedAt,
    durationMs,
  };

  if (message) {
    const usage = message.usage;
    if (usage) {
      const input = nonNegative(usage.input) ?? 0;
      const output = nonNegative(usage.output) ?? 0;
      const cacheRead = nonNegative(usage.cacheRead) ?? 0;
      const cacheWrite = nonNegative(usage.cacheWrite) ?? 0;
      row.tokens = { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
      row.cost = nonNegative(usage.cost?.total) ?? 0;
    }
    if (typeof message.model === "string") row.model = message.model;
    if (typeof message.provider === "string") row.provider = message.provider;
    if (typeof message.stopReason === "string") row.stopReason = message.stopReason;
  }

  if (kind === "tool") {
    if (typeof message?.toolName === "string") row.toolName = message.toolName;
    if (typeof message?.toolCallId === "string") row.toolCallId = message.toolCallId;
    row.isError = message?.isError === true;
    row.text = contentText(message?.content);
    return row;
  }

  if (kind === "compaction" || kind === "branch_summary") {
    const summary = (entry as { summary?: unknown }).summary;
    row.text = contentText(summary);
    return row;
  }

  if (kind === "custom_message") {
    row.text = contentText((entry as { content?: unknown }).content);
    return row;
  }

  if (kind === "assistant") {
    const blocks = Array.isArray(message?.content) ? message.content : [];
    const toolCalls = blocks.filter(isToolCallBlock);
    row.toolCallCount = toolCalls.length;
    row.text = contentText(message?.content);
    if (toolCalls.length > 0) {
      row.args = boundedJson(toolCalls.map((call) => ({ name: call.name, arguments: call.arguments })));
    }
    return row;
  }

  row.text = contentText(message?.content ?? (entry as { content?: unknown }).content);
  return row;
}

function isToolCallBlock(value: unknown): value is { type: "toolCall"; name?: string; arguments?: unknown } {
  return typeof value === "object" && value !== null
    && (value as { type?: unknown }).type === "toolCall";
}

function contentText(content: unknown): string {
  if (typeof content === "string") return truncate(content);
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (typeof block !== "object" || block === null) continue;
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
    else if (record.type === "thinking" && typeof record.thinking === "string") parts.push(record.thinking);
    else if (record.type === "image") parts.push("[image]");
  }
  return truncate(parts.join("\n").trim());
}

function boundedJson(value: unknown): string {
  try {
    return truncate(JSON.stringify(value, null, 1), MAX_ROW_ARGS);
  } catch {
    return "";
  }
}

function truncate(value: string, limit = MAX_ROW_TEXT): string {
  const normalized = value.trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function turnLabel(entry: TrajectoryEntry): string {
  const text = contentText(entry.message?.content).replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > MAX_TURN_LABEL ? `${text.slice(0, MAX_TURN_LABEL)}…` : text;
}

function nonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeOrNull(value: unknown): number | null {
  return nonNegative(value);
}

function isClockEntry(type: string): boolean {
  return type === "message"
    || type === "compaction"
    || type === "branch_summary"
    || type === "custom_message";
}

/**
 * Slice the flat ledger for paged display.
 *
 * `before` is a row id the client already has; the page ends just before it so
 * prepending never duplicates that row.
 */
export function pageTrajectoryRows(
  rows: readonly TrajectoryRow[],
  options: { tail?: number; before?: string } = {},
): { rows: TrajectoryRow[]; hasMore: boolean; oldestRowId: string | null } {
  const tail = options.tail && options.tail > 0 ? options.tail : rows.length;
  let end = rows.length;
  if (options.before) {
    const index = rows.findIndex((row) => row.id === options.before);
    if (index >= 0) end = index;
  }
  const start = Math.max(0, end - tail);
  const sliced = rows.slice(start, end);
  return {
    rows: sliced,
    hasMore: start > 0,
    oldestRowId: sliced[0]?.id ?? null,
  };
}

/**
 * A windowed view for the response: rows are paged, turn headers keep their
 * full-turn totals, and a clipped turn is flagged so the UI can say so instead
 * of implying the turn ended where the page did.
 */
export interface TrajectoryWindow {
  rows: TrajectoryRow[];
  turns: Array<TrajectoryTurn & { partial: boolean }>;
  hasMore: boolean;
  oldestRowId: string | null;
}

export function windowTrajectory(
  view: TrajectoryView,
  options: { tail?: number; before?: string } = {},
): TrajectoryWindow {
  const page = pageTrajectoryRows(view.rows, options);
  const visible = new Set(page.rows.map((row) => row.id));
  const turns = view.turns
    .map((turn) => ({
      ...turn,
      rows: turn.rows.filter((row) => visible.has(row.id)),
      partial: turn.rows.some((row) => !visible.has(row.id)),
    }))
    .filter((turn) => turn.rows.length > 0);
  return {
    rows: page.rows,
    turns,
    hasMore: page.hasMore,
    oldestRowId: page.oldestRowId,
  };
}
