/**
 * The interactive terminal: xterm.js over a WebSocket to the host pty.
 * The host replays the session's transcript on connect, then streams live
 * output; input frames are raw text, resize frames are JSON with
 * type:"resize". Transient disconnects (page refresh, host restart) reconnect
 * automatically; a server-side refusal (close code 1011 with a reason, e.g.
 * a failed pty spawn) stops the loop and shows the reason with a manual
 * retry, and repeated unreasoned failures surface the close code after three
 * attempts, so the banner never spins forever.
 *
 * Three control frames shape the pty lifecycle on unmount:
 * - `{type:'close'}` — the user closed the tab. The host kills the pty
 *   immediately (quota released).
 * - `{type:'park'}` — the user switched to another conversation. The tab is
 *   still open in its session's persisted state but its view unmounted; the
 *   host keeps the pty alive indefinitely (no grace countdown), so switching
 *   back reattaches the same shell instead of respawning one.
 * - bare socket drop (no frame) — page refresh, crash, plugin teardown, or a
 *   same-session re-render. The host's reconnect grace keeps the shell alive
 *   for a quick reconnect.
 *
 * Two attach modes share one upgrade endpoint:
 * - `tabId` starting with `agent:` is an agent-owned terminal (created by
 *   the `terminal_create` tool). The uuid is the suffix after `agent:`; the
 *   view connects with `?uuid=...`. A close frame kills the pty (the agent's
 *   terminal closes when the user closes the tab); a bare socket drop
 *   leaves the pty alive (the agent owns the lifetime) — agent terminals
 *   never send park (their lifetime is already indefinite on bare drop).
 * - Any other `tabId` is a UI-tab terminal (the user created it from the +
 *   menu). The view connects with `?tab=...&sessionId=...&cwd=...`. A close
 *   frame schedules a 0-ms close; a park frame marks the pty as parked; a
 *   bare socket drop gets the host's reconnect grace.
 */
import { useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { writeClipboard } from "./ui-primitives"
import '@xterm/xterm/css/xterm.css'
import { t } from './locales'
import { openWhenSized } from './open-when-sized'
import { api, type SessionScope, type TerminalDepsStatus } from './api'
import { agentUuidOf, isAgentTabId, type SidebarStore } from './state'
import { isDarkScheme, subscribeColorScheme, effectiveTokenValue, tokenValue } from './theme'
import { resolveTerminalFont } from './terminal-font'
import css from './sidebar.module.css'

/** How many consecutive unreasoned failures before showing the error banner. */
const FAILURE_LIMIT = 3

/**
 * The WS close-code-1011 reason the host sends when node-pty is unavailable
 * (mirror of the host's PTY_DEPS_MISSING; the value is a wire contract, so
 * the two sides keep the literal in lockstep). The view then fetches the
 * full repair details from /sidebar/api/terminal.deps.
 */
const PTY_DEPS_MISSING = 'pty-deps-missing'

/** The degraded-mode payload rendered by {@link TerminalDepsBanner}. */
type TerminalDepsInfo = Extract<TerminalDepsStatus, { ok: false }>

/**
 * Curated ANSI palettes for the terminal. The surface colors (background,
 * foreground, cursor, selection) ride the theme tokens so the terminal
 * blends with the panel in both schemes; the 16 ANSI colors are the same
 * designed palettes the app's code surfaces use (one-dark family for dark,
 * one-light family for light), read live so a scheme flip re-themes in
 * place.
 */
const ANSI_DARK: Record<string, string> = {
  black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
  brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
  brightCyan: '#56b6c2', brightWhite: '#ffffff',
}

const ANSI_LIGHT: Record<string, string> = {
  black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
  blue: '#0184bc', magenta: '#a626a4', cyan: '#0997b3', white: '#a0a1a7',
  brightBlack: '#4f525e', brightRed: '#e45649', brightGreen: '#50a14f',
  brightYellow: '#c18401', brightBlue: '#0184bc', brightMagenta: '#a626a4',
  brightCyan: '#0997b3', brightWhite: '#fafafa',
}

/** The xterm theme for the current scheme (surface from tokens, ANSI curated). */
function xtermTheme(): ITheme {
  const dark = isDarkScheme()
  // Skin systems set --dsw-alias-bg-base to `transparent` or translucent
  // glass values (the dsh-web-ui skins use rgba 0.16–0.7); effectiveTokenValue
  // treats those as unset below the opacity floor, so the opaque fallback
  // engages and the terminal never renders see-through over the skin's
  // backdrop (issue #90). Effectively opaque scoped surfaces (e.g. a skin's
  // 0.96 porcelain) pass through — the skin still controls the terminal.
  const background = effectiveTokenValue('--dsw-alias-bg-base') || (dark ? '#111114' : '#ffffff')
  const foreground = effectiveTokenValue('--dsw-alias-label-primary') || (dark ? '#e6e6e6' : '#1a1a1a')
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)',
    ...(dark ? ANSI_DARK : ANSI_LIGHT),
  }
}

