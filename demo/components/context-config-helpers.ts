import type { ContextFileId, ContextFileInfo, ContextResponse } from "@/lib/api-types";

/** The two sides of Pi's configuration, in display order. */
export const CONTEXT_GROUPS = ["global", "local"] as const;
export type ContextGroup = (typeof CONTEXT_GROUPS)[number];

export const CONTEXT_LOAD_TIMEOUT_MS = 15_000;
export const CONTEXT_SAVE_TIMEOUT_MS = 15_000;

export type ContextFailure = {
  error: string;
  /** A refusal code; the root module types this as `McpRefusalReason`, which the demo does not carry. */
  reason?: string;
  path?: string;
  /** The request was aborted at its deadline instead of answered. */
  timedOut?: boolean;
};

export type ContextLoadResult =
  | { ok: true; data: ContextResponse }
  | { ok: false; error: ContextFailure };

export type ContextSaveResult = ContextLoadResult;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function failure(error: unknown, timedOut = false): ContextFailure {
  return { error: error instanceof Error ? error.message : String(error), ...(timedOut ? { timedOut: true } : {}) };
}

function isContextResponse(value: unknown): value is ContextResponse {
  const data = value as Partial<ContextResponse> | null;
  return typeof data === "object" && data !== null
    && typeof data.agentDir === "string"
    && Array.isArray(data.files);
}

/** A refusal's diagnostic, reason code and file, or the HTTP status when the body has none. */
function refusalOf(data: unknown, status: number): ContextFailure {
  const body = (data ?? {}) as Partial<Record<"error" | "reason" | "path", unknown>>;
  return {
    error: typeof body.error === "string" && body.error ? body.error : `HTTP ${status}`,
    ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
    ...(typeof body.path === "string" ? { path: body.path } : {}),
  };
}

/**
 * `fetch` with one deadline. The request is aborted when it runs out, so a route
 * that never answers cannot leave the panel on "Loading…" for good, and the
 * deadline settles the promise itself: a `fetch` that ignores its signal (a test
 * double, a polyfill) would otherwise hang here where the real route would not.
 * The caller's own signal is forwarded by hand (`AbortSignal.any` needs Safari
 * 17.4, and this file is browser code).
 */
async function request(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  describe: string,
): Promise<{ ok: true; data: ContextResponse } | { ok: false; error: ContextFailure }> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", forward, { once: true });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("deadline"));
    }, timeoutMs);
  });

  const run = async () => {
    const response = await fetchImpl(url, { cache: "no-store", ...init, signal: controller.signal });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false as const, error: { error: `HTTP ${response.status}` } };
    }
    if (response.ok && isContextResponse(data)) return { ok: true as const, data };
    return { ok: false as const, error: refusalOf(data, response.status) };
  };

  try {
    return await Promise.race([run(), deadline]);
  } catch (error) {
    if (timedOut) return { ok: false, error: { error: `${describe} did not answer within ${timeoutMs} ms`, timedOut: true } };
    return { ok: false, error: failure(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

export async function loadContextFiles(
  cwd: string | null,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = CONTEXT_LOAD_TIMEOUT_MS,
): Promise<ContextLoadResult> {
  const url = cwd ? `/api/context?cwd=${encodeURIComponent(cwd)}` : "/api/context";
  return request(url, { method: "GET" }, fetchImpl, timeoutMs, signal, "GET /api/context");
}

export interface ContextSaveRequest {
  id: ContextFileId;
  /** Absent when the file is removed. */
  content?: string;
  remove?: boolean;
}

export async function saveContextFile(
  requestBody: ContextSaveRequest,
  cwd: string | null,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
  timeoutMs: number = CONTEXT_SAVE_TIMEOUT_MS,
): Promise<ContextSaveResult> {
  return request("/api/context", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...requestBody, ...(cwd ? { cwd } : {}) }),
  }, fetchImpl, timeoutMs, signal, "PUT /api/context");
}

/**
 * The selection to show: `wanted` while the listing can still edit it, else the
 * first entry it can. A project that lost an entry (removed, or its folder since
 * refused) therefore falls back rather than showing an empty card.
 */
export function pickContextFile(
  files: readonly ContextFileInfo[],
  wanted: string | null,
): ContextFileId | null {
  const usable = files.filter((file) => file.path !== null && file.problem === undefined);
  if (wanted && usable.some((file) => file.id === wanted)) return wanted as ContextFileId;
  return (usable[0]?.id as ContextFileId | undefined) ?? null;
}

/** Why a route refused a write, as the key of the sentence the panel shows. */
export const CONTEXT_REFUSAL_KEYS: Record<string, string> = {
  "cwd-invalid": "context.refusal.cwd-invalid",
  "cwd-denied": "context.refusal.cwd-denied",
  "cwd-not-directory": "context.refusal.cwd-denied",
  "request-denied": "context.refusal.request-denied",
  "content-type": "context.refusal.request-denied",
  "invalid-request": "context.refusal.invalid-request",
  "link-outside": "context.refusal.outside-roots",
  "not-a-file": "context.refusal.not-a-file",
  "too-large": "context.refusal.too-large",
};

/** A refusal or failure in the panel's words; the diagnostic follows it. */
export function contextFailureText(
  error: ContextFailure,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (error.timedOut) return t("context.loadTimedOut");
  const key = error.reason ? CONTEXT_REFUSAL_KEYS[error.reason] : undefined;
  return key ? `${t(key)} ${error.error}` : error.error;
}
