/**
 * Side Chat page: Codex-style side conversations for the current session.
 *
 * EVERY side conversation is its own sidebar tab (侧边对话1/2/3 …): the
 * descriptor's createTab mints a fresh tab flagged `autoCreate` and this
 * view creates the EMPTY thread on mount (one click = one conversation,
 * exactly like the Codex app); the composer owns the first message (the
 * host wraps it with the side boundary + the in-progress snapshot parked
 * at creation, and the thread earns its real label — and the tab its
 * title — from that first message). Closing the tab releases the thread's
 * live agent (its history stays persisted); the header menu reopens any
 * existing thread into a tab (deduped by threadId).
 *
 * Each side thread is a child session the plugin created itself with a
 * custom seed (the parent's full log up to the click moment — see
 * sidechat-core.ts). Transport: thread creation/follow-up/cancel/dispose/
 * info go through the plugin's own /sidebar/api sidechat.* routes
 * (subagent-origin identities are fenced from the generic session RPCs);
 * the transcript is polled from the generic session.history RPC (seed-cut
 * at session/end-seed, boundary row dropped, chunk streaming accumulated)
 * — see sidechat-transcript.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  IconChevronRightOutline14,
  IconNewChatOutline16,
  IconPlusOutline16,
  IconSendOutline16,
  IconStopFill16,
  MarkdownText,
  Menu,
  StateDot,
  type MenuEntry,
} from "./ui-primitives"
import { IconHistoryOutline16, IconSaveOutline16 } from './icons'
import type { Context, SidebarHistoryEntry } from './context-types'
import {
  SIDE_LABEL_PREFIX,
  SIDE_NEW_THREAD_TITLE,
  sideThreadRows,
  threadHasCompletedTurn,
  threadTrailingPending,
  type SidechatThreadInfo,
} from './sidechat-core'
import { collectOwnEvents, toolArgsSummary, transcriptRows, type SidechatTranscriptRow } from './sidechat-transcript'
import { api } from './api'
import { t } from './locales'
import type { SessionScope } from './api'
import type { SidebarTab } from './state'
import css from './SideChatView.module.css'

/** Tail-page size for one transcript poll (events per page). Small on
 *  purpose: streaming polls ride the tail and merge by seq. */
const PAGE_MESSAGES = 8
/** First-attach walk page size: cold reads re-expand chunk-rows into one
 *  event per streamed delta, so a single answer can be hundreds of events —
 *  the walk must page big or earlier tool/call rows fall out of the window. */
const WALK_PAGE_EVENTS = 200
/** Poll cadence while the selected thread is running and the tab visible. */
const POLL_MS = 2000
/** Textarea auto-grow ceiling (px) — the composer scrolls beyond it. */
const COMPOSER_MAX_HEIGHT = 132
/** Stable fallback for a missing sessions store (uSES snapshot identity
 *  must be stable across calls; a fresh literal would loop the hook). */
const EMPTY_SESSION_LIST = { current: undefined, byId: {} }

/** The thread a tab is bound to (durable in tab.meta across refreshes). */
export function sidechatThreadIdOf(tab: SidebarTab): string | undefined {
  const meta = tab.meta as { threadId?: unknown } | undefined
  return typeof meta?.threadId === 'string' ? meta.threadId : undefined
}

/** The parked reopen target consumed by the descriptor's createTab (the
 *  service's createTab receives no seed, so a thread-switch parks the id
 *  here and openTab picks it up synchronously — exactly one consume per
 *  park). */
let parkedReopen: string | undefined

/** Park a thread id for the NEXT sidechat openTab to reattach. */
export function parkSidechatReopen(threadId: string): void {
  parkedReopen = threadId
}

/** Consume the parked reopen target (undefined = mint a fresh thread tab). */
export function consumeSidechatSeed(): string | undefined {
  const value = parkedReopen
  parkedReopen = undefined
  return value
}

/** In-flight thread creations keyed by tab id (double-mount guard: React
 *  StrictMode / HMR must not mint two threads for one tab). */
const inFlightStarts = new Set<string>()

/** Per-thread transcript cache: seed boundary + thread-own events merged by
 *  seq (streaming polls never re-download the inherited seed). */
interface ThreadCache {
  seedBoundary: number | null
  entries: SidebarHistoryEntry[]
}

/** Row-render labels (locale-dependent, memoized once per mount). */
interface RowLabels {
  copyLabel: string
  copiedLabel: string
  thinkLabel: string
  injectionLabel: string
}