export function TerminalView(props: { scope: SessionScope; tabId: string; store: SidebarStore }) {
  const { scope, tabId, store } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const [depsFatal, setDepsFatal] = useState<TerminalDepsInfo | null>(null)
  const [lastUrl, setLastUrl] = useState<string | null>(null)
  const connectRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // The custom font prefs (side card settings, terminal card) resolve at
    // mount; store changes re-apply them live below.
    const font = resolveTerminalFont(store.getPrefs(), tokenValue('--ds-font-family-code'))
    const term = new Terminal({
      cursorBlink: true,
      fontSize: font.fontSize,
      fontFamily: font.fontFamily,
      allowTransparency: true,
      convertEol: false,
      scrollback: 4000,
      theme: xtermTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Re-theme in place when the app's scheme flips (tokens + palette).
    const applyTheme = (): void => {
      term.options.theme = xtermTheme()
      term.refresh(0, term.rows - 1)
    }
    const schemeSub = subscribeColorScheme(applyTheme)

    let socket: WebSocket | null = null
    let closed = false
    let retry: number | undefined
    let failures = 0

    const wsUrl = (): string => {
      const url = new URL('/sidebar/ws/terminal', location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      // Agent terminals attach by uuid (the host looks them up in the agent
      // pty registry); UI-tab terminals attach by sessionId+tab (the host
      // uses the UI-tab pty manager). Same upgrade endpoint, different query.
      if (isAgentTabId(tabId)) {
        url.search = new URLSearchParams({ uuid: agentUuidOf(tabId) }).toString()
      } else {
        const params = new URLSearchParams({ sessionId: scope.sessionId, tab: tabId })
        if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
        url.search = params.toString()
      }
      // Same construction the app's own downlink WebSockets use (new URL
      // over location.origin + protocol swap): whatever the environment
      // does to the app's websockets applies identically here.
      return url.toString()
    }

    const sendResize = (): void => {
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }

    const connect = (): void => {
      if (closed) return
      const url = wsUrl()
      setLastUrl(url)
      socket = new WebSocket(url)
      socket.onopen = () => {
        failures = 0
        setConnected(true)
        setFatal(null)
        sendResize()
      }
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') term.write(event.data)
      }
      socket.onclose = (event) => {
        setConnected(false)
        // node-pty dependency missing/broken (issue #140): the host closed
        // with the short marker. Fetch the full repair details over HTTP —
        // a WS close reason is capped at 123 bytes, too small for the
        // pasteable command. A failed fetch falls back to the plain banner.
        if (event.code === 1011 && event.reason === PTY_DEPS_MISSING) {
          void api.terminalDeps().then((status) => {
            if (status.ok) {
              // The host recovered between the close and the fetch — the
              // plain banner with a retry is the honest state.
              setFatal(t('terminalDepsFailed'))
              return
            }
            setFatal(null)
            setDepsFatal(status)
          }).catch(() => {
            setFatal(t('terminalDepsFailed'))
          })
          return
        }
        // A server-side refusal carries a close code + reason; retrying it
        // forever would only spin the banner, so surface it with a retry.
        if (event.code === 1011 && event.reason !== '') {
          setFatal(event.reason)
          return
        }
        // Unreasoned drops (upgrade rejected, host down, mid-handshake
        // refusal) normally recover on the next attempt; after a few
        // consecutive failures stop spinning and show the close code.
        failures += 1
        if (failures >= FAILURE_LIMIT) {
          const detail = event.reason !== '' ? ` (${event.code}: ${event.reason})` : ` (${event.code})`
          console.error('[dsh-better-sidebar] terminal connection failed:', event.code, event.reason, url)
          setFatal(`${t('terminalConnectFailed')}${detail}`)
          return
        }
        if (!closed) retry = window.setTimeout(connect, 2000)
      }
      socket.onerror = () => {
        socket?.close()
      }
    }
    connectRef.current = connect

    const inputSub = term.onData((data) => {
      if (socket !== null && socket.readyState === WebSocket.OPEN) socket.send(data)
    })
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
        sendResize()
      } catch {
        // The terminal may be mid-dispose; ignore.
      }
    })
    observer.observe(host)

    // Custom font prefs (the terminal card's secondary settings) apply LIVE:
    // on any store change re-resolve and diff the two options, re-fitting
    // when they moved (the grid dimensions may change with the font). The
    // subscribe fires on every store change (tabs, panels…), so the diff is
    // what keeps this cheap.
    const fontSub = store.subscribe(() => {
      const next = resolveTerminalFont(store.getPrefs(), tokenValue('--ds-font-family-code'))
      if (next.fontFamily !== term.options.fontFamily || next.fontSize !== term.options.fontSize) {
        term.options.fontFamily = next.fontFamily
        term.options.fontSize = next.fontSize
        try {
          fit.fit()
          sendResize()
        } catch {
          // The terminal may be mid-dispose; ignore.
        }
      }
    })

    // The terminal must not be opened in a zero-size container: xterm's
    // renderer creation fails there and the next Viewport refresh crashes
    // reading `.dimensions` off the undefined renderer (blank terminal on
    // WKWebView when the bottom panel's expand slide leaves the host at
    // height 0; any display:none-hidden ancestor does the same). Defer
    // open+fit until the host has a real size — writes arriving meanwhile
    // are buffered by xterm's WriteBuffer and render once open, and
    // FitAddon.fit() is a safe no-op before open. sendResize() here covers
    // the deferred path where the socket may already be open with the
    // default 80x24 dims.
    const cancelOpen = openWhenSized(host, () => {
      try {
        term.open(host)
        fit.fit()
        sendResize()
      } catch (error) {
        console.error('[dsh-better-sidebar] xterm open failed:', error)
      }
    })

    connect()
    return () => {
      closed = true
      cancelOpen()
      window.clearTimeout(retry)
      observer.disconnect()
      fontSub()
      schemeSub()
      inputSub.dispose()
      // Three unmount cases, distinguished by the store's tab/open state and
      // the active session id:
      // 1. The tab was closed by the user (NOT in its session's state): send
      //    `{type:'close'}` — the host releases the pty immediately.
      // 2. The user switched to another conversation (the tab IS still open
      //    in scope.sessionId's state, but the active session is now a
      //    different one): send `{type:'park'}` — the host keeps the pty
      //    alive indefinitely (no grace countdown), so switching back
      //    reattaches the SAME shell. Without this, the bare socket drop
      //    would start the 30s reconnect-grace countdown and kill the shell
      //    while the user is still actively working in the other session.
      // 3. A same-session unmount (page refresh, crash, plugin teardown, a
      //    re-render that re-mounts the view): bare socket drop — the host's
      //    reconnect grace keeps the shell alive for a quick reconnect.
      // Agent terminals follow the close-frame rule; their lifetime is owned
      // by the agent, so a bare drop (case 3) already leaves them alive
      // indefinitely — no park frame needed.
      const tabStillOpen = store.tabOpen(scope.sessionId, tabId)
      const sessionSwitched = store?.getSnapshot?.()?.sessionId !== scope.sessionId
      if (!tabStillOpen
        && socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'close' }))
      } else if (tabStillOpen && sessionSwitched && !isAgentTabId(tabId)
        && socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'park' }))
      }
      socket?.close()
      term.dispose()
      connectRef.current = null
    }
  }, [scope.sessionId, scope.cwd, tabId, store])

  return (
    <div className={css.terminalWrap}>
      {depsFatal !== null && (
        <TerminalDepsBanner deps={depsFatal} onRetry={() => { setDepsFatal(null); connectRef.current?.() }} />
      )}
      {fatal !== null && (
        <div className={css.terminalBanner}>
          {t('terminalError')}: {fatal}
          {lastUrl !== null && <div className={css.terminalBannerUrl}>{lastUrl}</div>}
          <button
            type="button"
            className={css.terminalRetry}
            onClick={() => { setFatal(null); connectRef.current?.() }}
          >
            {t('terminalRetry')}
          </button>
        </div>
      )}
      {fatal === null && depsFatal === null && !connected && <div className={css.terminalBanner}>{t('disconnected')}</div>}
      <div ref={hostRef} className={css.terminal} />
    </div>
  )
}

