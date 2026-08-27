/**
 * Client half of dsh-better-sidebar: resolves the user's "Side card"
 * preferences through the plugin's own fenced settings route, mounts the
 * right sidebar portal (inside an error boundary so a rendering failure
 * shows an error strip instead of a blank panel), registers the turn-tail
 * interception, and contributes the Side card settings section to the DSH
 * Settings shell. Requires the runtime's slots and sessions services; the
 * bundle itself is a module-table consumer only (react + ui-primitives +
 * xterm, all provided or inlined).
 */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from './context-types'
import { allLeaves, createSidebarStore, isAgentTabId } from './state'
import { createBetterSidebarService, matchUrlTarget } from './service'
import { revalidateChunksOnReactivate, setChunkModuleSystem } from './chunk-loader'
import { registerBuiltins } from './builtins/index'
import { Sidebar } from './Sidebar'
import { RenderBoundary } from './RenderBoundary'
import { registerOpenPathInterception, registerTurnTailInterception } from './intercept'
import { registerLinkInterception } from './link-intercept'
import { registerImeGuard } from './ime-guard'
import { registerSettingsNavIcon } from './settings-nav-icon'
import { loadExternalDisable, loadPrefs } from './prefs'
import { SideCardSection } from './SideCardSection'
import { api } from './api'
import { LOCALE_NS, attachLocale, attachBetterLocale, t, zh, en,
  ja, de, fr, pt, ko, ar, hi, id, tr, vi, th, ru, it, nl, sv, pl,
  zhHK, zhTW, zhMO,
} from './locales'
import css from './sidebar.module.css'
import './layout.css'

/** Services required before mounting (provided by the client runtime; the
 *  locale service backs the sidebar's copy — see locales.ts). `modules`
 *  (rc.8+) is the client module system the chunk loader resolves its
 *  externals through — Cordis guards service access without inject. */
export const inject = ['slots', 'sessions', 'connection', 'workspaces', 'locale', 'modules']

/**
 * Error boundary over the sidebar tree (root scope): a render error in the
 * sidebar SHELL itself must never blank the page silently — the shared
 * RenderBoundary shows a dismissible error strip and logs the stack. The
 * per-tab scope (Sidebar.tsx) catches viewer/editor crashes first; this root
 * boundary stays as the last resort for Workbench/shell errors.
 */
/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots, sessions).
 */
