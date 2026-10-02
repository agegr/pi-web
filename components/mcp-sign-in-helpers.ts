import type {
  McpRefusalReason,
  McpResponse,
  McpServerInfo,
  McpServerRef,
  McpSignInFailure,
  McpSignInFlowInfo,
  McpSignInPhase,
} from "@/lib/api-types";
import {
  mcpTestBlock,
  mcpWriteBlock,
  refusalFailure,
  withinDeadline,
  type FetchLike,
  type McpActionFailure,
  type McpTestBlock,
} from "./mcp-config-helpers";

// Pure helpers and requests for Settings › MCP's sign-in (components/McpSignIn.tsx):
// what a flow says at each phase, why Sign in or Sign out cannot be used, and
// the requests to `/api/mcp/sign-in` the panel polls a flow with. Client-safe:
// types and fetch only. The flow itself lives on the server (`lib/mcp-sign-in.ts`).

/** How often the panel asks where a sign-in stands. */
export const MCP_SIGN_IN_POLL_MS = 1_000;
/** How long one sign-in request may take; the flow runs on the server meanwhile, whatever the panel does. */
export const MCP_SIGN_IN_REQUEST_TIMEOUT_MS = 15_000;
/** Poll failures are retried until this long after the flow's own time limit, then the flow is taken for gone. */
export const MCP_SIGN_IN_GONE_AFTER_MS = 5_000;

const ENDED_PHASES: ReadonlySet<McpSignInPhase> = new Set<McpSignInPhase>(["done", "failed", "cancelled", "expired"]);

export function mcpSignInEnded(phase: McpSignInPhase): boolean {
  return ENDED_PHASES.has(phase);
}

/** The panel's sign-in for one server (by `mcpServerKey()`). */
export interface McpSignInRun {
  /** `POST /api/mcp/sign-in` is on its way. */
  starting?: boolean;
  /** The flow as last read. */
  flow?: McpSignInFlowInfo;
  /** When the flow's time limit passes, by the browser's clock: `expiresInMs` from the last read. */
  deadlineAt?: number;
  /** Starting failed, or was refused. */
  error?: McpActionFailure;
  /** The server no longer knows the flow (it ended over a minute ago, or Pi Web restarted). */
  gone?: boolean;
  pasting?: boolean;
  /** Why the server refused the last paste; the flow keeps waiting. */
  pasteError?: McpActionFailure;
  cancelling?: boolean;
  /** The last cancel failed; the sign-in may still be under way, and the next poll says. */
  cancelError?: McpActionFailure;
  /** The last Sign out failed. */
  signOutError?: McpActionFailure;
  /** The last Sign out worked: whether `mcp-auth.json` held anything for the URL. */
  signedOut?: { removed: boolean };
  /** Counts the paste and cancel answers applied, so a poll sent before one cannot undo what it said. */
  version?: number;
}

/** A flow the panel is waiting on: it has not ended and the server still knows it. */
export function mcpSignInActive(run: McpSignInRun | undefined): boolean {
  return run?.flow !== undefined && !run.gone && !mcpSignInEnded(run.flow.phase);
}

