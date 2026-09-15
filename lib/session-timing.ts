interface TimingEntry {
  type: string;
  timestamp: string;
  message?: { role?: string };
  customType?: string;
  data?: unknown;
}

/**
 * `customType` used by the built-in instrumentation extension for the live
 * timing entries it appends after each model request.
 *
 * Live timing cannot be recovered from the session log alone: Pi's `Usage`
 * record carries tokens and cost but no durations, so TTFT and decode time are
 * only ever knowable while the request is in flight.
 */
export const PI_WEB_TIMING_CUSTOM_TYPE = "pi-web-timing";

/**
 * Wall-clock attribution for a session, plus any live timing captured by the
 * instrumentation extension.
 *
 * `modelMs + toolMs + otherMs` equals `computeSessionTotalActiveMs()` for the
 * same entries, so the totals in the UI stay consistent with the existing
 * active-time figure.
 */
export interface SessionTimingAttribution {
  /** Waiting on model output: assistant turns plus compaction/branch summaries. */
  modelMs: number;
  /** Time spent inside tool calls. */
  toolMs: number;
  /** Remaining active time (extension-injected messages, unknown roles). */
  otherMs: number;
  /** Mean time to first token across requests captured live; null when none were. */
  ttftAvgMs: number | null;
  /** Weighted output speed: total output tokens over total decode time. */
  tps: number | null;
  /** Requests that carried live timing entries. */
  timedRequests: number;
  /** Assistant messages in the log — the denominator for timing coverage. */
  assistantRequests: number;
}

export function emptySessionTiming(): SessionTimingAttribution {
  return {
    modelMs: 0,
    toolMs: 0,
    otherMs: 0,
    ttftAvgMs: null,
    tps: null,
    timedRequests: 0,
    assistantRequests: 0,
  };
}

/**
 * Estimate active wall-clock time from the append-only session log.
 *
 * Raw entries preserve compacted history and every executed branch exactly
 * once. Gaps ending at user messages are treated as human idle. User-initiated
 * bash entries are also boundaries because the log records only their finish
 * time, so counting the incoming gap could include arbitrary human idle.
 */
export function computeSessionTotalActiveMs(entries: readonly TimingEntry[]): number {
  let totalActiveMs = 0;
  let previousTimestamp: number | undefined;

  for (const entry of entries) {
    if (!isTimingEntry(entry.type)) continue;

    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;

    const role = entry.type === "message" ? entry.message?.role : undefined;
    if (role === "user" || role === "bashExecution") {
      previousTimestamp = timestamp;
      continue;
    }

    if (previousTimestamp !== undefined && timestamp > previousTimestamp) {
      totalActiveMs += timestamp - previousTimestamp;
    }
    previousTimestamp = timestamp;
  }

  return totalActiveMs;
}

/**
 * Split the active wall-clock of a session into model time and tool time, and
 * fold in live TTFT/decode measurements when the instrumentation extension
 * recorded them.
 *
 * Attribution walks the same anchor chain as `computeSessionTotalActiveMs`:
 * the gap ending at an assistant entry is model time, the gap ending at a
 * tool result is tool time. With parallel tool batches each result contributes
 * its own segment, so per-tool attribution follows completion order while the
 * total still matches the wall-clock span.
 *
 * `custom` entries are deliberately excluded from the clock: they are
 * instrumentation and extension state, not agent activity, and letting them
 * move the anchor would let the measurement perturb itself.
 */
export function computeSessionTiming(
  entries: readonly TimingEntry[],
): SessionTimingAttribution {
  const timing = emptySessionTiming();
  let previousTimestamp: number | undefined;
  let ttftSumMs = 0;
  let ttftSamples = 0;
  let decodeMs = 0;
  let outputTokens = 0;

  for (const entry of entries) {
    if (entry.type === "custom") {
      const live = readLiveTiming(entry);
      if (live) {
        timing.timedRequests += 1;
        if (live.ttftMs !== null) {
          ttftSumMs += live.ttftMs;
          ttftSamples += 1;
        }
        decodeMs += live.decodeMs;
        outputTokens += live.outputTokens;
      }
      continue;
    }

    if (!isTimingEntry(entry.type)) continue;

    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;

    const role = entry.type === "message" ? entry.message?.role : undefined;
    if (role === "user" || role === "bashExecution") {
      previousTimestamp = timestamp;
      continue;
    }

    const gap = previousTimestamp !== undefined && timestamp > previousTimestamp
      ? timestamp - previousTimestamp
      : 0;
    previousTimestamp = timestamp;

    if (role === "assistant") {
      timing.modelMs += gap;
      timing.assistantRequests += 1;
    } else if (role === "toolResult") {
      timing.toolMs += gap;
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      // Compaction and branch summaries are model-generated work, so they count
      // as model time rather than idle.
      timing.modelMs += gap;
    } else {
      timing.otherMs += gap;
    }
  }

  if (ttftSamples > 0) timing.ttftAvgMs = ttftSumMs / ttftSamples;
  if (decodeMs > 0) timing.tps = outputTokens / (decodeMs / 1000);

  return timing;
}

interface LiveTimingSample {
  ttftMs: number | null;
  decodeMs: number;
  outputTokens: number;
}

function readLiveTiming(entry: TimingEntry): LiveTimingSample | null {
  if (entry.customType !== PI_WEB_TIMING_CUSTOM_TYPE) return null;
  const data = entry.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;

  const record = data as Record<string, unknown>;
  const ttftMs = nonNegativeNumber(record.ttftMs);
  const decodeMs = nonNegativeNumber(record.decodeMs);
  const outputTokens = nonNegativeNumber(record.outputTokens);
  if (ttftMs === null && decodeMs === null && outputTokens === null) return null;

  return { ttftMs, decodeMs: decodeMs ?? 0, outputTokens: outputTokens ?? 0 };
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isTimingEntry(type: string): boolean {
  return type === "message"
    || type === "compaction"
    || type === "branch_summary"
    || type === "custom_message";
}
