/**
 * Validate-then-add pin flow for the directory picker (wi pi#47).
 *
 * The picker itself only invokes an optional `onPinDirectory` callback;
 * ALL custom-directory store mutation and /api/cwd/validate allowed-root
 * registration stays with the sidebar (the owner of the store). This module
 * implements that flow so it is testable with an injected fetch and store:
 *
 * 1. POST /api/cwd/validate on the picked directory FIRST. A non-OK
 *    response (400/500/network) returns `{ ok: false, error }` with NO
 *    store mutation and no success report.
 * 2. On OK, run the idempotent head-of-list store add, then notify the
 *    owner (revision bump + expand/scroll of the new group).
 *
 * Unlike the sidebar's add-directory flow (add first, validate best-effort),
 * pin is validate-BEFORE-add: a failed validation never mutates the list.
 */

export type PinOutcome = { ok: true } | { ok: false; error: string };

export interface DirectoryPinFlow {
  (path: string): Promise<PinOutcome>;
}

export interface DirectoryPinFlowOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** REQUIRED store add (idempotent head-of-list). The flow deliberately has
   * NO production default: the custom-directory store write is owned by the
   * store's owner (SessionSidebar), which must inject it explicitly — the
   * helper never mutates the store on its own (review blocker, pi#47). */
  add: (path: string) => void;
  /** Owner notification after a successful add (revision bump, expand/scroll). */
  onAdded?: (path: string) => void;
}

async function readErrorMessage(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as { error?: unknown } | null;
  if (data && typeof data.error === "string" && data.error.length > 0) return data.error;
  return `HTTP ${response.status}`;
}

export function createDirectoryPinFlow(options: DirectoryPinFlowOptions): DirectoryPinFlow {
  const fetchFn = options.fetchFn ?? fetch;
  // No fallback: `add` is required, so the production store write happens
  // only through the owner-injected callback (SessionSidebar), never here.
  const add = options.add;
  return async (path: string): Promise<PinOutcome> => {
    if (!path) return { ok: false, error: "No directory selected" };
    try {
      const response = await fetchFn("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      if (!response.ok) {
        return { ok: false, error: await readErrorMessage(response) };
      }
      add(path);
      options.onAdded?.(path);
      return { ok: true };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  };
}