/**
 * The node-pty dependency failure banner (issue #140): explains that the
 * terminal's native dependency failed to load and shows the PASTEABLE repair
 * command (bash / cmd / PowerShell) with a copy button — the user pastes it
 * into a terminal where their DSH profile lives and runs it, then retries.
 * Extracted as a standalone component for direct testing.
 */
export function TerminalDepsBanner(props: { deps: TerminalDepsInfo; onRetry: () => void }) {
  const { deps, onRetry } = props
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    const written = await writeClipboard(deps.command)
    if (written) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <div className={css.terminalDepsBanner}>
      <div className={css.terminalDepsTitle}>{t('terminalDepsFailed')}</div>
      <div className={css.terminalDepsHint}>
        {t('terminalDepsHint')}
        {deps.profile !== null ? t('terminalDepsProfile', { profile: deps.profile }) : ''}
      </div>
      <div className={css.terminalDepsCommandRow}>
        <pre className={css.terminalRepairCommand}>{deps.command}</pre>
        <button type="button" className={css.terminalRetry} onClick={() => { void copy() }} aria-label={t('copy')}>
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      {deps.note !== undefined && <div className={css.terminalDepsNote}>{deps.note}</div>}
      <div className={css.terminalDepsActions}>
        <button type="button" className={css.terminalRetry} onClick={onRetry}>
          {t('terminalRetry')}
        </button>
      </div>
    </div>
  )
}
