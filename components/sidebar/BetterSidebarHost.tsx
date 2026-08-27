"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { createSidebarStore, type SidebarStore } from './state'
import { createBetterSidebarService, type BetterSidebarService } from './service'
import { registerBuiltins } from './builtins/index'
import { Sidebar } from './Sidebar'
import { RenderBoundary } from './RenderBoundary'
import { attachLocale, zh, en, ja, LOCALE_NS } from './locales'
import type { Context, ContextLocale } from './context-types'
import { useI18n } from '@/hooks/useI18n'
import css from './sidebar.module.css'
import './layout.css'

interface BetterSidebarHostProps {
  sessionId: string
  cwd: string
  onInsertMention?: (mentionText: string) => void
  onOpenNewSession?: (prompt?: string) => void
  /**
   * Called when the user clicks a file in the Files tab. When provided the
   * file is opened in AppShell's native right-panel FileViewer instead of the
   * chunk-loaded CodeMirror editor.
   */
  onOpenFile?: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null }) => void
  /**
   * Left-dock mode: render the workbench IN FLOW inside the app's own left
   * sidebar column (a tab strip switches between the native sessions view and
   * the workbench) instead of the fixed right/bottom overlay panels.
   */
  embedded?: boolean
  /** The native sessions view shown by the "sessions" tab in embedded mode. */
  sessionsView?: ReactNode
  /** Reports the left-dock view so the host can drive it from outside (e.g. a
   *  top-bar toggle button that mirrors the dock tab strip). */
  onViewChange?: (view: 'sessions' | 'workbench') => void
}

/** Imperative handle for driving the left dock from an external entry point
 *  (the top-bar sidebar button): toggle between the sessions view and the
 *  workbench, opening a workbench tab when entering the workbench. */
export interface BetterSidebarHostHandle {
  toggleWorkbench(tab?: string): void
  openFileInSidebar(fullPath: string): void
}