/** The sign-in page as a link, only for an http(s) address: the page comes from the server's metadata. */
export function mcpSignInLink(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Why Sign in cannot be used, or undefined when it can: the Test route's
 * checks, which the sign-in route shares (`mcpTestBlock()`): MCP off on the
 * server, a project no decision trusts or a trust store that cannot be read,
 * an entry pi refuses, and one that references PI_WEB_PASSWORD.
 */
export function mcpSignInBlock(
  server: Pick<McpServerInfo, "scope" | "invalidError" | "validated" | "webPasswordField">,
  data: Pick<McpResponse, "mcp" | "project">,
): McpTestBlock | undefined {
  return mcpTestBlock(server, data);
}

/**
 * Why Sign out cannot be used: the checks of any change to the entry
 * (`mcpWriteBlock()`), and an entry pi refuses, whose URL Pi Web does not
 * read. An entry that references PI_WEB_PASSWORD can still be signed out of.
 */
export function mcpSignOutBlock(
  server: Pick<McpServerInfo, "scope" | "invalidError" | "validated">,
  data: Pick<McpResponse, "mcp" | "project">,
): McpTestBlock | undefined {
  const block = mcpWriteBlock(server.scope, data);
  if (block) return block;
  return server.invalidError !== undefined || !server.validated ? "invalid" : undefined;
}

export const MCP_SIGN_IN_BLOCK_KEYS: Record<McpTestBlock, string> = {
  "mcp-off": "mcp.signIn.blocked.mcp-off",
  "project-untrusted": "mcp.signIn.blocked.project-untrusted",
  "trust-unreadable": "mcp.signIn.blocked.trust-unreadable",
  invalid: "mcp.signIn.blocked.invalid",
  "web-password": "mcp.test.blocked.web-password",
};

/**
 * A refusal of the sign-in routes or of Sign out in sign-in words; the
 * reasons the routes share with the switches and Test would otherwise speak
 * of changing a file or of testing. The paste refusals have their own
 * `mcp.reason.*` words, and `internal` shows the route's diagnostic.
 */
export const MCP_SIGN_IN_REFUSAL_KEYS: Partial<Record<McpRefusalReason, string>> = {
  "mcp-off": "mcp.signIn.blocked.mcp-off",
  "project-untrusted": "mcp.signIn.blocked.project-untrusted",
  "trust-unreadable": "mcp.signIn.blocked.trust-unreadable",
  "server-invalid": "mcp.signIn.blocked.invalid",
  "web-password": "mcp.test.blocked.web-password",
  "entry-not-object": "mcp.signIn.refused.file",
  "server-missing": "mcp.signIn.refused.file",
  unparsable: "mcp.signIn.refused.file",
  "invalid-shape": "mcp.signIn.refused.file",
  "link-dangling": "mcp.signIn.refused.file",
  "link-outside": "mcp.signIn.refused.file",
  "not-a-file": "mcp.signIn.refused.file",
  "too-large": "mcp.signIn.refused.file",
  "too-many-servers": "mcp.signIn.refused.file",
  "invalid-request": "mcp.signIn.refused.invalid-request",
};

/** What a flow under way is doing, for the phases that show no page. */
export const MCP_SIGN_IN_PHASE_KEYS: Partial<Record<McpSignInPhase, string>> = {
  connecting: "mcp.signIn.phase.connecting",
  starting: "mcp.signIn.phase.starting",
  finishing: "mcp.signIn.phase.finishing",
};

export const MCP_SIGN_IN_FAILURE_KEYS: Record<McpSignInFailure, string> = {
  "connect-failed": "mcp.signIn.failed.connect-failed",
  "queue-timed-out": "mcp.signIn.failed.queue-timed-out",
  "sign-in-failed": "mcp.signIn.failed.sign-in-failed",
  internal: "mcp.signIn.failed.internal",
};

/**
 * Whether `flow` is another entry's sign-in, which this entry joined because
 * both have the same URL: what its connections found is recorded for that
 * entry only, so this one's Connection row does not show it.
 */
export function mcpSignInShared(
  flow: Pick<McpSignInFlowInfo, "scope" | "name">,
  server: Pick<McpServerInfo, "scope" | "name">,
): boolean {
  return flow.scope !== server.scope || flow.name !== server.name;
}

/**
 * How an ended flow ended, as one sentence; `failed` adds the SDK's words
 * after it. A `shared` flow (`mcpSignInShared()`) never points at this
 * entry's Connection row, which shows nothing the flow found.
 */
export function mcpSignInOutcomeKey(
  flow: Pick<McpSignInFlowInfo, "phase" | "alreadySignedIn" | "refreshed" | "result" | "failure">,
  shared = false,
): string | undefined {
  switch (flow.phase) {
    case "done": {
      if (shared) return flow.alreadySignedIn ? "mcp.signIn.shared.already" : "mcp.signIn.shared.done";
      if (flow.alreadySignedIn) return "mcp.signIn.done.already";
      const result = flow.result;
      if (result && result.state === "needs-auth") return "mcp.signIn.done.needsAuthAfter";
      if (result && result.state === "failed") return "mcp.signIn.done.failedAfter";
      if (!result) return "mcp.signIn.done.notConnected";
      return flow.refreshed ? "mcp.signIn.done.refreshed" : "mcp.signIn.done.signedIn";
    }
    case "failed":
      if (shared && flow.failure === "connect-failed") return "mcp.signIn.shared.connect-failed";
      return MCP_SIGN_IN_FAILURE_KEYS[flow.failure ?? "internal"];
    case "cancelled":
      return "mcp.signIn.cancelled";
    case "expired":
      return "mcp.signIn.expired";
    default:
      return undefined;
  }
}

/** The tone of that sentence; a `shared` flow's connection is the other entry's, so signing in is what counts. */
export function mcpSignInOutcomeTone(flow: Pick<McpSignInFlowInfo, "phase" | "result">, shared = false): "on" | "off" | "warning" | "error" {
  if (flow.phase === "done") return !shared && flow.result && flow.result.state !== "connected" ? "warning" : "on";
  if (flow.phase === "failed") return "error";
  return flow.phase === "expired" ? "warning" : "off";
}

// ---------------------------------------------------------------------------
// Where a run goes after each answer
// ---------------------------------------------------------------------------

export type McpSignInRequestResult = { ok: true; data: McpSignInFlowInfo } | { ok: false; error: McpActionFailure };

/**
 * The run with `flow` as its latest read. Once the flow has ended, what a
 * paste or a cancel left behind goes: a failed cancel's "may still be under
 * way" and a refused paste no longer describe it.
 */
function withFlow(run: McpSignInRun, flow: McpSignInFlowInfo, now: number): McpSignInRun {
  const next: McpSignInRun = { ...run, flow, deadlineAt: now + flow.expiresInMs, gone: false };
  if (mcpSignInEnded(flow.phase)) {
    delete next.pasteError;
    delete next.cancelError;
    if (next.pasting) next.pasting = false;
    if (next.cancelling) next.cancelling = false;
  }
  return next;
}

/** After `POST /api/mcp/sign-in`: the flow it started or joined, or why it did not. */
export function mcpSignInRunAfterStart(result: McpSignInRequestResult, now: number = Date.now()): McpSignInRun {
  return result.ok ? withFlow({}, result.data, now) : { error: result.error };
}

/** Whether a failure says the server no longer knows the flow. */
function isGone(failure: McpActionFailure): boolean {
  return failure.reason === "sign-in-unknown";
}

/**
 * After a poll of `flowId`, sent when the run's `version` was `sentVersion`.
 * A poll of a flow the run no longer shows (a new sign-in started meanwhile),
 * or one sent before a paste or cancel was answered (it would put the flow
 * back where the answer moved it from), changes nothing. A poll that failed
 * for another reason (a network hiccup) is retried, until the flow's own
 * time limit has long passed; then the flow is taken for gone.
 */
export function mcpSignInRunAfterPoll(
  run: McpSignInRun | undefined,
  flowId: string,
  result: McpSignInRequestResult,
  now: number = Date.now(),
  sentVersion?: number,
): McpSignInRun | undefined {
  if (!run?.flow || run.flow.flowId !== flowId) return run;
  if (sentVersion !== undefined && (run.version ?? 0) !== sentVersion) return run;
  if (result.ok) return withFlow(run, result.data, now);
  if (isGone(result.error)) return { ...run, gone: true };
  if (run.deadlineAt !== undefined && now > run.deadlineAt + MCP_SIGN_IN_GONE_AFTER_MS) return { ...run, gone: true };
  return run;
}

/** After a paste: the flow moving on, or why it was refused, while the flow keeps waiting. */
export function mcpSignInRunAfterPaste(run: McpSignInRun | undefined, flowId: string, result: McpSignInRequestResult, now: number = Date.now()): McpSignInRun | undefined {
  if (!run?.flow || run.flow.flowId !== flowId) return run;
  const settled = { ...run, pasting: false, version: (run.version ?? 0) + 1 };
  if (result.ok) return { ...withFlow(settled, result.data, now), pasteError: undefined };
  if (isGone(result.error)) return { ...settled, gone: true };
  return { ...settled, pasteError: result.error };
}

/** After a cancel: the flow as it ended. */
export function mcpSignInRunAfterCancel(run: McpSignInRun | undefined, flowId: string, result: McpSignInRequestResult, now: number = Date.now()): McpSignInRun | undefined {
  if (!run?.flow || run.flow.flowId !== flowId) return run;
  const settled = { ...run, cancelling: false, cancelError: undefined, version: (run.version ?? 0) + 1 };
  if (result.ok) return withFlow(settled, result.data, now);
  if (isGone(result.error)) return { ...settled, gone: true };
  return { ...settled, cancelError: result.error };
}

/** Whether a run went from waiting to ended (or gone), after which the panel reads the overview again. */
export function mcpSignInJustEnded(previous: McpSignInRun | undefined, next: McpSignInRun | undefined): boolean {
  return mcpSignInActive(previous) && !mcpSignInActive(next);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function isFlowInfo(value: unknown): value is McpSignInFlowInfo {
  if (value === null || typeof value !== "object") return false;
  const flow = value as Partial<McpSignInFlowInfo>;
  return typeof flow.flowId === "string" && typeof flow.phase === "string" && typeof flow.name === "string"
    && (flow.scope === "global" || flow.scope === "project") && typeof flow.expiresInMs === "number";
}

async function requestSignIn(url: string, init: RequestInit, fetchImpl: FetchLike, signal: AbortSignal): Promise<McpSignInRequestResult> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, { ...init, cache: "no-store", signal });
  } catch (error) {
    return { ok: false, error: { error: error instanceof Error ? error.message : String(error) } };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: { error: `HTTP ${response.status}` } };
  }
  if (response.ok && isFlowInfo(data)) return { ok: true, data };
  return { ok: false, error: refusalFailure(data, response.status) };
}

