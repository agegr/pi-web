/**
 * Typed fetch wrapper over the /sidebar JSON API. Every call posts to
 * `/sidebar/api/<method>` with the sessionId and — when known — the session's
 * cwd from the client's own list summary. The host prefers its attached
 * session header and uses the summary cwd only while the session is still
 * hydrating at page load (a detached session would otherwise fail the
 * request). Failures surface as {@link SidebarApiError} with the wire code.
 */
import { encodeHtmlUrl } from './html-route'
import type { LastActivity } from './subagent-activity'
import type { SidechatThreadInfo } from './sidechat-core'
import type { BrowserProbeResult } from './browser'

/** One wire failure. */
export class SidebarApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Explorer row (host fs-tree shape). */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  /** Whether the row is a symlink; `isDir` then describes the link's target. */
  isSymlink: boolean
  /** For symlinks: the target is missing or unreadable (stat failed). */
  broken: boolean
}

/** Git status entry (host git shape). */
export interface GitStatusEntry {
  path: string
  xy: string
}

/** Git status snapshot. */
export interface GitStatusResult {
  isRepo: boolean
  branch?: string
  entries: GitStatusEntry[]
  /** True when the host capped `entries` (huge untracked set); the panel
   *  shows a truncation notice instead of freezing (#369). */
  truncated?: boolean
  root?: string
  repositories?: string[]
}

/** One linked Git checkout. */
export interface GitWorktree {
  path: string
  branch: string
  current: boolean
  changes: number
}

/** One git log row. */
export interface GitLogEntry {
  /** Short hash (7+ chars, display). */
  hash: string
  /** Full 40-char hash (advanced operations). */
  hashFull: string
  subject: string
  author: string
  /** ISO 8601 author date (`%ai`). */
  date: string
  /** Ref decorations (--decorate=short), e.g. `HEAD -> main, origin/main`; '' when none. */
  refs: string
}

/** Text read result. */
export interface FsTextResult { kind: 'text'; content: string; truncated: boolean }
/** Binary read result (no content; images load through the media route).
 *  `head` carries the first bytes (base64) for viewer detect sniffing. */
export interface FsBinaryResult { kind: 'binary'; size: number; truncated: boolean; head: string }

/**
 * One jobs.output response: the output the MODEL has read so far for the
 * job (replayed from the owner session's event log — the model's
 * job_output cursor is never touched, so the pane can never steal the
 * agent's bytes). `read` is false until the model actually called
 * job_output for the job.
 */
export interface JobOutputResult {
  text: string
  /** True when the host capped the text at its output limit. */
  truncated: boolean
  /** Whether the model has read the job at least once. */
  read: boolean
}

/** The `subagents.live` response: running child id → latest activity. */
export type SubagentLiveResult = { live: Record<string, LastActivity> }

/** Terminal dependency status (mirror of the host's depsStatus; issue #140). */
export type TerminalDepsStatus =
  | { ok: true }
  | {
    ok: false
    /** The require-time error message (module missing, native binding broken…). */
    cause: string
    /** The pasteable repair command (terminal/cmd). */
    command: string
    /** The detected profile name (null when undetected → the command defaults to web). */
    profile: string | null
    /** Optional supplementary hint (fallback command only). */
    note?: string
  }

async function call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/sidebar/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    throw new SidebarApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SidebarApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/**
 * Upload one file to the sidebar's raw upload route: the File goes straight
 * into the POST body (no JSON/base64 re-encoding — the host streams it into
 * the workspace). Failure surfaces as {@link SidebarApiError} with the wire
 * code, exactly like every `/sidebar/api` call. An aborted `signal` rejects
 * with the DOMException as-is (the caller decides whether that is an error).
 */
