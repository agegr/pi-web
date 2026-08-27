/**
 * Subagent page: the FULL agent topology of the current tree's main session.
 *
 * The root is resolved by walking the durable parent chain upward from the
 * current session to the first non-subagent session — the MAIN session — and
 * every subagent under it shares this one topology view, no matter how deep
 * the current selection is (including a subagent transcript opened in the
 * main view). The main agent renders as the root node card (click it to jump
 * back to the main session), with its subagents hanging below it in clearly
 * LAYERED levels: tree connector lines (first level included) and per-level
 * indentation show the hierarchy, and the currently-open session is
 * highlighted in place. Every branch is expanded automatically (lazy
 * catalogs hydrate on demand and consume live membership while visible).
 *
 * Each node card carries live status (state dot, durable label, mode and
 * activity); while a child RUNS, its card additionally shows the LAST text
 * output and LAST tool call pulled from its history tail, auto-refreshing
 * every few seconds while the page is visible. Clicking a card jumps
 * straight into the child transcript (`openSubagent`); the page stays open
 * and the topology remains rooted at the main session.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  IconRefreshOutline14, StateDot,
} from "./ui-primitives"
import type {
  Context,
  SidebarSessionList,
  SidebarSessionSummary,
  SidebarSubagentAddress,
  SidebarSubagentCatalog,
  SidebarSubagentChildEntry,
  SidebarSubagentDiagnosticEntry,
  SidebarJobView,
} from './context-types'
import {
  collectBranchIds,
  countSubagentDescendants,
  isSideThreadSummary,
  rootAncestor,
} from './subagent-detect'
import { type LastActivity } from './subagent-activity'
import { SIDE_LABEL_PREFIX } from './sidechat-core'
import {
  collectTreeJobs,
  formatJobDuration,
  isJobLive,
  orderJobs,
  jobDotState,
  jobStatusLabel,
  type TreeJob,
} from './subagent-jobs'
import { api, type JobOutputResult } from './api'
import { IconStopOutline16 } from './icons'
import { t } from './locales'
import css from './SubagentView.module.css'

/** Refresh cadence of the live "last text + tool call" lines while a child runs. */
const POLL_MS = 3000
/** Preview cap of one tool-call argument line. */
const ARGS_PREVIEW = 60
/** Refresh cadence of an expanded job-output panel while its job runs. */
const JOB_POLL_MS = 2000
/** How long the kill button stays armed before it needs re-confirming. */
const JOB_KILL_ARM_MS = 3000
/** Stable fallback for a missing sessions store (uSES snapshot identity
 *  must be stable across calls; a fresh literal would loop the hook). */
const EMPTY_SESSION_LIST = { current: undefined, byId: {} }

/** The direct subagent children of one parent (durable `origin` rows;
 *  Side Chat threads ride the same origin but are tab-strip conversations,
 *  never topology). */
function directChildren(
  byId: Readonly<Record<string, SidebarSessionSummary>>,
  parentSessionId: string,
): SidebarSessionSummary[] {
  return Object.values(byId).filter(
    summary => summary.origin === 'subagent' && summary.parentId === parentSessionId
      && !isSideThreadSummary(summary),
  )
}

/** Human label of one catalog child: durable label, then summary title, then id. */
function childLabel(
  entry: SidebarSubagentChildEntry,
  summary: SidebarSessionSummary | undefined,
): string {
  return entry.label ?? summary?.displayTitle ?? entry.id
}

function diagnosticReason(entry: SidebarSubagentDiagnosticEntry): string {
  switch (entry.reason) {
    case 'corrupt': return t('subagentDiagCorrupt')
    case 'unsupported': return t('subagentDiagUnsupported')
    case 'unavailable': return t('subagentDiagUnavailable')
    default: return entry.message ?? ''
  }
}