export function apply(ctx: Context): void {
  // The sidebar follows the DSH i18n system: attach the locale service so
  // the module-level t()/isZh() resolve the Host-backed language preference
  // (and switch live — the Sidebar root subscribes to it), and register the
  // plugin's dictionaries into the shared locale registry. The disposers
  // run on fiber disposal, so re-activation (HMR) re-registers cleanly.
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'dsh-better-sidebar: dictionaries')

  // Opt-in third-language support through @huanlin/dsh-plugin-better-locale.
  // When that plugin is installed, it publishes `ctx.betterLocale` (the
  // override store) and patches LocaleRuntime.prototype.lookup to consult
  // it. We mirror the same override awareness into the sidebar's own `t()`:
  // attachBetterLocale() makes t() consult the store's getOverride first,
  // so the sidebar's chrome (which bypasses ctx.locale and calls t()
  // directly) also switches to the override language. We also register
  // the ja dict with the better-locale store so external callers of
  // ctx.locale.lookup('betterSidebar', key) get the override text too.
  //
  // Activation-order-safe: ctx.get('betterLocale') is a non-reactive read
  // (cordis only re-evaluates declared `inject` deps). If better-locale
  // activates after better-sidebar, the initial read returns undefined.
  // We subscribe to the locale revision — better-locale bumps it on
  // activation (when a persisted override exists) and on every override
  // switch — and re-check ctx.get on each bump, attaching + registering
  // the ja dict once the store becomes available.
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    const sync = (): void => {
      dispose?.()
      dispose = undefined
      const store = ctx.get('betterLocale') as
        | {
            readonly active: string | undefined
            getOverride(dshActive: string, ns: string, key: string): string | undefined
            isOverrideActive(dshActive: string): boolean
            register(ns: string, dicts: Record<string, Record<string, string>>): () => void
            subscribe(listener: () => void): () => void
          }
        | undefined
      attachBetterLocale(store)
      if (store !== undefined) {
        dispose = store.register(LOCALE_NS, {
          ja, de, fr, pt, ko, ar, hi, id, tr, vi, th, ru, it, nl, sv, pl,
          'zh-HK': zhHK, 'zh-TW': zhTW, 'zh-MO': zhMO,
        })
      }
    }
    // Initial check (picks up the store if better-locale activated first).
    sync()
    // Re-check on every locale revision bump (better-locale bumps when it
    // activates with a persisted override, and when the user switches).
    const unsubscribe = ctx.locale.subscribe(sync)
    return () => {
      unsubscribe()
      dispose?.()
      attachBetterLocale(undefined)
    }
  }, 'dsh-better-sidebar: better-locale lazy integration')
  // One store instance per activation: production code creates it only here,
  // then hands it to the mounted panel and closes over it in the slot
  // registrations (the official createXXXStore() factory rule — no
  // module-level singleton).
  const sidebarStore = createSidebarStore()
  // The sidebar registry service: external plugins register tab types and
  // file previewers through `ctx.betterSidebar.registerTab/registerFileViewer`.
  // Published before the panel mounts so consumers injecting 'betterSidebar'
  // are ready by the time the sidebar renders.
  const service = createBetterSidebarService(sidebarStore)
  ctx.provide('betterSidebar', service)
  // Terminal tab titles use the host's effective shell name (e.g. bash/zsh)
  // instead of "Terminal 1". Start with a safe fallback and replace it as
  // soon as the host shell info resolves. Tabs created before the response
  // arrives keep the fallback title, so also retitle any already-open UI
  // terminal tabs that still carry it.
  const fallbackTitle = t('terminal')
  let terminalTitle = fallbackTitle
  void api.shellGet().then(({ name }) => {
    terminalTitle = name
    const snapshot = service.getSnapshot()
    if (snapshot.state === undefined) return
    const tabs = allLeaves(snapshot.state.splits)
      .concat(allLeaves(snapshot.state.bottomSplits))
      .flatMap(leaf => leaf.tabs)
    for (const tab of tabs) {
      if (tab.type === 'terminal' && !isAgentTabId(tab.id) && tab.title === fallbackTitle) {
        service.updateTab(tab.id, { title: name })
      }
    }
  }).catch(() => { /* keep fallback */ })
  // Register the plugin's own built-in tabs and viewers through the same
  // service (eating our own dogfood). The disposer unregisters them on
  // fiber disposal (HMR-safe).
  ctx.effect(
    () => registerBuiltins(ctx, service, { terminalTitle: () => terminalTitle }),
    'dsh-better-sidebar: register built-in tabs and viewers',
  )
  // A failure anywhere in the client lifecycle must never take the app down
  // silently: log with the plugin prefix and pin a visible diagnostic strip
  // to the page so a blank panel is never the only symptom.
  const fail = (phase: string, error: unknown): void => {
    console.error(`[dsh-better-sidebar] ${phase} error:`, error)
    try {
      const bar = document.createElement('div')
      bar.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483000;max-width:70vw;padding:8px 12px;'
        + 'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f2a1a1;background:#1b1b22;'
        + 'border:1px solid #f2a1a1;border-radius:8px;white-space:pre-wrap'
      bar.textContent = `[dsh-better-sidebar] ${phase} error: ${error instanceof Error ? error.message : String(error)}`
      document.body.appendChild(bar)
    } catch {
      // Nothing left to report with.
    }
  }
  try {
    // rc.8+ exposes the client module system as the `ctx.modules` service
    // (no window.__DSH_MODULES__ page global anymore); the chunk loader needs
    // it to resolve its externals, so inject it before anything can load a
    // lazy chunk. The loader falls back to the rc.7 global when absent.
    setChunkModuleSystem(ctx.modules)
    // Fresh chunk state for this activation: drop per-test fixtures and
    // revalidate loaded chunk scripts against the bundle route's ETags —
    // unchanged chunks keep their resolved exports (no re-inject /
    // re-execute on HMR), changed ones are dropped for a clean re-fetch.
    void revalidateChunksOnReactivate()
    ctx.effect(() => {
      let disposed = false
      let root: Root | undefined
      let host: HTMLDivElement | undefined
      let mounted = false
      let bodyObserver: MutationObserver | undefined
      let hostCheckFrame: number | null = null
      const unmount = (): void => {
        if (!mounted) return
        mounted = false
        bodyObserver?.disconnect()
        bodyObserver = undefined
        if (hostCheckFrame !== null) {
          cancelAnimationFrame(hostCheckFrame)
          hostCheckFrame = null
        }
        root?.unmount()
        root = undefined
        host?.remove()
        host = undefined
      }
      /** Re-attach the host if the page (a desktop shell wrapper, SPA
       *  navigation, …) ever removes it from <body>. Cheap: childList only,
       *  no subtree, no attribute filtering. */
      const guardAnchor = (): void => {
        if (bodyObserver !== undefined) return
        bodyObserver = new MutationObserver(() => {
          if (host !== undefined && !document.body.contains(host)) {
            document.body.appendChild(host)
          }
        })
        bodyObserver.observe(document.body, { childList: true })
      }
      /** One-shot geometry self-check: if the host page transforms
       *  <html>/<body> itself (exotic shells), a fixed panel host would
       *  track the transformed box instead of the viewport. Flip the
       *  degraded mode and pin the host to the viewport every frame until
       *  the ancestor transform is actually gone. The normal path (no
       *  page-level transform) never runs the sync loop. */
      const scheduleHostCheck = (): void => {
        hostCheckFrame ??= requestAnimationFrame(() => {
          hostCheckFrame = null
          const layer = host?.querySelector<HTMLElement>('[data-dsh-panel-host]')
          if (layer === null || layer === undefined) return
          const rect = layer.getBoundingClientRect()
          const mismatched = Math.abs(rect.left) > 8 || Math.abs(rect.top) > 8
            || Math.abs(rect.width - window.innerWidth) > 8 || Math.abs(rect.height - window.innerHeight) > 8
          if (!mismatched) {
            layer.removeAttribute('data-dsh-panel-host-degraded')
            layer.style.transform = ''
            return
          }
          layer.setAttribute('data-dsh-panel-host-degraded', '')
          console.warn('[dsh-better-sidebar] panel host geometry mismatch — a page-level transform was detected; using degraded viewport sync')
          // Track our own compensating translation so the loop judges the
          // UNCORRECTED geometry: clearing degraded mode must wait for the
          // ancestor transform to actually disappear — the frame right after
          // our correction applies would otherwise look "fixed" and the
          // offset would return immediately (CR #232 P1).
          let applied = { x: 0, y: 0 }
          const sync = (): void => {
            const r = layer.getBoundingClientRect()
            const rawLeft = r.left - applied.x
            const rawTop = r.top - applied.y
            if (Math.abs(rawLeft) <= 1 && Math.abs(rawTop) <= 1
              && Math.abs(r.width - window.innerWidth) <= 1 && Math.abs(r.height - window.innerHeight) <= 1) {
              layer.removeAttribute('data-dsh-panel-host-degraded')
              layer.style.transform = ''
              return
            }
            const next = { x: -rawLeft, y: -rawTop }
            if (next.x !== applied.x || next.y !== applied.y) {
              applied = next
              layer.style.transform = `translate(${applied.x}px, ${applied.y}px)`
            }
            hostCheckFrame = requestAnimationFrame(sync)
          }
          hostCheckFrame = requestAnimationFrame(sync)
        })
      }
      const mount = (): void => {
        if (mounted || disposed) return
        try {
          host = document.createElement('div')
          host.setAttribute('data-dsh-better-sidebar', '')
          document.body.appendChild(host)
          root = createRoot(host)
          root.render(createElement(RenderBoundary, { className: css.boundaryError }, createElement(Sidebar, { ctx, store: sidebarStore })))
          mounted = true
          guardAnchor()
          scheduleHostCheck()
        } catch (error) {
          fail('mount', error)
        }
      }
      const sync = async (): Promise<void> => {
        if (disposed) return
        // Resolve the user's side card prefs BEFORE the first session seeds,
        // so a brand-new conversation opens (or stays closed) at the chosen
        // width from first paint. A settings route failure falls back to the
        // schema defaults; the sidebar still mounts (a stalled wire gives up
        // after the timeout and mounts on the defaults).
        const prefs = await Promise.race([
          loadPrefs(api),
          new Promise<null>(resolve => { const timer = window.setTimeout(() => resolve(null), 2000) }),
        ])
        if (prefs !== null) sidebarStore.setPrefs(prefs)
        if (disposed) return
        // Mutual exclusion with the dsh-web-ui family right panel: while the
        // aionui-panel provider is selected, the sidebar must not mount at
        // all. Re-evaluated on every settings-document update (live switch).
        const suspended = await loadExternalDisable(api)
        if (disposed) return
        sidebarStore.setSuspended(suspended)
        if (suspended) unmount()
        else mount()
      }
      void sync()
      // Live re-evaluation: the runtime broadcasts settings-document updates
      // (the aionui card saves through the same document). Best effort —
      // deployments without the 'remote' service fall back to boot-time
      // evaluation only.
      const remote = ctx.get('remote') as { $on?: (event: string, listener: () => void) => () => void } | undefined
      const offRemote = remote?.$on?.('settings/document-updated', () => { void sync() })
      return () => {
        disposed = true
        offRemote?.()
        unmount()
      }
    }, 'dsh-better-sidebar: sidebar mount')

    ctx.effect(
      () => {
        try {
          return registerTurnTailInterception(ctx, sidebarStore)
        } catch (error) {
          fail('interception', error)
          return () => {}
        }
      },
      'dsh-better-sidebar: turn-tail interception',
    )

    ctx.effect(
      () => {
        try {
          return registerOpenPathInterception(ctx, sidebarStore)
        } catch (error) {
          fail('interception', error)
          return () => {}
        }
      },
      'dsh-better-sidebar: open-path interception',
    )

    ctx.effect(
      () => {
        try {
          // External http(s) links in the chat/GUI open the sidebar instead
          // of a new window. Gated on the browserInterceptLinks MASTER pref,
          // the URL's protocol flag (browserInterceptHttp / Https — https
          // defaults OFF: most https sites refuse iframe embedding), and the
          // target tab's enable switch; Ctrl/Cmd+click always bypasses. The
          // target is the first registered tab whose `urlTarget` claims the
          // URL (enabled tabs only), else the built-in browser tab.
          const urlTargetOf = (url: URL): string | undefined => {
            const prefs = sidebarStore.getPrefs()
            const enabled = service.getTabs().filter(tab => prefs.tabsEnabled[tab.id] !== false)
            return matchUrlTarget(enabled, url)?.id
          }
          return registerLinkInterception({
            takeoverEnabled: (url) => {
              if (sidebarStore.getSuspended()) return false
              const prefs = sidebarStore.getPrefs()
              if (prefs.browserInterceptLinks === false) return false
              const protocolOn = url.protocol === 'https:'
                ? prefs.browserInterceptHttps !== false
                : prefs.browserInterceptHttp !== false
              if (!protocolOn) return false
              // A plugin claim is the target (already enabled-filtered);
              // otherwise the built-in browser must be enabled.
              return urlTargetOf(url) !== undefined || prefs.tabsEnabled['browser'] !== false
            },
            openInSidebar: (url) => {
              let title: string | undefined
              try { title = new URL(url).hostname } catch { /* keep the default title */ }
              const type = urlTargetOf(new URL(url)) ?? 'browser'
              ctx.get('betterSidebar')?.openTab({ type, url, title })
            },
            selfOrigin: window.location.origin,
          })
        } catch (error) {
          fail('interception', error)
          return () => {}
        }
      },
      'dsh-better-sidebar: link interception',
    )

    // The IME guard: composition keys (candidate arrows, confirm, cancel)
    // belong to the input method, never to page JS. Inlined third-party UI
    // (formerly Univer's office controls, #562 regression) has shipped
    // unguarded keydown handlers that hijack ArrowUp/ArrowDown and break
    // Chinese input; the document-capture guard neutralizes the whole class
    // before React or any native listener sees the event. Registered as
    // early as possible so no other capture-phase listener can win the
    // ordering race.
    ctx.effect(
      () => {
        try {
          return registerImeGuard()
        } catch (error) {
          fail('ime guard', error)
          return () => {}
        }
      },
      'dsh-better-sidebar: IME composition guard',
    )

    // DSH 0.1.x does not yet carry an icon through the settings.section
    // registration contract: its shell renders a generic gear for every
    // external section. Mark only this plugin's localized nav row so
    // layout.css can paint the requested Side card SVG; the disposer clears
    // the marker for HMR / plugin disable.
    ctx.effect(
      () => registerSettingsNavIcon(() => t('settingsNav')),
      'dsh-better-sidebar: settings navigation icon',
    )

    // The "Side card" settings section: appears in the DSH Settings shell
    // once the shell's declaration is on the ledger (slots.inject waits for
    // it); the section reads/writes the prefs through the plugin's own
    // fenced settings route, keeps the shared store in sync, and renders the
    // declarative enable/disable inventory from the tab/viewer registry.
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'better-sidebar',
      order: 100,
      label: () => t('settingsNav'),
      inject: () => ({ store: sidebarStore, service }),
    }, SideCardSection))
  } catch (error) {
    fail('load', error)
  }
}
