/**
 * Browse/create engine for the directory picker (wi pi#47).
 *
 * The picker's interactive behaviors live here as plain functions with
 * injectable fetch/storage so `node --test` can drive them without a DOM:
 *
 * - query building for /api/cwd/browse (the literal `showHidden=true`),
 * - the persisted "show hidden directories" preference
 *   (localStorage key `directoryPicker.showHidden`, default unchecked),
 * - a request-sequenced browse controller: out-of-order/stale responses
 *   never clobber the current listing, and refetchCurrent() targets the
 *   CURRENT browsed directory, not the dialog's initial path,
 * - client-side single-segment name validation for the new-file flow,
 * - the create-folder/create-file flows: /api/cwd/validate on the browsed
 *   parent first, then the files API, with non-OK bodies (including HTTP
 *   207 `errors` arrays) surfaced as typed error messages.
 */

import { encodeFilePathForApi } from "./file-paths";

export interface BrowseDirectoryEntry {
  name: string;
  path: string;
}

export interface BrowseResult {
  path: string;
  parentPath: string | null;
  directories: BrowseDirectoryEntry[];
  /** Non-null only on the Windows drive-picker response (empty directories). */
  drives: BrowseDirectoryEntry[] | null;
}

interface BrowseResponsePayload {
  path?: string;
  parentPath?: string | null;
  directories?: BrowseDirectoryEntry[];
  drives?: BrowseDirectoryEntry[];
  error?: string;
}