/** The secondary line of one card: title · mode · activity (skips empty parts). */
function cardSecondary(
  summary: SidebarSessionSummary | undefined,
  entry: SidebarSubagentChildEntry,
): string {
  return [
    summary?.displayTitle,
    entry.mode === 'one-shot' ? t('subagentModeOneShot') : t('subagentModeContinuable'),
    entry.activity === 'running' ? t('subagentRunning') : t('subagentInactive'),
  ].filter(Boolean).join(' · ')
}

/** First `limit` characters with an ellipsis when truncated. */
function preview(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** Collapse whitespace for the single-paragraph live-text preview. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Disabled "loading…" cards backed by the summary mirror while a catalog hydrates. */
function CatalogLoadingRows(props: {
  parentSessionId: string
  byId: Readonly<Record<string, SidebarSessionSummary>>
  level: number
}) {
  const { parentSessionId, byId, level } = props
  const children = directChildren(byId, parentSessionId)
  if (children.length === 0) {
    return <div className={css.subagentEmpty}>{t('loading')}</div>
  }
  return (
    <>
      {children.map(summary => (
        <div
          key={summary.id}
          role="treeitem"
          aria-disabled="true"
          aria-level={level}
          aria-label={t('loading')}
          className={`${css.subagentRow} ${css.subagentRowDisabled} ${css.subagentRowLoading}`}
        >
          <StateDot state={summary.running === true ? 'ongoing' : 'done'} className={css.subagentDot} />
          <span className={css.subagentContent}>
            <span className={css.subagentLabel}>{t('loading')}</span>
          </span>
        </div>
      ))}
    </>
  )
}

/**
 * The live lines of one RUNNING subagent card: a pure presentation of the
 * batch `subagents.live` activity. The polling lives in one place (the
 * SubagentView hook), not per card. A running child with neither output yet
 * reads "thinking…".
 */
function SubagentLiveLines(props: { live: LastActivity | undefined }) {
  const { live } = props
  if (live?.text === undefined && live?.tool === undefined) {
    return <span className={css.subagentLive}>{t('subagentThinking')}</span>
  }
  return (
    <>
      {live.tool !== undefined && (
        <span className={css.subagentLive}>
          <span className={css.subagentLiveTool}>{live.tool.name}</span>
          {live.tool.args !== '' && (
            <span className={css.subagentLiveArgs}>{preview(live.tool.args, ARGS_PREVIEW)}</span>
          )}
        </span>
      )}
      {live.text !== undefined && (
        <span className={css.subagentLiveText}>{flatten(live.text)}</span>
      )}
    </>
  )
}

/**
 * One shared live-preview poller for the whole Subagent tree. Unlike the old
 * per-card `subagents.history` timers, this sends at most ONE `subagents.live`
 * request at a time: a recursive timeout starts only after the previous
 * request settles, so a slow host never sees abort/restart storms.
 */
function useSubagentLive(
  rootId: string | undefined,
  active: boolean,
): Readonly<Record<string, LastActivity>> {
  const [live, setLive] = useState<Record<string, LastActivity>>({})
  const controllerRef = useRef<AbortController | undefined>(undefined)

  // A new tree must never inherit another root's live previews.
  useEffect(() => { setLive({}) }, [rootId])

  useEffect(() => {
    if (rootId === undefined || !active) return
    const targetRootId = rootId
    let disposed = false
    let timer: number | undefined

    const schedule = (): void => {
      if (disposed) return
      timer = window.setTimeout(() => { void load() }, POLL_MS)
    }
    async function load(): Promise<void> {
      if (disposed) return
      const controller = new AbortController()
      controllerRef.current = controller
      try {
        const result = await api.subagentsLive(targetRootId, controller.signal)
        if (!disposed) setLive(result.live)
      } catch {
        // Keep the last known live map; the next scheduled poll retries.
      } finally {
        if (controllerRef.current === controller) controllerRef.current = undefined
        if (!disposed) schedule()
      }
    }

    void load()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      controllerRef.current?.abort()
      controllerRef.current = undefined
    }
  }, [rootId, active])

  return live
}

