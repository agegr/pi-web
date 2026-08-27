/**
 * The source-control panel: status list (staged vs unstaged), stage/unstage,
 * commit with a message box, branch switch, and a VSCode-like history — rows
 * carry branch decorations, author and relative time. Clicking a changed
 * file or a history row opens a dedicated diff TAB (see {@link DiffTab}),
 * placed below the git pane on first use. File rows and history rows open a
 * right-click context menu with advanced operations (open in editor, discard,
 * revert, cherry-pick, copy paths/hashes). Refresh is manual + on mount/
 * focus. While visible it polls lightweight porcelain state so model-authored
 * file changes appear without a manual refresh.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  Button, IconBranchOutline16, IconCodeOutline16, IconCopyOutline16, IconRefreshOutline16,
  IconTrashOutline16, Input, Menu, Modal, writeClipboard,
} from "./ui-primitives"
import type { GitLogEntry, GitStatusEntry, GitStatusResult, GitWorktree, SessionScope } from './api'
import { api } from './api'
import { isWithinWorkspace, relativeTo } from './paths'
import { resolveSidebarPath } from './produced-files'
import { relativeTime, t } from './locales'
import type { SidebarTab } from './state'
import css from './sidebar.module.css'

/** The XY status letters a row badge shows (X = index, Y = worktree). */
function badgeOf(entry: GitStatusEntry): string {
  const index = entry.xy[0]
  const worktree = entry.xy[1]
  if (index !== undefined && index !== ' ' && index !== '?') return index
  if (worktree !== undefined && worktree !== ' ' && worktree !== '?') return worktree
  return '?'
}

/** Whether the entry carries STAGED (index) changes — the X letter is set. */
function isStagedEntry(entry: GitStatusEntry): boolean {
  const index = entry.xy[0]
  return index !== undefined && index !== ' ' && index !== '?'
}

/** Whether the entry carries UNSTAGED (worktree) changes — the Y letter is set
 *  (untracked `??` counts as unstaged: it is a worktree-only change). A file
 *  with both letters set ('MM') lands in BOTH sections. */
function isUnstagedEntry(entry: GitStatusEntry): boolean {
  if (entry.xy === '??') return true
  const worktree = entry.xy[1]
  return worktree !== undefined && worktree !== ' ' && worktree !== '?'
}

/** Whether the entry is untracked (`??`): git diff never includes it. */
function isUntracked(entry: GitStatusEntry): boolean {
  return badgeOf(entry) === '?'
}

/** The last path segment (tab title for a file's diff). */
function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** The ref names of one log row's decorations (`HEAD -> main` → `main`), deduped. */
function refNames(refs: string): string[] {
  return [...new Set(
    refs
      .split(',')
      .map(ref => ref.trim())
      .filter(ref => ref !== '')
      .map(ref => (ref.includes(' -> ') ? ref.slice(ref.indexOf(' -> ') + 4) : ref))
      .map(ref => (ref.startsWith('tag: ') ? ref.slice(5) : ref)),
  )]
}

/** The pending destructive action (discard / revert / cherry-pick), gated by a confirm modal. */
interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => Promise<unknown>
}

/** History batch size: the log loads lazily in pages so a long history never
 *  floods the panel at once (the end of the log is reached by paging). */
const LOG_BATCH = 20

