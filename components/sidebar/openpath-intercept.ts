/**
 * Interception of the chat's file-open funnel. The client runtime's
 * `ctx.workspaces.openPath` is the SINGLE door every chat-side file open goes
 * through — ui-conversation's apply.ts resolves the path against the session
 * cwd and calls it for tool-row path links, the produced-files row, and
 * prose file mentions alike (verified against the DSH source:
 * `packages/client/ui-conversation/src/client/apply.ts` is the only
 * production caller). Wrapping that one method reroutes those opens into the
 * sidebar editor instead of the Host OS — no DSH modification needed.
 *
 * The wrapper is dependency-free by design (no React / ui-primitives), so
 * the takeover logic is unit-testable and the file stays importable from the
 * test runtime.
 */

/** The one service method the wrapper replaces (mirror of the runtime IWorkspaces). */
export interface OpenPathService {
  openPath(path: string): Promise<void>
}

/** Per-call decisions the wrapper needs (wired to the store + ctx in the client half). */
export interface OpenPathInterceptDeps {
  /**
   * Whether to take over this call: the `interceptOpenPath` pref AND the
   * editor tab's own enable switch must both be on (an editor that cannot
   * open must not swallow opens — they fall through to the Host).
   */
  takeoverEnabled(): boolean
  /** The session whose scope the sidebar editor loads the file in (current session). */
  currentSessionId(): string | undefined
  /** Route the open into the sidebar editor (the established openSidebarFile). */
  openInSidebar(path: string, sessionId: string): void
  /** Route a folder-reveal gesture ("Show in folder" passes '.') into the sidebar explorer. */
  revealInExplorer(path: string, sessionId: string): void
}

/**
 * Whether a path is the "Show in folder" folder-reveal gesture. The stock
 * ui-deliverables row passes `'.'` (the session workspace root, resolved by
 * the chat view to `"<cwd>/."`); any path whose final segment is `.` is the
 * same gesture. A directory has no editor content, so these opens must reach
 * the explorer instead of an editor tab.
 */
export function isFolderRevealPath(path: string): boolean {
  if (path === '.' || path === './') return true
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed === '.' || /[\\/]\.$/.test(trimmed)
}

/**
 * Wrap `workspaces.openPath`: intercepted calls open the file in the sidebar
 * editor instead of the Host OS and resolve as success (the original's
 * callers ignore the result); anything that declines falls through to the
 * original method untouched. The one exception is the folder-reveal gesture,
 * which is routed to {@link OpenPathInterceptDeps.revealInExplorer} instead.
 * @param workspaces - the client workspaces service to wrap.
 * @param deps - per-call takeover decisions.
 * @returns the disposer restoring the original method (HMR-safe).
 */
export function wrapOpenPath(workspaces: OpenPathService, deps: OpenPathInterceptDeps): () => void {
  // The RAW method reference (never a bound copy): restore must put back the
  // exact original so a chain of wrappers (other plugins wrapping the same
  // method) keeps working across disposals in any order.
  const original = workspaces.openPath
  workspaces.openPath = (path: string): Promise<void> => {
    if (deps.takeoverEnabled()) {
      const sessionId = deps.currentSessionId()
      if (sessionId !== undefined) {
        if (isFolderRevealPath(path)) deps.revealInExplorer(path, sessionId)
        else deps.openInSidebar(path, sessionId)
        return Promise.resolve()
      }
    }
    return original.call(workspaces, path)
  }
  return () => {
    workspaces.openPath = original
  }
}