export const BetterSidebarHost = forwardRef<BetterSidebarHostHandle, BetterSidebarHostProps>(function BetterSidebarHost({
  sessionId,
  cwd,
  onInsertMention,
  onOpenFile,
  embedded = false,
  sessionsView,
  onViewChange,
}, ref) {
  const [mounted, setMounted] = useState(false)
  const [leftView, setLeftView] = useState<'sessions' | 'workbench'>('sessions')
  const [workbenchTab, setWorkbenchTab] = useState<string>('editor')
  const { locale: appLocale } = useI18n()

  useEffect(() => {
    setMounted(true)
  }, [])

  const store = useMemo<SidebarStore>(() => {
    return createSidebarStore()
  }, [])

  const service = useMemo<BetterSidebarService>(() => {
    return createBetterSidebarService(store)
  }, [store])

  useImperativeHandle(ref, () => ({
    toggleWorkbench: (tab?: string) => {
      const next = leftView === 'workbench' ? 'sessions' : 'workbench'
      setLeftView(next)
      onViewChange?.(next)
      if (next === 'workbench') {
        const type = tab ?? workbenchTab
        setWorkbenchTab(type)
        service.openTab({ type }, { sessionId, cwd })
      }
    },
    openFileInSidebar: (fullPath: string) => {
      setWorkbenchTab('editor')
      setLeftView('workbench')
      onViewChange?.('workbench')
      service.openTab({ type: 'editor', path: fullPath }, { sessionId, cwd })
    },
  }), [leftView, workbenchTab, onViewChange, service, sessionId, cwd])

  // Stable reactive locale snapshot
  const localeListeners = useRef(new Set<() => void>())
  const activeLangRef = useRef<string>(String(appLocale).startsWith('zh') ? 'zh' : String(appLocale) === 'ja' ? 'ja' : 'en')
  const localeSnapshotRef = useRef<{ active: string }>({ active: activeLangRef.current })

  useEffect(() => {
    const lang = String(appLocale).startsWith('zh') ? 'zh' : String(appLocale) === 'ja' ? 'ja' : 'en'
    if (activeLangRef.current !== lang) {
      activeLangRef.current = lang
      localeSnapshotRef.current = { active: lang }
      localeListeners.current.forEach((fn) => fn())
    }
  }, [appLocale])

  const contextLocale = useMemo<ContextLocale>(() => {
    const dicts: Record<string, Record<string, Record<string, string>>> = {
      [LOCALE_NS]: { zh, en, ja },
    }

    return {
      get active() {
        return activeLangRef.current
      },
      subscribe: (callback: () => void) => {
        localeListeners.current.add(callback)
        return () => {
          localeListeners.current.delete(callback)
        }
      },
      getSnapshot: () => localeSnapshotRef.current,
      register: (ns: string, lang: string, dict: Record<string, string>) => {
        if (!dicts[ns]) dicts[ns] = {}
        dicts[ns][lang] = dict
        localeListeners.current.forEach((fn) => fn())
        return () => {
          delete dicts[ns]?.[lang]
        }
      },
      lookup: (ns: string, key: string) => {
        return dicts[ns]?.[activeLangRef.current]?.[key] ?? dicts[ns]?.['en']?.[key]
      },
    }
  }, [])

  useEffect(() => {
    attachLocale(contextLocale as any)
  }, [contextLocale])

  // Stable reactive session list snapshot
  const sessionListeners = useRef(new Set<() => void>())
  const sessionSnapshotRef = useRef<{ current: string; byId: Record<string, any> }>({
    current: sessionId,
    byId: {
      [sessionId]: {
        id: sessionId,
        cwd,
        displayTitle: 'Session',
        title: 'Session',
      },
    },
  })

  useEffect(() => {
    if (
      sessionSnapshotRef.current.current !== sessionId ||
      sessionSnapshotRef.current.byId[sessionId]?.cwd !== cwd
    ) {
      sessionSnapshotRef.current = {
        current: sessionId,
        byId: {
          [sessionId]: {
            id: sessionId,
            cwd,
            displayTitle: 'Session',
            title: 'Session',
          },
        },
      }
      sessionListeners.current.forEach((fn) => fn())
    }
  }, [sessionId, cwd])

  const sessionsList = useMemo(() => ({
    subscribe: (callback: () => void) => {
      sessionListeners.current.add(callback)
      return () => {
        sessionListeners.current.delete(callback)
      }
    },
    getSnapshot: () => sessionSnapshotRef.current,
  }), [])

  const ctxRef = useRef<Context | null>(null)

  const ctx = useMemo<Context>(() => {
    const contextObj: Context = {
      session: {
        id: sessionId,
        cwd,
      },
      sessions: {
        activeSessionId: sessionId,
        sessions: [{ id: sessionId, cwd }],
        list: sessionsList,
        scope: () => contextObj,
      },
      conversation: {
        getDraft: () => '',
        setDraft: (text: string) => {
          if (onInsertMention && text) {
            onInsertMention(text)
          }
        },
      },
      locale: contextLocale,
      betterSidebar: service,
      get: (key: string) => {
        if (key === 'betterSidebar') return service
        if (key === 'locale') return contextLocale
        if (key === 'nativeOpenFile') return onOpenFile
        return undefined
      },
      provide: (_key: string, _val: unknown) => {
        // no-op
      },
      effect: (fn: () => (() => void) | void) => {
        const disposer = fn()
        return () => {
          if (typeof disposer === 'function') disposer()
        }
      },
    }
    ctxRef.current = contextObj
    return contextObj
  }, [sessionId, cwd, contextLocale, service, onInsertMention, onOpenFile, sessionsList])

  // Register built-in tabs and viewers once on mount
  useEffect(() => {
    if (!ctxRef.current) return
    const dispose = registerBuiltins(ctxRef.current, service, {
      terminalTitle: () => 'Terminal',
    })
    return () => {
      dispose()
    }
  }, [service])

  if (!mounted) return null

  if (embedded) {
    // The left column shows the native sessions view by default; the top-bar
    // "侧边栏" button toggles it to the better-sidebar workbench (single entry
    // point — no in-dock tab strip).
    return (
      <div className={css.leftDock} data-dsh-left-dock>
        {leftView === 'sessions' ? (
          sessionsView
        ) : (
          <RenderBoundary className={css.boundaryError}>
            <Sidebar ctx={ctx} store={store} embedded />
          </RenderBoundary>
        )}
      </div>
    )
  }

  return (
    <div className="better-sidebar-root">
      <RenderBoundary className={css.boundaryError}>
        <Sidebar ctx={ctx} store={store} />
      </RenderBoundary>
    </div>
  )
})