/** localStorage key of the persisted show-hidden checkbox. */
export const SHOW_HIDDEN_STORAGE_KEY = "directoryPicker.showHidden";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Default unchecked: only an explicitly stored "true" opts in. */
export function loadShowHiddenPreference(storage: StorageLike): boolean {
  try {
    return storage.getItem(SHOW_HIDDEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveShowHiddenPreference(storage: StorageLike, value: boolean): void {
  try {
    storage.setItem(SHOW_HIDDEN_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Best-effort persistence: unavailable storage degrades to unchecked.
  }
}

/**
 * Composed show-hidden lifecycle (review P2 coverage): the production
 * wiring the picker runs at mount and on toggle, as ONE seam so behavioral
 * tests drive the real initialization + current-directory reload
 * composition (navigate away, toggle, showHidden=true on the CURRENT path,
 * stale older responses dropped, reopen restores the preference).
 * Storage ACQUISITION is failure-safe: a throwing getter (browser storage
 * policy denying access) degrades to the unchecked default and never
 * aborts the browse/reload that follows.
 */
export function createShowHiddenLifecycle(options: {
  /** Acquires the storage; may itself throw — caught here; null disables persistence. */
  storage: () => StorageLike | null;
  /** Applies the effective preference to UI state and the request-time ref. */
  onPreference: (checked: boolean) => void;
  /** Reloads the CURRENT browsed directory (engine refetchCurrent). */
  reload: () => void;
}) {
  const safeStorage = (): StorageLike | null => {
    try {
      return options.storage();
    } catch {
      return null; // storage-policy denial degrades to session-only
    }
  };
  return {
    /** Mount/reopen: applies and returns the effective initial preference. */
    initialize(): boolean {
      const storage = safeStorage();
      const checked = storage ? loadShowHiddenPreference(storage) : false;
      options.onPreference(checked);
      return checked;
    },
    /** Toggle: apply, persist (best-effort), then reload the current directory — always. */
    toggle(next: boolean) {
      options.onPreference(next);
      const storage = safeStorage();
      if (storage) saveShowHiddenPreference(storage, next);
      options.reload();
    },
  };
}

/**
 * The /api/cwd/browse URL. showHidden emits exactly the literal `true`
 * (never `1`); unchecked omits the parameter so the server defaults to
 * hiding dot-prefixed directories.
 */
export function buildBrowseUrl(directory?: string, showHidden?: boolean): string {
  const params = new URLSearchParams();
  if (directory) params.set("path", directory);
  if (showHidden) params.set("showHidden", "true");
  const query = params.toString();
  return query ? `/api/cwd/browse?${query}` : "/api/cwd/browse";
}

export interface BrowseController {
  /** Browse a directory (undefined = the server's start directory). */
  browse(directory?: string): Promise<void>;
  /** Re-fetch the CURRENT browsed directory (never the initial path). */
  refetchCurrent(): Promise<void>;
}

export function createBrowseController(options: {
  fetchFn?: typeof fetch;
  showHidden?: () => boolean;
  onLoading?: (loading: boolean) => void;
  onResult: (result: BrowseResult) => void;
  onError?: (message: string) => void;
}): BrowseController {
  const fetchFn = options.fetchFn ?? fetch;
  const showHidden = options.showHidden ?? (() => false);
  let sequence = 0;
  // The directory whose listing is currently DISPLAYED. It advances ONLY on
  // a successful browse: a failed navigation must never become the refetch
  // target, so the show-hidden toggle keeps operating on the directory the
  // user actually sees, never the failed target (review P2 regression).
  let appliedDirectory: string | undefined;

  async function browse(directory?: string): Promise<void> {
    const requestSequence = ++sequence;
    options.onLoading?.(true);
    try {
      const response = await fetchFn(buildBrowseUrl(directory, showHidden()));
      const data = await response.json().catch(() => null) as BrowseResponsePayload | null;
      if (!response.ok || !data || data.error) {
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      // Stale (out-of-order) responses are dropped: only the current
      // request's result may update the listing or the loading flag.
      if (requestSequence !== sequence) return;
      const result: BrowseResult = {
        path: data.path ?? "",
        parentPath: data.parentPath ?? null,
        directories: data.directories ?? [],
        drives: data.drives ?? null,
      };
      // Only a successfully APPLIED result moves the refetch target.
      appliedDirectory = result.path || directory;
      options.onResult(result);
    } catch (cause) {
      if (requestSequence !== sequence) return;
      options.onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestSequence === sequence) options.onLoading?.(false);
    }
  }

  return {
    browse,
    refetchCurrent: () => browse(appliedDirectory),
  };
}

/** Typed client-side validation issue for the new-file name. The engine
 * returns CODES, never user-facing strings: the UI layer translates each
 * code through the i18n catalogs (directoryPicker.validation.<code>), so no
 * locale renders hard-coded English from this module. */
export type NewFileNameIssue =
  | "required"
  | "invalid"
  | "dotSegment"
  | "pathSeparator"
  | "tooLong";

/** Every issue code, for locale-completeness assertions in tests. */
export const NEW_FILE_NAME_ISSUES: readonly NewFileNameIssue[] = [
  "required",
  "invalid",
  "dotSegment",
  "pathSeparator",
  "tooLong",
];

/**
 * Client-side single-segment name gate for the new-file flow: non-empty,
 * no "/" or "\", not "." or "..", no NUL. Ordinary dots inside names
 * (e.g. "notes.md") stay allowed. Returns null when the name is usable;
 * an unsafe name yields a typed issue code and is rejected locally with
 * no request issued.
 */
export function validateNewFileName(name: string): NewFileNameIssue | null {
  if (name.length === 0) return "required";
  if (name.includes("\0")) return "invalid";
  if (name === "." || name === "..") return "dotSegment";
  if (name.includes("/") || name.includes("\\")) return "pathSeparator";
  if (name.length > 255) return "tooLong";
  return null;
}

/** Client-side single-segment join for the folder a create flow just made
 * (moved here so runCreateSubmission and the picker share ONE production
 * implementation). Windows drive roots keep their backslash separator. */
export function joinDirectoryPath(parent: string, name: string): string {
  const trimmed = parent.replace(/[\\/]+$/, "");
  if (isWindowsDriveRoot(parent)) return `${trimmed}\\${name}`;
  return `${trimmed}/${name}`;
}

function isWindowsDriveRoot(directory: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(directory);
}

/**
 * The create flows' shared submission orchestration — the SAME function the
 * picker component runs (a production-used seam, so tests drive the real
 * behavior: unsafe names issue zero requests, failures keep the listing,
 * folder success enters the created folder, file success refreshes it).
 */
export async function runCreateSubmission(options: {
  kind: "folder" | "file";
  rawName: string;
  currentPath: string;
  fetchFn?: typeof fetch;
  /** Translates a typed validation issue into user-facing copy (i18n). */
  translateIssue: (issue: NewFileNameIssue) => string;
  /** 409-conflict message for the given kind (i18n). */
  conflictMessage: string;
  onBusy: (busy: boolean) => void;
  onFormError: (message: string) => void;
  onFolderCreated: (joinedPath: string) => void;
  onFileCreated: () => void;
  onListingRefresh: () => void;
}): Promise<void> {
  const name = options.rawName.trim();
  if (options.kind === "file") {
    const issue = validateNewFileName(name);
    if (issue) {
      options.onFormError(options.translateIssue(issue));
      return;
    }
  } else if (!name) {
    return;
  }
  options.onBusy(true);
  const result = options.kind === "folder"
    ? await createFolderInDirectory(options.fetchFn ?? fetch, options.currentPath, name)
    : await createFileInDirectory(options.fetchFn ?? fetch, options.currentPath, name);
  options.onBusy(false);
  if (!result.ok) {
    // Failure keeps the listing and the current directory untouched.
    options.onFormError(result.status === 409 ? options.conflictMessage : result.error);
    return;
  }
  if (options.kind === "folder") {
    options.onFolderCreated(joinDirectoryPath(options.currentPath, name));
  } else {
    options.onFileCreated();
    options.onListingRefresh();
  }
}

export type CreateFlowResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Whether a create-flow response counts as failed. Beyond non-2xx statuses,
 * HTTP 207 multi-status bodies carry per-item `errors` arrays — a 207 from
 * the files API means the operation did not fully succeed, so it must be
 * surfaced as a typed failure, not swallowed as success (207 IS 2xx, so
 * response.ok alone cannot detect it).
 */
function isFailedStatus(response: Response): boolean {
  return !response.ok || response.status === 207;
}

/** Read a non-OK body's message: `error` string first, then HTTP 207-style
 * per-item `errors` arrays, then a bare HTTP status fallback. */
async function readErrorMessage(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as {
    error?: unknown;
    errors?: unknown;
  } | null;
  if (data) {
    if (typeof data.error === "string" && data.error.length > 0) return data.error;
    if (Array.isArray(data.errors)) {
      const messages = data.errors
        .map((item) =>
          item && typeof item === "object" && typeof (item as { error?: unknown }).error === "string"
            ? (item as { error: string }).error
            : null)
        .filter((message): message is string => message !== null);
      if (messages.length > 0) return messages.join("; ");
    }
  }
  return `HTTP ${response.status}`;
}

/**
 * Pre-flight for both create flows: POST /api/cwd/validate on the browsed
 * parent registers it as an allowed file root (the same integration the
 * sidebar's custom-path commit uses) before any write is attempted.
 */
async function validateParent(
  fetchFn: typeof fetch,
  directory: string,
): Promise<CreateFlowResult> {
  try {
    const response = await fetchFn("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: directory }),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: await readErrorMessage(response) };
    }
    return { ok: true };
  } catch (cause) {
    return { ok: false, status: 0, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Create folder `directory/<name>` (exclusive mkdir; the route answers a
 * typed 409 on an existing target). The parent is validated first. */
export async function createFolderInDirectory(
  fetchFn: typeof fetch,
  directory: string,
  name: string,
): Promise<CreateFlowResult> {
  const validated = await validateParent(fetchFn, directory);
  if (!validated.ok) return validated;
  try {
    const response = await fetchFn(
      `/api/files/${encodeFilePathForApi(directory)}?type=mkdir`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    if (isFailedStatus(response)) {
      return { ok: false, status: response.status, error: await readErrorMessage(response) };
    }
    return { ok: true };
  } catch (cause) {
    return { ok: false, status: 0, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Create empty file `directory/<name>` through the type=create-file
 * branch (exclusive write; typed 409 on an existing target). The parent
 * is validated first; a failed body — including HTTP 207 with an
 * `errors` array — is surfaced as a typed message. */
export async function createFileInDirectory(
  fetchFn: typeof fetch,
  directory: string,
  name: string,
): Promise<CreateFlowResult> {
  const validated = await validateParent(fetchFn, directory);
  if (!validated.ok) return validated;
  try {
    const response = await fetchFn(
      `/api/files/${encodeFilePathForApi(directory)}?type=create-file`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    if (isFailedStatus(response)) {
      return { ok: false, status: response.status, error: await readErrorMessage(response) };
    }
    return { ok: true };
  } catch (cause) {
    return { ok: false, status: 0, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