async function fetchUpload<T>(
  scope: SessionScope,
  dir: string,
  relativePath: string,
  body: Blob,
  signal?: AbortSignal,
): Promise<T> {
  const params = new URLSearchParams({ sessionId: scope.sessionId, dir, relativePath })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  let response: Response
  try {
    response = await fetch(`/sidebar/upload?${params.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SidebarApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SidebarApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/** One request's session scope: the conversation id plus its cwd when known. */
export interface SessionScope {
  sessionId: string
  /** The session's working directory from the client list summary (optional). */
  cwd?: string
  /** Selected Git repository when cwd is a workspace container. */
  repoRoot?: string
}

/** Fold a scope into a JSON payload ({cwd} only when present). */
function scopePayload(scope: SessionScope, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: scope.sessionId,
    ...(scope.cwd !== undefined && scope.cwd !== '' ? { cwd: scope.cwd } : {}),
    ...(scope.repoRoot !== undefined && scope.repoRoot !== '' ? { repoRoot: scope.repoRoot } : {}),
    ...extra,
  }
}

/** Add a linked-worktree selection to a scoped Git request. The host validates
 * membership before using it as a command cwd. */
function gitPayload(scope: SessionScope, worktree: string | undefined, extra: Record<string, unknown>): Record<string, unknown> {
  return scopePayload(scope, { ...(worktree !== undefined && worktree !== '' ? { worktree } : {}), ...extra })
}

/** The sidebar API surface (session scope threaded through every call). */
export const api = {
  sessionCwd: (scope: SessionScope, signal?: AbortSignal) =>
    call<{ sessionId: string; cwd: string; root: string; parent: string | null }>('session.cwd', scopePayload(scope, {}), signal),
  fsTree: (scope: SessionScope, path: string, signal?: AbortSignal) =>
    call<{ path: string; entries: FsEntry[]; truncated: boolean }>('fs.tree', scopePayload(scope, { path }), signal),
  /** Global recursive file-name search rooted at the session cwd (the editor
   *  side panel's search box); matches are cwd-relative '/'-separated paths. */
  fsSearch: (scope: SessionScope, query: string, signal?: AbortSignal) =>
    call<{ matches: string[]; truncated: boolean }>('fs.search', scopePayload(scope, { query }), signal),
  fsRead: (scope: SessionScope, path: string, signal?: AbortSignal) =>
    call<FsTextResult | FsBinaryResult>('fs.read', scopePayload(scope, { path }), signal),
  fsWrite: (scope: SessionScope, path: string, content: string) =>
    call<{ ok: true }>('fs.write', scopePayload(scope, { path, content })),
  /** Upload one file's raw bytes into `dir` (keeps the folder tree via
   *  `relativePath`); the host streams it under the session workspace. */
  uploadFile: (scope: SessionScope, dir: string, relativePath: string, body: Blob, signal?: AbortSignal) =>
    fetchUpload<{ path: string; size: number }>(scope, dir, relativePath, body, signal),
  gitWorktrees: (scope: SessionScope, signal?: AbortSignal) =>
    call<GitWorktree[]>('git.worktrees', scopePayload(scope, {}), signal),
  gitStatus: (scope: SessionScope, worktree?: string, signal?: AbortSignal) =>
    call<GitStatusResult>('git.status', gitPayload(scope, worktree, {}), signal),
  gitDiff: (scope: SessionScope, path: string | undefined, staged: boolean, worktree?: string, signal?: AbortSignal) =>
    call<{ diff: string }>('git.diff', gitPayload(scope, worktree, { ...(path !== undefined ? { path } : {}), staged }), signal),
  gitStage: (scope: SessionScope, path?: string, worktree?: string) =>
    call<{ ok: true }>('git.stage', gitPayload(scope, worktree, { ...(path !== undefined ? { path } : {}) })),
  gitUnstage: (scope: SessionScope, path?: string, worktree?: string) =>
    call<{ ok: true }>('git.unstage', gitPayload(scope, worktree, { ...(path !== undefined ? { path } : {}) })),
  gitCommit: (scope: SessionScope, message: string, worktree?: string) =>
    call<{ ok: true }>('git.commit', gitPayload(scope, worktree, { message })),
  gitBranch: (scope: SessionScope, worktree?: string, signal?: AbortSignal) =>
    call<{ current: string; names: string[] }>('git.branch', gitPayload(scope, worktree, {}), signal),
  gitCheckout: (scope: SessionScope, branch: string, worktree?: string) =>
    call<{ ok: true }>('git.checkout', gitPayload(scope, worktree, { branch })),
  /** Recent commit history, lazily pageable (skip/count; defaults 0/30). */
  gitLog: (scope: SessionScope, count?: number, skip?: number, worktree?: string, signal?: AbortSignal) =>
    call<GitLogEntry[]>('git.log', gitPayload(scope, worktree, {
      ...(count !== undefined ? { count } : {}),
      ...(skip !== undefined ? { skip } : {}),
    }), signal),
  /** Full patch text of one commit (diff display for the history rows). */
  gitCommitDiff: (scope: SessionScope, hash: string, worktree?: string, signal?: AbortSignal) =>
    call<{ diff: string }>('git.commit-diff', gitPayload(scope, worktree, { hash }), signal),
  /** Discard the worktree changes of one file (the index is untouched). */
  gitDiscard: (scope: SessionScope, path: string, worktree?: string) =>
    call<{ ok: true }>('git.discard', gitPayload(scope, worktree, { path })),
  /** Revert one commit onto the current branch. */
  gitRevert: (scope: SessionScope, hash: string, worktree?: string) =>
    call<{ ok: true }>('git.revert', gitPayload(scope, worktree, { hash })),
  /** Cherry-pick one commit onto the current branch. */
  gitCherryPick: (scope: SessionScope, hash: string, worktree?: string) =>
    call<{ ok: true }>('git.cherry-pick', gitPayload(scope, worktree, { hash })),
  /** Release a terminal's process immediately (tab closed; the WS close frame
   *  may be unreachable while the socket is down, so the host also accepts
   *  this explicit route). */
  ptyClose: (scope: SessionScope, tab: string) =>
    call<{ ok: true }>('pty.close', scopePayload(scope, { tab })),
  /** Release an agent terminal by uuid (tab closed while WS was down). */
  agentPtyClose: (uuid: string) =>
    call<{ ok: true }>('agent-pty.close', { uuid }),
  /** Terminal dependency status (issue #140): after a WS close 1011 with
   *  reason `pty-deps-missing` the view fetches the full repair details here
   *  (the close reason itself is capped at 123 bytes). */
  terminalDeps: () =>
    call<TerminalDepsStatus>('terminal.deps', {}),
  /**
   * The output the model has read so far for one background job (replayed
   * from the owner session's event log — never the model's job_output
   * cursor). The scope MUST be the job's OWNER session.
   */
  jobOutput: (scope: SessionScope, id: string, signal?: AbortSignal) =>
    call<JobOutputResult>('jobs.output', scopePayload(scope, { id }), signal),
  /** Request cancellation of one background job (live jobs flip to stopping). */
  jobKill: (scope: SessionScope, id: string, reason?: string) =>
    call<{ ok: true; outcome: 'requested' | 'already-finished' }>('jobs.kill', scopePayload(scope, {
      id,
      ...(reason !== undefined ? { reason } : {}),
    })),
  /**
   * One batch live-preview fetch for the whole Subagent tree. The payload is
   * the already-resolved topology ROOT (not a session scope); the host
   * enumerates descendants once and folds running children's activity.
   */
  subagentsLive: (rootSessionId: string, signal?: AbortSignal) =>
    call<SubagentLiveResult>('subagents.live', { rootSessionId }, signal),
  /** Create a Side Chat thread: a child session seeded with the parent's
   *  full log up to now. Empty question = immediate create (Codex-style):
   *  the thread opens empty, the first prompt carries the boundary. */
  sidechatStart: (sessionId: string, question?: string) =>
    call<{ childId: string }>('sidechat.start', { sessionId, question: question ?? '' }),
  /** Deliver one follow-up message to a Side Chat thread. */
  sidechatPrompt: (childId: string, text: string) =>
    call<{ accepted: true }>('sidechat.prompt', { childId, text }),
  /** Abort a Side Chat thread's running turn (queued work is preserved). */
  sidechatCancel: (childId: string) =>
    call<{ accepted: true }>('sidechat.cancel', { childId }),
  /** Release a Side Chat thread's live agent (history stays persisted). */
  sidechatDispose: (childId: string) =>
    call<{ accepted: true }>('sidechat.dispose', { childId }),
  /** Live state + agent identity (provider/model/preset) of a thread. */
  sidechatInfo: (childId: string) =>
    call<SidechatThreadInfo>('sidechat.info', { childId }),
  /** The effective terminal shell and its display name (plugin-global). */
  shellGet: () =>
    call<{ shell: string; name: string }>('shell.get', {}),
  /** Read the side card preferences (plugin-global, no session scope). */
  settingsGet: () =>
    call<{ value?: unknown; revision?: number; externalDisable?: boolean }>('settings.get', {}),
  /** Merge a patch into the side card preferences (revision-guarded). */
  settingsUpdate: (patch: Record<string, unknown>, expectedRevision?: number) =>
    call<{ value?: unknown; revision?: number }>('settings.update', {
      patch,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    }),
  /** Probe a URL's response headers (the sidebar browser's embeddability
   *  check; see the host's browser.probe route). */
  browserProbe: (url: string, signal?: AbortSignal) =>
    call<BrowserProbeResult>('browser.probe', { url }, signal),
  /** External open for the file tree's "open with" menu: reveal a path in
   *  the OS file manager, or hand a custom-scheme URL (vscode://, cursor://,
   *  zed://, custom editors) to its registered handler. The host launches
   *  the platform opener (argv, no shell). */
  openExternal: (payload: { action: 'reveal'; path: string } | { action: 'url'; url: string }) =>
    call<{ started: boolean }>('open.external', payload),
}

/** Absolute URL of the media route for one path (images only). */
export function mediaUrl(scope: SessionScope, path: string): string {
  return fileUrl(scope, path, false)
}

/** Absolute URL of the download route: serves raw bytes (binary-safe) with
 *  `Content-Disposition: attachment`, so the browser saves the file. */
export function downloadUrl(scope: SessionScope, path: string): string {
  return fileUrl(scope, path, true)
}

/** Shared URL builder for the /sidebar/file route (media vs download). */
function fileUrl(scope: SessionScope, path: string, download: boolean): string {
  const params = new URLSearchParams({ sessionId: scope.sessionId, path })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  if (download) params.set('download', '1')
  return `/sidebar/file?${params.toString()}`
}

/**
 * Absolute URL of the HTML preview route (see html-route.ts): the path is
 * fully encoded so the previewed page's relative assets resolve back into
 * the same route with the session scope intact. The UNC marker is
 * platform-neutral — the host's requireAbsolute resolves the decoded
 * forward-slash `//server/share/...` form on both win32 and POSIX — so no
 * client-side platform signal is needed.
 */
export function htmlUrl(scope: SessionScope, path: string): string {
  return encodeHtmlUrl(scope.sessionId, path)
}