/** Merge history entries by event seq (newest wins), log order preserved. */
function mergeBySeq(
  previous: readonly SidebarHistoryEntry[],
  incoming: readonly SidebarHistoryEntry[],
): SidebarHistoryEntry[] {
  const bySeq = new Map<number, SidebarHistoryEntry>()
  for (const entry of previous) bySeq.set(entry.event.seq, entry)
  for (const entry of incoming) bySeq.set(entry.event.seq, entry)
  return [...bySeq.values()].sort((a, b) => a.event.seq - b.event.seq)
}

/** The display title of a thread: the durable label minus the 'Side: '
 *  prefix, with the fresh-thread placeholder localized. */
function threadDisplayTitle(title: string): string {
  if (title === SIDE_NEW_THREAD_TITLE) return t('sideChatUntitled')
  return title.startsWith(SIDE_LABEL_PREFIX) ? title.slice(SIDE_LABEL_PREFIX.length) : title
}

/**
 * One collapsible context row — the shared Codex-style chrome of tool
 * calls, thinking and context injections: a single quiet line (chevron +
 * label + one-line summary) that expands into an indented body hung on a
 * hairline thread. Rows with nothing to reveal render as a static line.
 */
function CollapsibleRow(props: {
  label: string
  meta?: string
  mono?: boolean
  streaming?: boolean
  failed?: boolean
  children?: React.ReactNode
}): React.ReactNode {
  const label = (
    <span
      className={clsx(
        css.sidechatRowLabel,
        props.mono === true && css.sidechatRowMono,
        props.streaming === true && css.sidechatShimmerText,
      )}
    >
      {props.label}
    </span>
  )
  const meta = props.meta !== undefined && props.meta !== ''
    ? <span className={css.sidechatRowMeta}>{props.meta}</span>
    : null
  if (props.children === undefined) {
    return (
      <div className={clsx(css.sidechatRowLine, css.sidechatRowStatic, props.failed === true && css.sidechatRowFailed)}>
        {label}
        {meta}
      </div>
    )
  }
  return (
    <details className={css.sidechatRow}>
      <summary
        className={clsx(
          css.sidechatRowLine,
          css.sidechatRowSummary,
          props.failed === true && css.sidechatRowFailed,
        )}
      >
        <span className={css.sidechatRowChevron}>
          <IconChevronRightOutline14 size={12} />
        </span>
        {label}
        {meta}
      </summary>
      <div className={css.sidechatRowBody}>{props.children}</div>
    </details>
  )
}

/** One row renderer (React keys ride the source event seq). */
function renderRow(row: SidechatTranscriptRow, labels: RowLabels): React.ReactNode {
  switch (row.kind) {
    case 'user':
      return (
        <div key={`${row.kind}:${row.seq}`} className={css.sidechatUser}>
          <MarkdownText text={row.text} codeLabels={labels} />
        </div>
      )
    case 'assistant':
      return (
        <div key={`${row.kind}:${row.seq}`} className={css.sidechatAssistant}>
          <MarkdownText text={row.text} codeLabels={labels} />
        </div>
      )
    case 'reasoning':
      return (
        <CollapsibleRow
          key={`${row.kind}:${row.seq}`}
          label={labels.thinkLabel}
          streaming={!row.settled}
        >
          <div className={css.sidechatRowProse}>{row.text}</div>
        </CollapsibleRow>
      )
    case 'injection':
      return (
        <CollapsibleRow key={`${row.kind}:${row.seq}`} label={labels.injectionLabel}>
          <div className={css.sidechatRowProse}>{row.text}</div>
        </CollapsibleRow>
      )
    case 'tool': {
      const body = (
        <>
          {row.args !== undefined && <pre className={css.sidechatRowCode}>{row.args}</pre>}
          {row.resultText !== undefined && <pre className={css.sidechatRowCode}>{row.resultText}</pre>}
        </>
      )
      return (
        <CollapsibleRow
          key={`${row.kind}:${row.seq}`}
          label={row.name}
          meta={toolArgsSummary(row.args)}
          mono
          streaming={row.executing === true}
          failed={row.failed}
          {...(row.args === undefined && row.resultText === undefined ? {} : { children: body })}
        />
      )
    }
  }
}

