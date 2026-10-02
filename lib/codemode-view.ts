// Display helpers for pi's `codemode` tool, whose calls carry a JavaScript
// script and whose results list the tool calls the script made. The shapes
// mirror the SDK's `CodemodeToolDetails` / `CodemodeNestedCall`, read
// defensively because a third-party tool may also be called `codemode`.

export const CODEMODE_TOOL_NAME = "codemode";

export type CodemodeCallStatus = "running" | "ok" | "error" | "cancelled";

export interface CodemodeCallView {
  id: string;
  name: string;
  /** Compact JSON of the arguments, already truncated by the SDK. */
  args: string;
  status: CodemodeCallStatus;
  durationMs?: number;
  error?: string;
  /** Cost in USD of a `models.*` call. */
  cost?: number;
}

export interface CodemodeCalls {
  calls: CodemodeCallView[];
  /** Earlier calls a progress snapshot left out (`omittedCalls`, see lib/agent-event-wire.ts). */
  omitted: number;
}

const STATUSES = new Set<string>(["running", "ok", "error", "cancelled"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The script of a codemode call, or null when the input has none. */
export function codemodeScript(input: unknown): string | null {
  return isRecord(input) && typeof input.code === "string" ? input.code : null;
}

function toCall(value: unknown): CodemodeCallView | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const status = typeof value.status === "string" && STATUSES.has(value.status)
    ? value.status as CodemodeCallStatus
    : "ok";
  const durationMs = finiteNumber(value.durationMs);
  const cost = finiteNumber(value.cost);
  return {
    id: typeof value.id === "string" ? value.id : "",
    name: value.name,
    args: typeof value.args === "string" ? value.args : "",
    status,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(typeof value.error === "string" && value.error ? { error: value.error } : {}),
    ...(cost !== undefined && cost > 0 ? { cost } : {}),
  };
}

/** The nested calls recorded in a codemode result's or progress snapshot's details. */
export function codemodeCalls(details: unknown): CodemodeCalls {
  if (!isRecord(details) || !Array.isArray(details.calls)) return { calls: [], omitted: 0 };
  const calls = details.calls.flatMap((call) => {
    const view = toCall(call);
    return view ? [view] : [];
  });
  const omitted = finiteNumber(details.omittedCalls);
  return { calls, omitted: omitted !== undefined && omitted > 0 ? Math.floor(omitted) : 0 };
}

const SCRIPT_HEADER = /^Script (completed|failed)\nWall time ([\d.]+) seconds\nOutput:\n$/;

/**
 * A codemode result's content without its "Script completed / Wall time /
 * Output:" header, which the card already shows as its colour and duration.
 * Rejected input (invalid `// @options:`) has no header and is kept whole.
 */
export function stripCodemodeHeader<T extends { type: string; text?: string }>(content: readonly T[]): T[] {
  const [first, ...rest] = content;
  return first?.type === "text" && typeof first.text === "string" && SCRIPT_HEADER.test(first.text)
    ? rest
    : [...content];
}

export function formatCodemodeDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Cents for larger amounts, two significant digits for the fractions of a cent classifier calls cost. */
export function formatCodemodeCost(cost: number): string {
  return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
}

/** The total cost of the script's model calls, when more than one reported one. */
export function codemodeTotalCost(calls: readonly CodemodeCallView[]): number | null {
  const priced = calls.filter((call) => call.cost !== undefined);
  return priced.length > 1 ? priced.reduce((sum, call) => sum + (call.cost ?? 0), 0) : null;
}

/**
 * The script's first line that says what it does, for the collapsed card:
 * blank lines and the `// @options:` line are skipped.
 */
export function codemodeScriptPreview(code: string): string {
  for (const line of code.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("// @options:")) return trimmed;
  }
  return "";
}

const PROGRESS_ARGS_LENGTH = 120;

/**
 * The status line while a script runs: the newest call still running, or the
 * newest call when none is. A snapshot has no text content, so the generic
 * progress (the last output line) has nothing to show.
 */
export function getCodemodeProgress(partialResult: unknown): string | null {
  if (!isRecord(partialResult)) return null;
  const { calls } = codemodeCalls(partialResult.details);
  const call = calls.findLast((candidate) => candidate.status === "running") ?? calls.at(-1);
  if (!call) return null;
  const args = call.args.length > PROGRESS_ARGS_LENGTH
    ? `${call.args.slice(0, PROGRESS_ARGS_LENGTH - 3)}...`
    : call.args;
  return args ? `${call.name} ${args}` : call.name;
}