export function GitView(props: {
  scope: SessionScope
  onOpenFile: (path: string) => void
  /** Open a diff tab (the shell places it below the git pane on first use). */
  onOpenDiff: (tab: SidebarTab) => void
  /** Poll only while the tab is actually visible. */
  visible: boolean
}) {
  const { scope, onOpenFile, onOpenDiff, visible } = props
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [selectedWorktree, setSelectedWorktree] = useState<string | undefined>()
  const [repoRoot, setRepoRoot] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [branchNames, setBranchNames] = useState<string[]>([])
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([])
  const [commitMsg, setCommitMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  /** Whether the history was fully paged (a batch shorter than LOG_BATCH). */
  const [logEnded, setLogEnded] = useState(false)
  const [logLoadingMore, setLogLoadingMore] = useState(false)

  /** The open file-row context menu (cursor position for the portaled Menu). */
  const [fileMenu, setFileMenu] = useState<{ entry: GitStatusEntry; staged: boolean; x: number; y: number } | null>(null)
  /** The open history-row context menu. */
  const [historyMenu, setHistoryMenu] = useState<{ entry: GitLogEntry; x: number; y: number } | null>(null)
  /** The pending destructive action awaiting confirmation. */
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const refreshInFlight = useRef(false)
  /** Monotonic request id: a manual worktree switch invalidates any older poll
   *  before it can publish state from the previous checkout. */
  const refreshGeneration = useRef(0)
  const worktreeChosenByUser = useRef(false)
  /** selectedWorktree read inside refresh without re-creating the callback:
   *  avoids a spurious full refresh on every auto-select (the very state
   *  change refresh writes back via setSelectedWorktree would recreate the
   *  callback and re-trigger the mount effect — an N→N+1 fetch loop). */
  const selectedRef = useRef<string | undefined>(undefined)
  useEffect(() => { selectedRef.current = selectedWorktree }, [selectedWorktree])

  const gitScope: SessionScope = repoRoot === undefined ? scope : { ...scope, repoRoot }

  /** Publish a complete checkout-derived view. Status, branch choices and
   *  history are one consistency unit: never mix rows from two worktrees. */
  const refreshTarget = useCallback(async (
    target: string | undefined,
    options: { loading: boolean; generation: number },
  ): Promise<void> => {
    if (options.loading) setLoading(true)
    setError(null)
    try {
      const [statusResult, branchResult, logResult] = await Promise.all([
        api.gitStatus(gitScope, target),
        api.gitBranch(gitScope, target).catch(() => ({ current: '', names: [] as string[] })),
        api.gitLog(gitScope, LOG_BATCH, 0, target).catch(() => [] as GitLogEntry[]),
      ])
      if (options.generation !== refreshGeneration.current) return
      setStatus(statusResult)
      if (statusResult.root !== undefined && statusResult.root !== repoRoot) setRepoRoot(statusResult.root)
      setBranchNames(branchResult.names)
      setLogEntries(logResult)
      setLogEnded(logResult.length < LOG_BATCH)
    } catch (reason) {
      if (options.generation === refreshGeneration.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (options.loading && options.generation === refreshGeneration.current) setLoading(false)
    }
  }, [scope.sessionId, scope.cwd, repoRoot])

  const refresh = useCallback(async (silent = false): Promise<void> => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    let generation = refreshGeneration.current
    try {
      const listed = await api.gitWorktrees(scope)
      if (generation !== refreshGeneration.current) return
      setWorktrees(listed)
      const selectedStillExists = listed.some(entry => entry.path === selectedRef.current)
      let target = selectedStillExists ? selectedRef.current : listed.find(entry => entry.current)?.path
      // DSH and other coding agents commonly create one linked checkout while
      // the session remains rooted at the clean primary checkout. Select that
      // checkout automatically only when the choice is unambiguous.
      const current = listed.find(entry => entry.current)
      const dirtyLinked = listed.filter(entry => !entry.current && entry.changes > 0)
      if (!worktreeChosenByUser.current) {
        target = (current?.changes ?? 0) === 0 && dirtyLinked.length === 1
          ? dirtyLinked[0]!.path
          : current?.path
      }
      const targetChanged = target !== selectedRef.current
      if (targetChanged) {
        // Changing the automatically selected checkout invalidates any direct
        // target refresh that may still be resolving for the previous one.
        generation = refreshGeneration.current += 1
        selectedRef.current = target
        setSelectedWorktree(target)
        // Remove rows owned by the previous checkout immediately: keeping them
        // interactive while the target changes could apply a destructive action
        // to the new checkout with stale history from the old one.
        setStatus(null)
        setBranchNames([])
        setLogEntries([])
        setLogEnded(false)
        setLogLoadingMore(false)
      }
      // A poll may update status alone only while staying on the same checkout.
      // Any automatic selection change refreshes the complete derived view.
      if (silent && !targetChanged) {
        const statusResult = await api.gitStatus(gitScope, target)
        if (generation === refreshGeneration.current) setStatus(statusResult)
        return
      }
      await refreshTarget(target, { loading: !silent, generation })
    } catch (reason) {
      if (generation === refreshGeneration.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
        if (!silent) setLoading(false)
      }
    } finally {
      refreshInFlight.current = false
    }
  }, [scope.sessionId, scope.cwd, refreshTarget])

  useEffect(() => {
    refreshGeneration.current += 1
    refreshInFlight.current = false
    worktreeChosenByUser.current = false
    selectedRef.current = undefined
    setSelectedWorktree(undefined)
  }, [scope.sessionId, scope.cwd])
  useEffect(() => { void refresh() }, [refresh])

  /** A user choice invalidates any older poll and atomically refreshes every
   *  checkout-derived surface before destructive history actions can run. */
  const chooseWorktree = (target: string): void => {
    worktreeChosenByUser.current = true
    selectedRef.current = target
    setSelectedWorktree(target)
    setStatus(null)
    setBranchNames([])
    setLogEntries([])
    setLogEnded(false)
    setLogLoadingMore(false)
    const generation = refreshGeneration.current += 1
    void refreshTarget(target, { loading: true, generation })
  }
  /** Switching the selected child repository must invalidate every
   *  target-derived surface (status/history/log) before the asynchronous
   *  refresh resolves; otherwise stale rows remain actionable while their
   *  handlers already address the new repository. Mirrors chooseWorktree. */
  const chooseRepo = (target: string): void => {
    setRepoRoot(target)
    setStatus(null)
    setBranchNames([])
    setLogEntries([])
    setLogEnded(false)
    setLogLoadingMore(false)
    // Re-list worktrees for the selected child (a workspace container's
    // own worktree list is empty); keep the current linked-checkout choice
    // unless it does not belong to the new repository.
    const generation = refreshGeneration.current += 1
    void refreshTarget(selectedRef.current ?? '', { loading: true, generation })
  }
  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => { void refresh(true) }, 2_000)
    return () => { window.clearInterval(timer) }
  }, [visible, refresh])

  /** Append the next history page (lazy: only when the user asks for more). */
  const loadMoreLog = async (): Promise<void> => {
    if (logLoadingMore || logEnded) return
    const generation = refreshGeneration.current
    const target = selectedRef.current
    setLogLoadingMore(true)
    try {
      const next = await api.gitLog(gitScope, LOG_BATCH, logEntries.length, target)
      // A worktree switch clears the old history and increments generation.
      // Never append a late page from that checkout into the new one.
      if (generation !== refreshGeneration.current || target !== selectedRef.current) return
      setLogEntries(entries => [...entries, ...next])
      if (next.length < LOG_BATCH) setLogEnded(true)
    } catch (reason) {
      if (generation === refreshGeneration.current && target === selectedRef.current) {
        setCommitError(`${t('historyLoadError')}: ${reason instanceof Error ? reason.message : String(reason)}`)
      }
    } finally {
      if (generation === refreshGeneration.current && target === selectedRef.current) setLogLoadingMore(false)
    }
  }

  /** The diff tab for one changed file (one tab per path+side; same id = focused). */
  const openWorktreeDiff = (entry: GitStatusEntry, staged: boolean): void => {
    onOpenDiff({
      id: `diff:w:${encodeURIComponent(selectedWorktree ?? '')}:${staged ? 's' : 'u'}:${entry.path}`,
      type: 'diff',
      title: baseName(entry.path),
      diff: { kind: 'worktree', path: entry.path, staged, untracked: isUntracked(entry), worktree: selectedWorktree, repoRoot },
    })
  }

  /** The diff tab for one commit (one tab per commit). */
  const openCommitDiff = (entry: GitLogEntry): void => {
    onOpenDiff({
      id: `diff:c:${encodeURIComponent(selectedWorktree ?? '')}:${entry.hashFull}`,
      type: 'diff',
      title: `${entry.hash} ${entry.subject}`,
      diff: { kind: 'commit', hash: entry.hash, hashFull: entry.hashFull, subject: entry.subject, worktree: selectedWorktree, repoRoot },
    })
  }

  const stageEntry = async (entry: GitStatusEntry, staged: boolean): Promise<void> => {
    setBusy(true)
    try {
      if (staged) await api.gitUnstage(gitScope, entry.path, selectedWorktree)
      else await api.gitStage(gitScope, entry.path, selectedWorktree)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const stageAll = async (staged: boolean): Promise<void> => {
    setBusy(true)
    try {
      if (staged) await api.gitUnstage(gitScope, undefined, selectedWorktree)
      else await api.gitStage(gitScope, undefined, selectedWorktree)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const commit = async (): Promise<void> => {
    const message = commitMsg.trim()
    if (message === '' || busy) return
    setBusy(true)
    setCommitError(null)
    try {
      await api.gitCommit(gitScope, message, selectedWorktree)
      setCommitMsg('')
      await refresh()
    } catch (reason) {
      setCommitError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const checkout = async (branch: string): Promise<void> => {
    if (branch === status?.branch || busy) return
    setBusy(true)
    setCommitError(null)
    try {
      await api.gitCheckout(gitScope, branch, selectedWorktree)
      await refresh()
    } catch (reason) {
      setCommitError(`${t('checkoutError')}: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  /** Run one destructive operation after the confirm modal, then refresh. */
  const runConfirmed = (confirmState: ConfirmState): void => {
    setConfirm({ ...confirmState, onConfirm: async () => {
      setBusy(true)
      setCommitError(null)
      try {
        await confirmState.onConfirm()
        await refresh()
      } catch (reason) {
        setCommitError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setBusy(false)
      }
    } })
  }

  /** Copy `text` to the clipboard (best-effort; no visual feedback needed — the menu closes). */
  const copy = (text: string): void => {
    void writeClipboard(text)
  }

  const openFileMenu = (event: MouseEvent, entry: GitStatusEntry, staged: boolean): void => {
    event.preventDefault()
    event.stopPropagation()
    setFileMenu({ entry, staged, x: event.clientX, y: event.clientY })
  }

  const openHistoryMenu = (event: MouseEvent, entry: GitLogEntry): void => {
    event.preventDefault()
    event.stopPropagation()
    setHistoryMenu({ entry, x: event.clientX, y: event.clientY })
  }

  const stagedEntries = (status?.entries ?? []).filter(isStagedEntry)
  const unstagedEntries = (status?.entries ?? []).filter(isUnstagedEntry)

  const renderEntry = (entry: GitStatusEntry, staged: boolean): ReactNode => {
    return (
      <div key={`${staged ? 's' : 'u'}:${entry.path}`} className={css.gitRow}>
        <button
          type="button"
          className={css.gitRowMain}
          title={entry.path}
          onClick={() => { openWorktreeDiff(entry, staged) }}
          onContextMenu={(event) => { openFileMenu(event, entry, staged) }}
        >
          <span className={css.gitBadge}>{badgeOf(entry)}</span>
          <span className={css.gitName}>{entry.path}</span>
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={staged ? t('unstage') : t('stage')}
          title={staged ? t('unstage') : t('stage')}
          disabled={busy}
          onClick={() => { void stageEntry(entry, staged) }}
        >
          {staged ? <IconTrashOutline16 /> : <IconBranchOutline16 />}
        </button>
      </div>
    )
  }

  return (
    <div className={css.git}>
      {worktrees.length > 1 && (
        <div className={css.gitWorktreeRow}>
          <span className={css.gitWorktreeLabel}>{t('worktree')}</span>
          <select
            className={css.gitBranchSelect}
            value={selectedWorktree ?? ''}
            title={selectedWorktree}
            disabled={busy}
            onChange={(event) => { chooseWorktree(event.target.value) }}
          >
            {worktrees.map(entry => (
              <option key={entry.path} value={entry.path}>
                {entry.branch} · {baseName(entry.path)} ({entry.changes})
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={css.gitHeader}>
        {(status?.repositories?.length ?? 0) > 1 && (
          <select
            className={css.gitBranchSelect}
            value={repoRoot ?? ''}
            title={repoRoot}
            onChange={(event) => { chooseRepo(event.target.value) }}
            disabled={busy}
          >
            {status!.repositories!.map(root => <option key={root} value={root}>{baseName(root)}</option>)}
          </select>
        )}
        <select
          className={css.gitBranchSelect}
          value={status?.branch ?? ''}
          onChange={(event) => { void checkout(event.target.value) }}
          disabled={busy || (status !== null && !status.isRepo)}
        >
          {(status?.branch ?? '') !== '' && <option value={status!.branch}>{status!.branch}</option>}
          {branchNames.filter(name => name !== status?.branch).map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={() => { void refresh() }}
        >
          <IconRefreshOutline16 size={14} />
        </button>
      </div>

      {loading && <div className={css.gitPlaceholder}>{t('loading')}</div>}
      {!loading && error !== null && <div className={css.gitError}>{error}</div>}
      {!loading && status !== null && !status.isRepo && (
        <div className={css.gitPlaceholder}>{t('notRepo')}</div>
      )}

      {status !== null && status.isRepo && (
        <>
          {status.truncated === true && (
            <div className={css.gitEmpty}>{t('statusTruncated')}</div>
          )}
          <div className={css.gitSection}>
            <div className={css.gitSectionHeader}>
              <span>{t('staged')} ({stagedEntries.length})</span>
              {stagedEntries.length > 0 && (
                <button type="button" className={css.gitLink} disabled={busy} onClick={() => { void stageAll(true) }}>
                  {t('unstageAll')}
                </button>
              )}
            </div>
            {stagedEntries.length === 0 && <div className={css.gitEmpty}>{t('noChanges')}</div>}
            {stagedEntries.map(entry => renderEntry(entry, true))}
          </div>
          <div className={css.gitSection}>
            <div className={css.gitSectionHeader}>
              <span>{t('unstaged')} ({unstagedEntries.length})</span>
              {unstagedEntries.length > 0 && (
                <button type="button" className={css.gitLink} disabled={busy} onClick={() => { void stageAll(false) }}>
                  {t('stageAll')}
                </button>
              )}
            </div>
            {unstagedEntries.length === 0 && <div className={css.gitEmpty}>{t('noChanges')}</div>}
            {unstagedEntries.map(entry => renderEntry(entry, false))}
          </div>

          <div className={css.gitCommit}>
            <Input
              className={css.gitCommitInput}
              placeholder={t('commitPlaceholder')}
              value={commitMsg}
              disabled={busy}
              onChange={(event: any) => { setCommitMsg(event.target.value); setCommitError(null) }}
              onKeyDown={(event: any) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void commit()
              }}
            />
            <button
              type="button"
              className={css.gitCommitButton}
              disabled={busy || commitMsg.trim() === '' || stagedEntries.length === 0}
              onClick={() => { void commit() }}
            >
              {t('commit')}
            </button>
          </div>
          {commitError !== null && <div className={css.gitError}>{commitError}</div>}

          <div className={css.gitSection}>
            <div className={css.gitSectionHeader}><span>{t('history')}</span></div>
            {logEntries.map(entry => (
              <div
                key={entry.hashFull}
                role="button"
                tabIndex={0}
                className={css.gitLogRow}
                title={`${entry.author} · ${entry.date}\n${entry.hashFull}`}
                onClick={() => { openCommitDiff(entry) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openCommitDiff(entry)
                  }
                }}
                onContextMenu={(event) => { openHistoryMenu(event, entry) }}
              >
                <span className={css.gitLogLine1}>
                  <span className={css.gitLogHash}>{entry.hash}</span>
                  <span className={css.gitLogSubject}>{entry.subject}</span>
                </span>
                <span className={css.gitLogLine2}>
                  {refNames(entry.refs).map(ref => (
                    <span key={ref} className={css.gitLogRef}>{ref}</span>
                  ))}
                  <span className={css.gitLogMeta}>{entry.author} · {relativeTime(entry.date)}</span>
                </span>
              </div>
            ))}
            {!logEnded && (
              <button
                type="button"
                className={css.gitLogMore}
                disabled={logLoadingMore || busy}
                onClick={() => { void loadMoreLog() }}
              >
                {logLoadingMore ? t('loading') : t('loadMore')}
              </button>
            )}
          </div>

          {/*
            The one shared file-row context menu, positioned at the right-click
            cursor (portal so the panel's overflow clip cannot crop it).
          */}
          <Menu
            open={fileMenu !== null}
            onClose={() => { setFileMenu(null) }}
            items={[
              // A linked worktree outside the session workspace cannot be
              // opened in the editor: the host's workspace fence rejects
              // every path under it. Hide the action for that checkout so
              // the menu does not offer a no-op that confuses the user.
              ...(fileMenu !== null && isWithinWorkspace(scope.cwd ?? '', resolveSidebarPath(repoRoot ?? selectedWorktree ?? scope.cwd, fileMenu.entry.path))
                ? [{ id: 'open', label: t('openEditor'), icon: <IconCodeOutline16 size={14} /> }]
                : []),
              fileMenu?.staged === true
                ? { id: 'stage', label: t('unstage'), icon: <IconTrashOutline16 size={14} /> }
                : { id: 'stage', label: t('stage'), icon: <IconBranchOutline16 size={14} /> },
              ...(fileMenu !== null && !isUntracked(fileMenu.entry)
                ? [{ id: 'discard', label: t('discard'), icon: <IconTrashOutline16 size={14} />, danger: true }]
                : []),
              { type: 'separator', id: 'sep1' },
              { id: 'relative', label: t('copyRelative'), icon: <IconCopyOutline16 size={14} /> },
              { id: 'absolute', label: t('copyAbsolute'), icon: <IconCopyOutline16 size={14} /> },
            ]}
            onSelect={(id) => {
              const target = fileMenu
              if (target === null) return
              setFileMenu(null)
              if (id === 'open') {
                const resolved = resolveSidebarPath(repoRoot ?? selectedWorktree ?? scope.cwd, target.entry.path)
                // Defense-in-depth: the menu hides this action when the
                // resolved path escapes the session workspace, but a
                // racing repo switch could still reach here with a path
                // the host would reject. No-op in that case.
                if (!isWithinWorkspace(scope.cwd ?? '', resolved)) return
                onOpenFile(resolved)
                return
              }
              if (id === 'stage') {
                void stageEntry(target.entry, target.staged)
                return
              }
              if (id === 'discard') {
                runConfirmed({
                  title: t('discardTitle'),
                  description: t('discardDesc', { path: target.entry.path }),
                  confirmLabel: t('discard'),
                  onConfirm: () => api.gitDiscard(gitScope, target.entry.path, selectedWorktree),
                })
                return
              }
              if (id === 'relative') {
                copy(relativeTo(repoRoot ?? selectedWorktree ?? scope.cwd ?? '', target.entry.path))
                return
              }
              if (id === 'absolute') copy(resolveSidebarPath(repoRoot ?? selectedWorktree ?? scope.cwd, target.entry.path))
            }}
            portal
            align="start"
            getAnchorRect={() => (fileMenu === null ? null : new DOMRect(fileMenu.x, fileMenu.y, 0, 0))}
            anchor={<span />}
          />

          {/* The shared history-row context menu. */}
          <Menu
            open={historyMenu !== null}
            onClose={() => { setHistoryMenu(null) }}
            items={[
              { id: 'view', label: t('viewCommitDiff') },
              { id: 'copyShort', label: t('copyShortHash'), icon: <IconCopyOutline16 size={14} /> },
              { id: 'copyFull', label: t('copyFullHash'), icon: <IconCopyOutline16 size={14} /> },
              { id: 'copySubject', label: t('copySubject'), icon: <IconCopyOutline16 size={14} /> },
              { type: 'separator', id: 'sep2' },
              { id: 'revert', label: t('revertCommit'), danger: true },
              { id: 'cherryPick', label: t('cherryPickCommit'), danger: true },
            ]}
            onSelect={(id) => {
              const target = historyMenu
              if (target === null) return
              setHistoryMenu(null)
              if (id === 'view') {
                openCommitDiff(target.entry)
                return
              }
              if (id === 'copyShort') {
                copy(target.entry.hash)
                return
              }
              if (id === 'copyFull') {
                copy(target.entry.hashFull)
                return
              }
              if (id === 'copySubject') {
                copy(target.entry.subject)
                return
              }
              if (id === 'revert') {
                runConfirmed({
                  title: t('revertTitle'),
                  description: t('revertDesc', { subject: target.entry.subject }),
                  confirmLabel: t('revertCommit'),
                  onConfirm: () => api.gitRevert(gitScope, target.entry.hashFull, selectedWorktree),
                })
                return
              }
              if (id === 'cherryPick') {
                runConfirmed({
                  title: t('cherryPickTitle'),
                  description: t('cherryPickDesc', { subject: target.entry.subject }),
                  confirmLabel: t('cherryPickCommit'),
                  onConfirm: () => api.gitCherryPick(gitScope, target.entry.hashFull, selectedWorktree),
                })
              }
            }}
            portal
            align="start"
            getAnchorRect={() => (historyMenu === null ? null : new DOMRect(historyMenu.x, historyMenu.y, 0, 0))}
            anchor={<span />}
          />

          {/* Destructive actions land here first: Cancel / Confirm. */}
          <Modal
            open={confirm !== null}
            onClose={() => { setConfirm(null) }}
            title={confirm?.title ?? ''}
            closeLabel={t('cancel')}
            footer={(
              <>
                <Button variant="outline" onClick={() => { setConfirm(null) }}>{t('cancel')}</Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    const pending = confirm
                    if (pending === null) return
                    setConfirm(null)
                    void pending.onConfirm()
                  }}
                >
                  {confirm?.confirmLabel ?? ''}
                </Button>
              </>
            )}
          >
            <p className={css.gitConfirmDesc}>{confirm?.description}</p>
          </Modal>
        </>
      )}
    </div>
  )
}
