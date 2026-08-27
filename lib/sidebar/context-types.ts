import type { BetterSidebarService } from '../../components/sidebar/service'

export interface SidebarHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

export interface SidebarHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

export interface SidebarSession {
  id: string
  cwd: string
  parentSession?: string
}

export interface SidebarSessionSummary {
  id: string
  cwd?: string
  title?: string
  displayTitle?: string
  origin?: string
  parentId?: string
  running?: boolean
  [key: string]: any
}

export interface SidebarSessionList {
  activeSessionId?: string
  sessions: SidebarSessionSummary[]
  list?: any
  fork?: any
  binding?: any
  open?: any
  [key: string]: any
}

export interface SidebarConversation {
  getDraft?(): string
  setDraft?(text: string): void
  [key: string]: any
}

export interface SidebarHistoryEntry {
  id: string
  role?: string
  content?: string | unknown[]
  toolCallId?: string
  event?: any
  [key: string]: any
}

export interface SidebarSubagentAddress {
  agentName?: string
  sessionId?: string
  [key: string]: any
}

export interface SidebarSubagentCatalog {
  [key: string]: any
}

export interface SidebarSubagentChildEntry {
  id: string
  title?: string
  state?: string
  activity?: any
  [key: string]: any
}

export interface SidebarSubagentDiagnosticEntry {
  code?: string
  message?: string
  [key: string]: any
}

export interface SidebarJobView {
  id: string
  title?: string
  status?: string
  running?: boolean
  output?: string
  [key: string]: any
}

export interface ContextLocale {
  active?: string
  subscribe(callback: () => void): () => void
  getSnapshot(): { active: string }
  register(ns: string, lang: string, dict: Record<string, string>): () => void
  lookup?(ns: string, key: string): string | undefined
}

export interface Context {
  betterSidebar?: BetterSidebarService
  session?: SidebarSession
  sessions?: any
  conversation?: any
  locale: ContextLocale
  connection?: any
  slots?: any
  modules?: any
  get(key: string): any
  provide(key: string, value: unknown): void
  effect(fn: () => (() => void) | void, label?: string): () => void
  [key: string]: any
}

export type SidebarJobStatus = any;
export type SidebarSessionEvent = any;