/** One side conversation tab (one thread per tab, Codex-style). */
export function SideChatView(props: {
  ctx: Context
  scope: SessionScope
  tab: SidebarTab
  visible: boolean
}): React.ReactNode {
  const { ctx, scope, tab, visible } = props
  const rowLabels = useMemo<RowLabels>(
    () => ({
      copyLabel: t('copy'),
      copiedLabel: t('copied'),
      thinkLabel: t('sideChatThink'),
      injectionLabel: t('sideChatInjection'),
    }),
    [],
  )

  // The session list feed: thread rows (the header menu) + running states.
  // The store chain is dereferenced exactly once per call — no
  // check‑then‑act on a mutable ctx that could throw "Cannot read
  // properties of undefined (reading 'getSnapshot')" — and the
  // missing‑store fallback is a module‑level constant (uSES requires a
  // stable snapshot object; a fresh literal would re‑render forever).
  const subscribeSessions = useMemo(() => (callback: () => void) => {
    const list = ctx.sessions?.list;
    return typeof list?.subscribe === 'function' ? (list.subscribe(callback) ?? (() => {})) : (() => {});
  }, [ctx]);
  const getSessionSnapshot = useCallback(() => {
    const list = ctx.sessions?.list;
    return typeof list?.getSnapshot === 'function'
      ? (list.getSnapshot() ?? EMPTY_SESSION_LIST)
      : EMPTY_SESSION_LIST;
  }, [ctx]);
  const list = useSyncExternalStore(subscribeSessions, getSessionSnapshot, getSessionSnapshot);

  const threads = useMemo(
    () => sideThreadRows(list.byId, scope.sessionId),
    [list, scope.sessionId],
  )

  // The thread this tab is bound to rides tab.meta (refresh-restored).
  const threadId = sidechatThreadIdOf(tab)
  const autoCreate = (tab.meta as { autoCreate?: unknown } | undefined)?.autoCreate === true

  const [composer, setComposer] = useState('')
  const [busy, setBusy] = useState<'starting' | 'sending' | 'saving' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [revision, setRevision] = useState(0)
  const [info, setInfo] = useState<SidechatThreadInfo | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const cacheRef = useRef<ThreadCache>({ seedBoundary: null, entries: [] })
  const controllerRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const summary = threadId === undefined ? undefined : list.byId[threadId]
  const running = summary?.running === true

  /** The agent-identity badge of the thread header (preset · model). */
  const agentBadge = useMemo(() => {
    if (info === null) return ''
    return [info.preset, info.model ?? info.provider].filter(Boolean).join(' · ')
  }, [info])

  /** Create this tab's thread (immediate-create tabs and hero retries). */
  const startThread = useCallback(async (): Promise<void> => {
    if (inFlightStarts.has(tab.id)) return
    inFlightStarts.add(tab.id)
    setBusy('starting')
    setError(null)
    try {
      const { childId } = await api.sidechatStart(scope.sessionId)
      ctx.get('betterSidebar')?.updateTab(tab.id, { meta: { threadId: childId } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      inFlightStarts.delete(tab.id)
      setBusy(null)
    }
  }, [ctx, scope.sessionId, tab.id])

  // Codex-style immediate create: an autoCreate tab spawns its thread as
  // soon as it first renders.
  useEffect(() => {
    if (threadId !== undefined || !autoCreate || !visible) return
    void startThread()
  }, [threadId, autoCreate, visible, startThread])

  // The tab title follows the thread's durable label (the first prompt
  // renames the thread; the strip picks it up here).
  useEffect(() => {
    const display = summary?.displayTitle
    if (display === undefined) return
    const title = threadDisplayTitle(display)
    if (title !== '' && title !== tab.title) {
      try {
        ctx.get('betterSidebar')?.updateTab(tab.id, { title })
      } catch {
        // A stale title is cosmetic; the thread keeps working.
      }
    }
  }, [summary, tab.id, tab.title, ctx])

  /** One transcript pull: the first read walks back to the seed boundary
   *  (big pages — chunk deltas re-expand on cold reads), later reads fetch
   *  one tail page and merge (seq-deduped). */
  const fetchThread = useCallback(async (childId: string): Promise<void> => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const cache = cacheRef.current
    try {
      if (cache.seedBoundary === null) {
        const walk = await collectOwnEvents(async (beforeSeq) => {
          const response = await ctx.connection.api.sessions.history(
            {
              sessionId: childId,
              maxMessages: WALK_PAGE_EVENTS,
              ...(beforeSeq === undefined ? {} : { beforeSeq }),
            },
            controller.signal,
          )
          if (!response.result.ok) throw new Error('history walk failed')
          return response.result.value.events
        })
        cache.seedBoundary = walk.seedBoundary
        cache.entries = mergeBySeq(cache.entries, walk.entries)
      } else {
        const response = await ctx.connection.api.sessions.history(
          { sessionId: childId, maxMessages: PAGE_MESSAGES },
          controller.signal,
        )
        if (!response.result.ok) return
        cache.entries = mergeBySeq(cache.entries, response.result.value.events)
      }
      setRevision(value => value + 1)
    } catch {
      // Aborted by a newer pull or a wire failure: keep the last rows.
    }
  }, [ctx])

  /** The thread header badge pull (live state + preset/model identity). */
  const fetchInfo = useCallback(async (childId: string): Promise<void> => {
    try {
      setInfo(await api.sidechatInfo(childId))
    } catch {
      // The badge is decorative; a wire failure keeps the last value.
    }
  }, [])

  // Reset the transcript cache whenever the binding changes, then focus
  // the composer — it owns the first message of a fresh thread.
  useEffect(() => {
    cacheRef.current = { seedBoundary: null, entries: [] }
    controllerRef.current?.abort()
    setError(null)
    setSaved(false)
    setInfo(null)
    if (threadId !== undefined) {
      void fetchInfo(threadId)
      window.setTimeout(() => composerRef.current?.focus(), 0)
    }
  }, [threadId, fetchInfo])

  // Poll while the tab is visible and the thread runs.
  useEffect(() => {
    if (!visible || threadId === undefined) return
    void fetchThread(threadId)
    if (!running) return
    const timer = window.setInterval(() => {
      void fetchThread(threadId)
      void fetchInfo(threadId)
    }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [visible, threadId, running, fetchThread, fetchInfo])

  useEffect(() => () => { controllerRef.current?.abort() }, [])

  const rows = useMemo(
    () => (threadId === undefined ? [] : transcriptRows(cacheRef.current.entries)),
    // The cache is a ref; revision bumps on every successful pull.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threadId, revision],
  )
  const canSave = threadId !== undefined && threadHasCompletedTurn(cacheRef.current.entries)
  const trailingPending = threadId !== undefined && threadTrailingPending(cacheRef.current.entries)
  const freshThread = threadId !== undefined && rows.length === 0

  // Follow the stream: stick to the bottom while the log grows.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    scroller.scrollTop = scroller.scrollHeight
  }, [rows.length, threadId])

  /** Open a NEW thread tab (createTab mints the autoCreate tab; its view
   *  creates the thread on mount). */
  const openNewThread = (): void => {
    setMenuOpen(false)
    ctx.get('betterSidebar')?.openTab({ type: 'sidechat' }, scope)
  }

  /** Switch to an existing thread: parked for createTab, deduped to the
   *  already-open tab when there is one. */
  const openExistingThread = (id: string): void => {
    setMenuOpen(false)
    if (id === threadId) return
    parkSidechatReopen(id)
    ctx.get('betterSidebar')?.openTab({ type: 'sidechat' }, scope)
  }

  const menuItems = useMemo<MenuEntry[]>(() => {
    const items: MenuEntry[] = [
      { id: '$new', label: t('sideChatNew'), icon: <IconPlusOutline16 /> },
    ]
    if (threads.length > 0) {
      items.push({ type: 'separator', id: '$sep' })
      for (const row of threads) {
        items.push({
          id: row.id,
          label: threadDisplayTitle(row.title),
          ...(row.running ? { icon: <StateDot state="ongoing" size={8} /> } : {}),
        })
      }
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads])

  const growComposer = (): void => {
    const field = composerRef.current
    if (field === null) return
    field.style.height = '0px'
    field.style.height = `${Math.min(field.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }

  const handleSend = async (): Promise<void> => {
    const text = composer.trim()
    if (text === '' || threadId === undefined || busy !== null) return
    setBusy('sending')
    setError(null)
    try {
      await api.sidechatPrompt(threadId, text)
      setComposer('')
      const field = composerRef.current
      if (field !== null) field.style.height = ''
      void fetchThread(threadId)
      void fetchInfo(threadId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const handleCancel = async (): Promise<void> => {
    if (threadId === undefined || busy !== null) return
    try {
      await api.sidechatCancel(threadId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const handleSave = async (): Promise<void> => {
    if (threadId === undefined || !canSave || busy !== null) return
    setBusy('saving')
    setError(null)
    setSaved(false)
    try {
      // NOTE: fork must stay a METHOD call — `ctx.sessions.fork` is the
      // client-runtime sessions service, and an unbound reference loses
      // `this` (its fork reads this.list for the title bump).
      if (ctx.sessions.fork === undefined) throw new Error('session fork is unavailable')
      const newId = await ctx.sessions.fork({ sessionId: threadId, increaseTitle: true })
      const title = summary === undefined ? '' : threadDisplayTitle(summary.displayTitle).trim()
      const binding = ctx.sessions.binding?.(newId)
      if (binding !== undefined && title !== '') {
        await binding.session.rename(title)
      }
      ctx.sessions.open?.(newId)
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  // ── unbound tab: the hero (fresh autoCreate tabs flash a creating state
  //    until the thread lands; legacy persisted tabs offer a manual start) ──
  if (threadId === undefined) {
    return (
      <div className={css.sidechat}>
        <div className={css.sidechatHero}>
          <IconNewChatOutline16 />
          <div
            className={clsx(
              css.sidechatHeroTitle,
              busy === 'starting' && css.sidechatShimmerText,
            )}
          >
            {busy === 'starting' ? t('sideChatCreating') : t('sideChatEmpty')}
          </div>
          <div className={css.sidechatHeroDesc}>{t('sideChatEmptyDesc')}</div>
          {error !== null && <div className={css.sidechatError}>{t('sideChatError', { message: error })}</div>}
          {busy !== 'starting' && (
            <button
              type="button"
              className={css.sidechatPrimaryBtn}
              onClick={() => void startThread()}
            >
              {error === null ? t('sideChatNew') : t('sideChatRetry')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={css.sidechat}>
      <div className={css.sidechatDetailHeader}>
        {running && <StateDot state="ongoing" size={8} className={css.sidechatHeaderDot} />}
        {agentBadge !== '' && <span className={css.sidechatAgentBadge}>{agentBadge}</span>}
        <span className={css.sidechatHeaderSpacer} />
        <Menu
          open={menuOpen}
          anchor={(
            <button
              type="button"
              className={css.sidechatIconBtn}
              onClick={() => { setMenuOpen(value => !value) }}
              title={t('sideChatThreads')}
            >
              <IconHistoryOutline16 />
            </button>
          )}
          items={menuItems}
          selectedId={threadId}
          onSelect={(id) => { id === '$new' ? openNewThread() : openExistingThread(id) }}
          onClose={() => { setMenuOpen(false) }}
          align="end"
          portal
          dense
        />
        <button
          type="button"
          className={css.sidechatIconBtn}
          onClick={() => void handleSave()}
          disabled={!canSave || busy !== null}
          title={`${t('sideChatSave')} — ${t('sideChatSaveTitle')}`}
        >
          <IconSaveOutline16 />
        </button>
      </div>
      {!canSave && !freshThread && <div className={css.sidechatHint}>{t('sideChatNoTurn')}</div>}
      {canSave && trailingPending
        && <div className={css.sidechatHint}>{t('sideChatPendingDrop')}</div>}
      {saved && <div className={css.sidechatHint}>{t('sideChatSaved')}</div>}
      {error !== null && <div className={css.sidechatError}>{t('sideChatError', { message: error })}</div>}
      <div ref={scrollRef} className={css.sidechatScroll}>
        {rows.map(row => renderRow(row, rowLabels))}
      </div>
      {running && (
        <div className={css.sidechatStatus}>
          <StateDot state="ongoing" size={8} />
          <span className={css.sidechatStatusText}>{t('sideChatThinking')}</span>
        </div>
      )}
      <div className={css.sidechatComposer}>
        <textarea
          ref={composerRef}
          className={css.sidechatComposerInput}
          value={composer}
          placeholder={freshThread ? t('sideChatFirstPlaceholder') : t('sideChatComposerPlaceholder')}
          rows={1}
          onChange={event => {
            setComposer(event.target.value)
            growComposer()
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            void handleSend()
          }}
        />
        <div className={css.sidechatComposerBar}>
          <span className={css.sidechatComposerMeta}>
            {running ? '' : agentBadge}
          </span>
          {running ? (
            <button
              key="stop"
              type="button"
              className={css.sidechatSendBtn}
              onClick={() => void handleCancel()}
              disabled={busy !== null}
              title={t('sideChatCancelTitle')}
            >
              <IconStopFill16 />
            </button>
          ) : (
            <button
              key="send"
              type="button"
              className={css.sidechatSendBtn}
              onClick={() => void handleSend()}
              disabled={composer.trim() === '' || busy !== null}
              title={t('sideChatSend')}
            >
              <IconSendOutline16 />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