interface RowsProps {
  parentSessionId: string
  catalog: SidebarSubagentCatalog | undefined
  catalogs: Readonly<Record<string, SidebarSubagentCatalog>>
  byId: Readonly<Record<string, SidebarSessionSummary>>
  level: number
  /** The currently-open session id (highlighted in the topology). */
  currentSessionId: string
  /** The batch live-preview map (child id → latest activity). */
  live: Readonly<Record<string, LastActivity>>
  openChild: (address: SidebarSubagentAddress) => void
  refresh: (parentSessionId: string) => void
}

/** Render one topology level; branches are always expanded (lazy catalogs). */
function CatalogRows({
  parentSessionId, catalog, catalogs, byId, level, currentSessionId, live,
  openChild, refresh,
}: RowsProps) {
  const emptyLoading = catalog?.state === 'loading' && catalog.entries.length === 0
  // Side Chat threads are honest catalog citizens (durable descriptor, 'Side: '
  // label) but they are NOT subagent topology — filter them out here (the tab
  // strip owns them). Legacy threads created before the descriptor fix still
  // arrive as corrupt diagnostics; they are recognized by summary title.
  const visibleEntries = (catalog?.entries ?? []).filter((entry: any) => {
    if (entry.kind === 'child') return !(entry.label?.startsWith(SIDE_LABEL_PREFIX) ?? false)
    return !(byId[entry.id]?.displayTitle?.startsWith(SIDE_LABEL_PREFIX) ?? false)
  })
  return (
    <>
      {emptyLoading && (
        <CatalogLoadingRows parentSessionId={parentSessionId} byId={byId} level={level} />
      )}
      {catalog?.state === 'error' && (
        <div className={css.subagentError}>
          <span>{catalog.error?.message ?? t('error')}</span>
          <button
            type="button"
            className={css.subagentErrorRetry}
            onClick={() => { refresh(parentSessionId) }}
          >
            <IconRefreshOutline14 />
            {t('retry')}
          </button>
        </div>
      )}
      {visibleEntries.map((entry: any) => {
        if (entry.kind === 'diagnostic') {
          return (
            <div key={entry.id} className={css.subagentNode}>
              <div
                role="treeitem"
                aria-disabled="true"
                aria-level={level}
                className={`${css.subagentRow} ${css.subagentRowDisabled}`}
                title={diagnosticReason(entry)}
              >
                <StateDot state="error" className={css.subagentDot} />
                <span className={css.subagentContent}>
                  <span className={css.subagentLabel}>{entry.id}</span>
                  <span className={css.subagentSecondary}>{diagnosticReason(entry)}</span>
                </span>
              </div>
            </div>
          )
        }

        const childCatalog = catalogs[entry.id]
        const knownLeaf = !entry.hasChildren
        const summary = byId[entry.id]
        const label = childLabel(entry, summary)
        const secondary = cardSecondary(summary, entry)
        const childLoading = childCatalog === undefined
          || (childCatalog.state === 'loading' && childCatalog.entries.length === 0)
        const address: SidebarSubagentAddress = {
          parentSessionId,
          childSessionId: entry.id,
          mode: entry.mode,
        }
        const current = entry.id === currentSessionId

        return (
          <div key={entry.id} className={css.subagentNode}>
            <div
              role="treeitem"
              tabIndex={0}
              aria-level={level}
              aria-label={`${label} ${secondary}`}
              aria-current={current ? 'true' : undefined}
              {...knownLeaf ? {} : { 'aria-expanded': true }}
              className={clsx(css.subagentRow, current && css.subagentRowActive)}
              onClick={() => { openChild(address) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  openChild(address)
                }
              }}
            >
              <StateDot
                state={entry.activity === 'running' ? 'ongoing' : 'done'}
                className={css.subagentDot}
              />
              <span className={css.subagentContent}>
                <span className={css.subagentLabel}>{label}</span>
                <span className={css.subagentSecondary}>{secondary}</span>
                {entry.activity === 'running' && (
                  <SubagentLiveLines live={live[entry.id]} />
                )}
              </span>
            </div>
            {!knownLeaf && (
              <div role="group" className={css.subagentChildren} aria-busy={childLoading || undefined}>
                {childCatalog === undefined
                  ? (
                    <CatalogLoadingRows
                      parentSessionId={entry.id}
                      byId={byId}
                      level={level + 1}
                    />
                  )
                  : (
                    <CatalogRows
                      parentSessionId={entry.id}
                      catalog={childCatalog}
                      catalogs={catalogs}
                      byId={byId}
                      level={level + 1}
                      currentSessionId={currentSessionId}
                      live={live}
                      openChild={openChild}
                      refresh={refresh}
                    />
                  )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * The shared output dock of the jobs section: ONE pane at the bottom of the
 * sidebar body (sticky, terminal-like) shows the SELECTED job's output as
 * the MODEL has read it so far (replayed from the owner session's event
 * log), refreshed every {@link JOB_POLL_MS} while the job runs and the
 * page is visible. The model's `job_output` cursor is never touched — the
 * pane can never steal the agent's bytes, and it stays empty until the
 * agent reads the job. A single dock — not a panel per row — keeps the
 * job list compact and stable when many jobs are running.
 */
function JobOutputPane(props: {
  ownerSessionId: string
  job: SidebarJobView
  /** The page is visible (active tab + open panel): skip polling otherwise. */
  active: boolean
  onClose: () => void
}) {
  const { ownerSessionId, job, active, onClose } = props
  const [state, setState] = useState<'loading' | JobOutputResult | 'error'>('loading')
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const preRef = useRef<HTMLPreElement>(null)

  const load = useCallback(async (): Promise<void> => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const result = await api.jobOutput({ sessionId: ownerSessionId }, job.id, controller.signal)
      setState(result)
    } catch {
      // A newer pull aborted this one, or the wire failed: keep the last
      // known output; only a dock that never loaded anything shows an error.
      setState(current => (current === 'loading' ? 'error' : current))
    }
  }, [ownerSessionId, job.id])

  useEffect(() => {
    void load()
    if (!active || !isJobLive(job)) return
    const timer = window.setInterval(() => { void load() }, JOB_POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [load, active, job.status])

  useEffect(() => () => { controllerRef.current?.abort() }, [])

  // Terminal-tail behavior: while the job runs, each refresh pins the view
  // to the newest output; a settled dock leaves scrolling to the reader.
  useEffect(() => {
    if (!isJobLive(job) || typeof state !== 'object' || state.text.length === 0) return
    const pre = preRef.current
    if (pre !== null) pre.scrollTop = pre.scrollHeight
  }, [state, job.status])

  return (
    <div className={css.jobsPane} role="region" aria-label={`${job.label} ${t('jobs')}`}>
      <div className={css.jobsPaneHeader}>
        <StateDot state={jobDotState(job.status)} className={css.jobsPaneDot} />
        <span className={css.jobsPaneLabel} title={job.label}>{job.label}</span>
        <span className={css.jobsPaneStatus}>
          {jobStatusLabel(job.status, t)}
          {job.detail !== undefined && job.detail !== '' ? ` · ${job.detail}` : ''}
        </span>
        <button
          type="button"
          className={css.jobsPaneClose}
          aria-label={t('close')}
          title={t('close')}
          onClick={onClose}
        >
          <IconStopOutline16 size={10} />
        </button>
      </div>
      {state === 'loading' && <div className={css.jobsPaneHint}>{t('loading')}</div>}
      {state === 'error' && (
        <div className={`${css.jobsPaneHint} ${css.jobsPaneError}`}>{t('jobOutputError')}</div>
      )}
      {typeof state === 'object' && (
        <>
          {state.text.length > 0
            ? <pre ref={preRef} className={css.jobsPanePre}>{state.text}</pre>
            : state.read
              ? <div className={css.jobsPaneHint}>{t('jobNoOutput')}</div>
              : <div className={css.jobsPaneHint}>{t('jobNotReadYet')}</div>}
          {state.truncated && <div className={css.jobsPaneHint}>{t('jobOutputTruncated')}</div>}
        </>
      )}
    </div>
  )
}

/**
 * The background-job section of the Subagent page: every job of the whole
 * current tree (main agent + subagents, owner-labeled), fed by the harness
 * `session/jobs` push mirror. Clicking a row feeds its model-read output to
 * the shared bottom dock (event replay — never the model's cursor); live
 * rows carry a two-click-confirm kill button. Renders nothing while the
 * tree has no jobs.
 */
function JobsSection(props: {
  byId: SidebarSessionList['byId']
  jobsBySession: SidebarSessionList['jobsBySession']
  rootId: string | undefined
  /** The page is visible (active tab + open panel): skip polling otherwise. */
  active: boolean
}) {
  const { byId, jobsBySession, rootId, active } = props
  const rows = useMemo(
    () => orderJobs(collectTreeJobs(byId, jobsBySession, rootId)),
    [byId, jobsBySession, rootId],
  )
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [armedId, setArmedId] = useState<string | undefined>(undefined)
  const [killingId, setKillingId] = useState<string | undefined>(undefined)
  const [killErrorId, setKillErrorId] = useState<string | undefined>(undefined)
  // The duration clock only runs while a live row is on screen.
  const [now, setNow] = useState(() => Date.now())

  const selectedRow = useMemo(
    () => (selectedId === undefined ? undefined : rows.find(row => row.job.id === selectedId)),
    [rows, selectedId],
  )

  const liveCount = useMemo(
    () => rows.reduce((count, row) => count + (isJobLive(row.job) ? 1 : 0), 0),
    [rows],
  )
  const multiOwner = useMemo(
    () => new Set(rows.map(row => row.ownerSessionId)).size > 1,
    [rows],
  )

  // The kill button stays armed only briefly; a stray click must never kill.
  useEffect(() => {
    if (armedId === undefined) return
    const timer = window.setTimeout(() => { setArmedId(undefined) }, JOB_KILL_ARM_MS)
    return () => { window.clearTimeout(timer) }
  }, [armedId])

  useEffect(() => {
    if (liveCount === 0) return
    setNow(Date.now())
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { window.clearInterval(timer) }
  }, [liveCount])

  // The docked output pane follows its job: when the selected job leaves
  // the mirror (settled and dropped, or the tree switched), close the dock.
  useEffect(() => {
    if (selectedId !== undefined && selectedRow === undefined) setSelectedId(undefined)
  }, [selectedId, selectedRow])

  // NOTE: every hook must live ABOVE the empty-state return — a hook below it
  // would flip this component's hook count when the mirror empties and crash
  // React with "Rendered fewer hooks than expected" (the #300 regression).
  const kill = useCallback(async (row: TreeJob): Promise<void> => {
    setKillingId(row.job.id)
    setKillErrorId(undefined)
    try {
      await api.jobKill({ sessionId: row.ownerSessionId }, row.job.id)
    } catch {
      setKillErrorId(row.job.id)
    } finally {
      setKillingId(undefined)
      setArmedId(undefined)
    }
  }, [])

  if (rows.length === 0) return null

  const countLabel = liveCount > 0
    ? t('jobsCountRunning', { count: rows.length, running: liveCount })
    : t('jobsCount', { count: rows.length })

  return (
    <>
      <section className={css.jobs} aria-label={t('jobs')}>
        <div className={css.jobsHeader}>
          <span className={css.jobsTitle}>{t('jobs')}</span>
          <span className={css.jobsCount}>{countLabel}</span>
        </div>
        <ul className={css.jobsList} aria-label={t('jobs')}>
          {rows.map((row) => {
            const { job } = row
            const live = isJobLive(job)
            const selected = selectedId === job.id
            const armed = armedId === job.id
            const killing = killingId === job.id
            const killFailed = killErrorId === job.id
            const elapsed = live
              ? now - job.startedAt
              : (job.finishedAt ?? job.startedAt) - job.startedAt
            const secondary = [
              ...(multiOwner ? [row.ownerTitle] : []),
              jobStatusLabel(job.status, t),
              ...(job.detail !== undefined && job.detail !== '' ? [job.detail] : []),
              formatJobDuration(elapsed, t),
            ].filter(Boolean).join(' · ')
            return (
              <li
                key={job.id}
                className={clsx(
                  css.jobsRow,
                  !live && css.jobsRowSettled,
                  selected && css.jobsRowSelected,
                )}
              >
                <button
                  type="button"
                  className={css.jobsRowMain}
                  aria-pressed={selected}
                  aria-label={`${job.label} ${secondary}`}
                  onClick={() => { setSelectedId(selected ? undefined : job.id) }}
                >
                  <StateDot state={jobDotState(job.status)} className={css.jobsDot} />
                  <span className={css.jobsContent}>
                    <span className={css.jobsLabelLine}>
                      <span className={css.jobsKind}>{job.kind}</span>
                      <span className={css.jobsLabel} title={job.label}>{job.label}</span>
                    </span>
                    <span className={css.jobsSecondary}>{secondary}</span>
                  </span>
                </button>
                {job.status === 'running' && (
                  <button
                    type="button"
                    className={armed ? `${css.jobsKill} ${css.jobsKillArmed}` : css.jobsKill}
                    aria-label={armed ? t('jobKillConfirm') : t('jobKill')}
                    title={armed ? t('jobKillConfirm') : t('jobKill')}
                    disabled={killing}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (armed) void kill(row)
                      else setArmedId(job.id)
                    }}
                  >
                    {armed ? t('jobKillConfirm') : <IconStopOutline16 size={12} />}
                  </button>
                )}
                {killFailed && <span className={css.jobsKillError}>{t('jobKillError')}</span>}
              </li>
            )
          })}
        </ul>
      </section>
      {selectedRow !== undefined && (
        <JobOutputPane
          ownerSessionId={selectedRow.ownerSessionId}
          job={selectedRow.job}
          active={active}
          onClose={() => { setSelectedId(undefined) }}
        />
      )}
    </>
  )
}

/**
 * The sidebar's Subagent topology page.
 * @param props - current session id, whether the page is actually visible
 *   (active tab + open panel), the client context, and an optional
 *   jump-notify hook fired right before `openSubagent` (lets the sidebar
 *   shell re-open the Subagent page after the conversation switch lands on
 *   the child session).
 * @returns the main agent's topology tree, or the empty/error/loading states.
 */
export function SubagentView(props: {
  sessionId: string
  active: boolean
  ctx: Context
  onOpenChild?: (address: SidebarSubagentAddress) => void
}) {
  const { sessionId, active, ctx, onOpenChild } = props
  const sessions = ctx.sessions

  // The same list feed the official catalog consumes (byId lineage + the
  // lazy per-parent catalogs). Older DSH snapshots without the subagent seam
  // simply leave these surfaces empty — the page degrades to the empty state.
  // The store chain is dereferenced exactly once per call (no
  // check‑then‑act that could read a swapped store), and the fallback is a
  // module‑level constant so the snapshot object is stable across calls.
  const list = useSyncExternalStore(
    useMemo(() => (callback: () => void) => {
      const store = sessions?.list
      return typeof store?.subscribe === 'function' ? (store.subscribe(callback) ?? (() => {})) : (() => {})
    }, [sessions]),
    useCallback(() => {
      const list = sessions?.list;
      return typeof list?.getSnapshot === 'function'
        ? (list.getSnapshot() ?? EMPTY_SESSION_LIST)
        : EMPTY_SESSION_LIST;
    }, [sessions]),
    () => EMPTY_SESSION_LIST,
  )
  const byId = list.byId
  const catalogs = list.subagentsByParent ?? {}

  // The topology root: the main agent of the current session's tree.
  const rootId = useMemo(() => rootAncestor(byId, sessionId), [byId, sessionId])
  const rootCatalog = rootId === undefined ? undefined : catalogs[rootId]
  const rootSummary = rootId === undefined ? undefined : byId[rootId]
  const live = useSubagentLive(rootId, active)

  /** Catalog owners currently consuming live membership updates. */
  const observedRef = useRef(new Set<string>())

  const observe = useCallback((parentSessionId: string, open: boolean): void => {
    sessions.setSubagentCatalogOpen?.(parentSessionId, open)
    if (open) observedRef.current.add(parentSessionId)
    else observedRef.current.delete(parentSessionId)
  }, [sessions])

  // While the page is visible the topology root consumes live membership; a
  // root change (switching to another main agent's tree) or the page hiding
  // (tab switched away / panel collapsed) releases everything observed.
  useEffect(() => {
    if (rootId === undefined || !active) return
    observe(rootId, true)
    return () => {
      for (const parentSessionId of observedRef.current) {
        sessions.setSubagentCatalogOpen?.(parentSessionId, false)
      }
      observedRef.current.clear()
    }
  }, [rootId, active, observe, sessions])

  // Every branch of the always-expanded topology consumes live membership
  // (add-only: a branch stays observed until the root changes or the page
  // hides, which releases the whole set via the root effect's cleanup).
  const branches = useMemo(() => collectBranchIds(catalogs, rootId), [catalogs, rootId])
  useEffect(() => {
    if (!active) return
    for (const id of branches) {
      if (!observedRef.current.has(id)) observe(id, true)
    }
  }, [branches, active, observe])

  // Unobserve everything on unmount (the host stops refreshing unused catalogs).
  useEffect(() => () => {
    for (const parentSessionId of observedRef.current) {
      sessions.setSubagentCatalogOpen?.(parentSessionId, false)
    }
    observedRef.current.clear()
  }, [sessions])

  const openChild = useCallback((address: SidebarSubagentAddress): void => {
    // Notify the shell first: the jump switches the sidebar to the child
    // session's own layout, and the shell re-opens the Subagent page on top
    // of it (the topology stays rooted at the main agent with the child
    // highlighted) — the README "page stays open" contract.
    onOpenChild?.(address)
    try {
      sessions.openSubagent?.(address)
    } catch (error) {
      console.warn('[dsh-better-sidebar] openSubagent failed:', error)
    }
  }, [sessions, onOpenChild])

  /** Jump back to the main agent (the topology root) from its node. */
  const openMain = useCallback((): void => {
    if (rootId === undefined) return
    try {
      sessions.open?.(rootId)
    } catch (error) {
      console.warn('[dsh-better-sidebar] open session failed:', error)
    }
  }, [sessions, rootId])

  const refresh = useCallback((parentSessionId: string): void => {
    void sessions.refreshSubagents?.(parentSessionId)
  }, [sessions])

  const totals = useMemo(
    () => rootId === undefined
      ? { count: 0, runningCount: 0 }
      : countSubagentDescendants(byId, rootId),
    [byId, rootId],
  )
  // Session summaries can announce membership before the descriptor-backed
  // catalog catches up (or a catalog that just went ready is still empty).
  const summaryBackedLoading = rootId !== undefined
    && (rootCatalog === undefined || (rootCatalog.state === 'ready' && rootCatalog.entries.length === 0))
    && directChildren(byId, rootId).length > 0
  const readyEmpty = rootCatalog?.state === 'ready'
    && rootCatalog.entries.length === 0
    && directChildren(byId, rootId ?? '').length === 0
  const countLabel = totals.count === 0
    ? undefined
    : totals.runningCount > 0
      ? t('subagentCountRunning', { count: totals.count, running: totals.runningCount })
      : t('subagentCount', { count: totals.count })

  /** Arrow-key tree navigation over the visible rows (official catalog recipe). */
  const bodyRef = useRef<HTMLDivElement>(null)
  const focusAt = useCallback((index: number): void => {
    const items = bodyRef.current?.querySelectorAll<HTMLElement>(
      '[role="treeitem"]:not([aria-disabled="true"])',
    ) ?? []
    if (items.length === 0) return
    items[(index + items.length) % items.length]?.focus()
  }, [])
  const onTreeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    const items = bodyRef.current?.querySelectorAll<HTMLElement>(
      '[role="treeitem"]:not([aria-disabled="true"])',
    ) ?? []
    const index = Array.prototype.indexOf.call(items, document.activeElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(index < 0 ? items.length - 1 : index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(items.length - 1)
    }
  }, [focusAt])

  return (
    <div className={css.subagent}>
      <div className={css.subagentHeader}>
        <span className={css.subagentTitle}>
          {t('subagent')}
          {rootSummary?.displayTitle !== undefined && rootSummary.displayTitle !== ''
            ? ` · ${rootSummary.displayTitle}`
            : ''}
        </span>
        {countLabel !== undefined && <span className={css.subagentCount}>{countLabel}</span>}
        <button
          type="button"
          className={css.subagentRefresh}
          aria-label={t('refresh')}
          title={t('refresh')}
          disabled={rootId === undefined}
          onClick={() => { if (rootId !== undefined) refresh(rootId) }}
        >
          <IconRefreshOutline14 />
        </button>
      </div>
      <div
        ref={bodyRef}
        className={css.subagentBody}
        onKeyDown={onTreeKeyDown}
      >
        <div
          role="tree"
          aria-label={t('subagent')}
          aria-busy={summaryBackedLoading || undefined}
        >
          {rootId !== undefined && rootSummary !== undefined && (
            <div
              role="treeitem"
              tabIndex={0}
              aria-level={0}
              aria-label={`${rootSummary.displayTitle !== '' ? rootSummary.displayTitle : t('subagentMainAgent')} ${t('subagentMainAgent')}`}
              aria-current={rootId === sessionId ? 'true' : undefined}
              className={clsx(css.subagentRow, rootId === sessionId && css.subagentRowActive)}
              onClick={openMain}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  openMain()
                }
              }}
            >
              <StateDot
                state={rootSummary.running === true ? 'ongoing' : 'done'}
                className={css.subagentDot}
              />
              <span className={css.subagentContent}>
                <span className={css.subagentLabel}>
                  {rootSummary.displayTitle !== '' ? rootSummary.displayTitle : t('subagentMainAgent')}
                </span>
                <span className={css.subagentSecondary}>
                  {`${t('subagentMainAgent')} · ${rootSummary.running === true ? t('subagentRunning') : t('subagentInactive')}`}
                </span>
              </span>
            </div>
          )}
          {rootId !== undefined && (
            <div className={css.subagentChildren} role="group" aria-busy={summaryBackedLoading || undefined}>
              {summaryBackedLoading && (
                <CatalogLoadingRows parentSessionId={rootId} byId={byId} level={1} />
              )}
              {!summaryBackedLoading && (
                <CatalogRows
                  parentSessionId={rootId}
                  catalog={rootCatalog}
                  catalogs={catalogs}
                  byId={byId}
                  level={1}
                  currentSessionId={sessionId}
                  live={live}
                  openChild={openChild}
                  refresh={refresh}
                />
              )}
            </div>
          )}
          {readyEmpty && (
            <div className={css.subagentEmpty}>
              <div>{t('subagentEmpty')}</div>
              <div className={css.subagentEmptyHint}>{t('subagentEmptyDesc')}</div>
            </div>
          )}
        </div>
        <JobsSection
          byId={byId}
          jobsBySession={list.jobsBySession}
          rootId={rootId}
          active={active}
        />
      </div>
    </div>
  )
}