function signInRequest(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  options: { abortAtDeadline?: boolean } = {},
): Promise<McpSignInRequestResult> {
  const method = init.method ?? "GET";
  return withinDeadline<McpSignInRequestResult>(
    (deadlineSignal) => requestSignIn(url, init, fetchImpl, deadlineSignal),
    () => ({ ok: false, error: { error: `${method} ${url} did not answer within ${timeoutMs} ms`, timedOut: true } }),
    timeoutMs,
    signal,
    options,
  );
}

function flowUrl(flowId: string): string {
  return `/api/mcp/sign-in/${encodeURIComponent(flowId)}`;
}

/**
 * Starts signing in to a server, which the route reads from its file, or
 * joins the sign-in under way for its URL. `cwd` is the panel's project, sent
 * only when the listing covers one, as for Test. The route answers at once;
 * the flow runs on the server whatever the panel does next. At `timeoutMs` it
 * answers `timedOut` and leaves the request running, as Test does, so a
 * route that read its request's signal could not stop a start that was only
 * slow to answer; only `signal` aborts it. Polls, pastes and cancels are
 * aborted at their deadline: their routes do their work at once, and an
 * aborted request undoes none of it.
 */
export function postMcpSignIn(
  server: McpServerRef,
  cwd: string | null,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_SIGN_IN_REQUEST_TIMEOUT_MS,
): Promise<McpSignInRequestResult> {
  return signInRequest("/api/mcp/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: server.scope, name: server.name, ...(cwd ? { cwd } : {}) }),
  }, fetchImpl, signal, timeoutMs, { abortAtDeadline: false });
}

/** Where a sign-in stands; aborting the poll changes nothing on the server. */
export function getMcpSignIn(
  flowId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_SIGN_IN_REQUEST_TIMEOUT_MS,
): Promise<McpSignInRequestResult> {
  return signInRequest(flowUrl(flowId), {}, fetchImpl, signal, timeoutMs);
}

/** Hands the server the address the browser landed on; a refused one leaves the sign-in waiting. */
export function pasteMcpSignIn(
  flowId: string,
  redirectUrl: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_SIGN_IN_REQUEST_TIMEOUT_MS,
): Promise<McpSignInRequestResult> {
  return signInRequest(flowUrl(flowId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirectUrl }),
  }, fetchImpl, signal, timeoutMs);
}

/** Cancels a sign-in. */
export function cancelMcpSignInFlow(
  flowId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = MCP_SIGN_IN_REQUEST_TIMEOUT_MS,
): Promise<McpSignInRequestResult> {
  return signInRequest(flowUrl(flowId), { method: "DELETE" }, fetchImpl, signal, timeoutMs);
}
