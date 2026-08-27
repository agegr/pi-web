/**
 * The generic render error boundary for the sidebar tree: a render error in
 * the wrapped subtree shows a dismissible error strip (retry re-renders the
 * children) instead of blanking the shell. Used at two scopes:
 *
 * - ROOT (index.tsx, `css.boundaryError`): last-resort containment for
 *   errors in the sidebar shell itself (Workbench, drag layout, …) — a full
 *   swap keeps the page alive.
 * - PER-TAB (Sidebar.tsx TabContent, `css.tabBoundaryError`): a crashing
 *   viewer/editor shows a strip inside ITS OWN pane; the toggle cluster, the
 *   other tabs, and the panel itself stay alive (issue #31 — a tab crash
 *   must never take down the whole sidebar).
 * - EMBEDDED left dock (BetterSidebarHost): the workbench is wrapped at the
 *   same root scope.
 *
 * The className prop selects the strip's geometry: the root's full-height
 * fixed rail vs. the tab's pane-filling block.
 *
 * SELF-HEAL: a caught error re-renders the children once after a short delay
 * (a transient mount race or a stale HMR module recovers). Fast Refresh does
 * NOT reset class-boundary state, so without this a one-time crash would keep
 * the error strip — and its console log — visible forever even after the
 * fixed code lands. The single auto-retry clears exactly that case; a
 * persistent bug re-catches and leaves the strip with the manual retry
 * button (no loop).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from './locales'
import css from './sidebar.module.css'

/** How long to wait before re-rendering the children after a caught error. */
const AUTO_RETRY_MS = 1200

interface RenderBoundaryState {
  error: string | null
  autoRetried: boolean
}

export class RenderBoundary extends Component<{ children?: ReactNode; className?: string }, RenderBoundaryState> {
  state: RenderBoundaryState = { error: null, autoRetried: false }
  private retryTimer: number | undefined

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[dsh-better-sidebar] render error:', error, info.componentStack)
    // Exactly ONE automatic retry: transient failures (mount race, stale HMR
    // module replaced a moment later) self-heal; real bugs stay visible.
    if (!this.state.autoRetried) {
      this.setState({ autoRetried: true })
      this.retryTimer = window.setTimeout(() => {
        this.setState({ error: null })
      }, AUTO_RETRY_MS)
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer)
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className={this.props.className}>
          <span>dsh-better-sidebar: {this.state.error}</span>
          <button
            type="button"
            className={css.terminalRetry}
            onClick={() => { this.setState({ error: null }) }}
          >
            {t('terminalRetry')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
