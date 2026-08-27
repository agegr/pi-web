/**
 * Side Chat transcript mapping (browser half): turns a thread child's
 * history rows (`session.history` — the generic RPC, which reads the durable
 * log without activating the child) into compact display rows.
 *
 * A thread child's log starts with the ENTIRE inherited parent log as its
 * fork seed. The mapping therefore cuts everything up to the LAST
 * `session/end-seed` marker and maps context injections (the "Side
 * conversation boundary" prompt, plugin-sourced context) onto a collapsible
 * injection row, so the view shows only the thread's own conversation.
 *
 * Live streaming: `assistant/message` events only land when a step
 * completes, but `assistant/chunk` events stream token-level text and
 * reasoning deltas. The mapping accumulates both per block and supersedes
 * them with the assembled message once it lands (settled rows).
 */
import type { SidebarHistoryEntry } from './context-types'
import { isContextInjectionMessage, SIDE_BOUNDARY_PROMPT } from './sidechat-core'

/** One compact transcript row rendered in the thread view. `seq` is the
 *  source event's log sequence — stable row identity for React keys across
 *  polls (streaming caches ride the key, so window slides must not re-key
 *  rows). */
export type SidechatTranscriptRow =
  | { kind: 'user'; seq: number; text: string }
  /** A context injection (the side boundary prompt + the parked in-progress
   *  snapshot, or any plugin-sourced context): rendered as one collapsible
   *  row, never as a user bubble. */
  | { kind: 'injection'; seq: number; text: string }
  /** `settled` distinguishes an assembled message from a still-streaming
   *  chunk accumulation (streaming rows are superseded by the settle). */
  | { kind: 'assistant'; seq: number; text: string; settled: boolean }
  | { kind: 'reasoning'; seq: number; text: string; settled: boolean }
  | {
    kind: 'tool'
    seq: number
    name: string
    failed: boolean
    /** Raw arguments JSON as the model produced it. */
    args?: string
    /** Plain text of the paired result. */
    resultText?: string
    /** True while the call's result has not landed yet. */
    executing?: boolean
  }

/** Extract the visible text of a content-block list (`text` blocks verbatim,
 *  joined by blank lines); empty reads `…` so rows never render blank. */
export function blockText(content: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      parts.push(candidate.text)
    }
  }
  const text = parts.join('\n\n')
  return text === '' ? '…' : text
}

/** Cap for a tool row's one-line argument summary (display only). */
const ARGS_SUMMARY_MAX = 80

/** The most identifying argument keys, in priority order (bash's command,
 *  fs tools' paths, search's pattern, …). */
const ARGS_SUMMARY_KEYS = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt'] as const

function flatTruncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > ARGS_SUMMARY_MAX ? `${flat.slice(0, ARGS_SUMMARY_MAX - 1)}…` : flat
}

/**
 * One-line summary of a tool call's raw arguments JSON for the collapsed
 * row: the first identifying string field when the JSON parses, else the
 * flattened raw text; empty when there is nothing worth showing.
 */
export function toolArgsSummary(args: string | undefined): string {
  if (args === undefined) return ''
  try {
    const parsed = JSON.parse(args) as Record<string, unknown> | null
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of ARGS_SUMMARY_KEYS) {
        const value = parsed[key]
        if (typeof value === 'string' && value.trim() !== '') return flatTruncate(value)
      }
    }
  } catch {
    // Raw text fallthrough.
  }
  return flatTruncate(args)
}

/** The plain text of a tool/result message (text blocks inside its
 *  `tool-result` content block). */
function resultTextOf(data: Record<string, unknown>): string {
  const message = data.message as { content?: unknown } | undefined
  const content = message?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; content?: unknown }
    if (candidate.type !== 'tool-result') continue
    const inner = candidate.content
    if (!Array.isArray(inner)) continue
    for (const item of inner) {
      if (item === null || typeof item !== 'object') continue
      const textItem = item as { type?: unknown; text?: unknown }
      if (textItem.type === 'text' && typeof textItem.text === 'string') {
        parts.push(textItem.text)
      }
    }
  }
  return parts.join('\n')
}

/** Index of the last `session/end-seed` event (fork seed marker), or -1. */
function lastSeedEnd(events: readonly { type: string }[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 'session/end-seed') return index
  }
  return -1
}

/**
 * Collect the thread's OWN events on first attach: walk backward from the
 * log tail (oldest-first accumulation) until the `session/end-seed` marker
 * surfaces, then keep everything after it.
 *
 * Page size matters: cold reads re-expand persisted chunk-rows into one
 * `assistant/chunk` event per delta, so a single streamed answer can be
 * HUNDREDS of events. A small walk window (the old 8×32 = 256 events) let
 * earlier `tool/call` events fall out of the loaded window — the tool rows
 * vanished on re-entry while the settled text survived. The walk therefore
 * pages big; tail polls stay small.
 *
 * Exhaustion (log start reached without a marker — a thread created before
 * seeding existed, or a pathological log) returns `seedBoundary: 0` so the
 * caller stops re-walking and renders the window as-is.
 *
 * @param fetchPage - one history page (newest-first window ending at
 *   `beforeSeq`, exclusive; omit for the tail page).
 * @param pageCap - safety bound on backward pages.
 */
export async function collectOwnEvents(
  fetchPage: (beforeSeq?: number) => Promise<readonly SidebarHistoryEntry[]>,
  pageCap = 40,
): Promise<{ seedBoundary: number; entries: SidebarHistoryEntry[] }> {
  const collected: SidebarHistoryEntry[] = []
  let beforeSeq: number | undefined
  for (let page = 0; page < pageCap; page++) {
    const events = await fetchPage(beforeSeq)
    if (events.length === 0) {
      // Log start reached without a marker: the window IS the whole log.
      return { seedBoundary: 0, entries: collected }
    }
    const olderThan = collected.length > 0 ? collected[0]!.event.seq : undefined
    const fresh = olderThan === undefined
      ? [...events]
      : events.filter(entry => entry.event.seq < olderThan)
    const seedEnd = fresh.findLastIndex(entry => entry.event.type === 'session/end-seed')
    if (seedEnd >= 0) {
      collected.unshift(...fresh.slice(seedEnd + 1))
      return { seedBoundary: fresh[seedEnd]!.event.seq, entries: collected }
    }
    collected.unshift(...fresh)
    if (fresh.length === 0) {
      // The page overlaps entirely with what we have: nothing older exists.
      return { seedBoundary: 0, entries: collected }
    }
    beforeSeq = fresh[0]!.event.seq
  }
  // Cap hit: accept the window (it is overwhelmingly the thread's own tail)
  // rather than re-walking on every poll.
  return { seedBoundary: 0, entries: collected }
}

/**
 * Map a thread child's history rows onto compact transcript rows: the
 * inherited fork seed is cut at the last `session/end-seed`, context
 * injections map onto a collapsible injection row, `assistant/chunk`
 * deltas accumulate into streaming rows per (turn, step, block) and are
 * superseded by the assembled `assistant/message`, and tool invocations
 * render one expandable line each (arguments, paired result text, failure
 * marker; a still-executing call is marked until its result lands).
 * @param entries - history rows (event + host-computed view) in seq order.
 * @returns display rows in log order.
 */
export function transcriptRows(entries: readonly SidebarHistoryEntry[]): SidechatTranscriptRow[] {
  const events = entries.map(entry => entry.event)
  const seedEnd = lastSeedEnd(events)
  const rows: SidechatTranscriptRow[] = []
  /** (turn, step, index, kind) key → index of its accumulating stream row. */
  const streamRows = new Map<string, number>()
  /** tool callId → index of its tool row in `rows` (result pairing). */
  const callRows = new Map<string, number>()
  for (let index = 0; index < events.length; index++) {
    if (index <= seedEnd) continue
    const event = events[index]
    if (event === undefined) continue
    const data = event.data as Record<string, unknown>
    switch (event.type) {
      case 'user/message': {
        const text = blockText(Array.isArray(data.content) ? data.content : [])
        // Context injections (the boundary prompt + snapshot, plugin-sourced
        // context) collapse into an injection row; genuine user messages —
        // including the FIRST one, which the host now delivers as its own
        // event — render as user rows.
        if (isContextInjectionMessage(data)) {
          const source = data.source as { kind?: unknown } | undefined
          // Threads logged BEFORE the host split carry boundary(+snapshot)+
          // question in ONE 'user' message. The boundary prompt is a known
          // constant, so the message splits THERE: the injection row keeps
          // the prompt, the remainder (snapshot + question if any — pure
          // question in the common case) renders as the user's real message.
          if (source?.kind === 'user' && text.startsWith(`${SIDE_BOUNDARY_PROMPT}\n\n`)) {
            rows.push({ kind: 'injection', seq: event.seq, text: SIDE_BOUNDARY_PROMPT })
            const body = text.slice(SIDE_BOUNDARY_PROMPT.length + 2)
            if (body !== '') rows.push({ kind: 'user', seq: event.seq, text: body })
            break
          }
          rows.push({ kind: 'injection', seq: event.seq, text })
          break
        }
        rows.push({ kind: 'user', seq: event.seq, text })
        break
      }
      case 'assistant/chunk': {
        const chunk = data.chunk as { type?: unknown; text?: unknown } | undefined
        if (chunk === null || typeof chunk !== 'object') break
        const kind = chunk.type === 'text-delta' ? 'assistant' : chunk.type === 'reasoning-delta' ? 'reasoning' : null
        if (kind === null || typeof chunk.text !== 'string' || chunk.text === '') break
        const turn = data.turn
        const step = data.step
        const blockIndex = (chunk as { index?: unknown }).index
        const key = `${String(turn)}:${String(step)}:${String(blockIndex)}:${kind}`
        const existing = streamRows.get(key)
        if (existing !== undefined) {
          const row = rows[existing]
          if (row !== undefined && row.kind === kind && !row.settled) {
            rows[existing] = { ...row, text: row.text + chunk.text }
          }
        } else {
          streamRows.set(key, rows.length)
          rows.push({ kind, seq: event.seq, text: chunk.text, settled: false })
        }
        break
      }
      case 'assistant/message': {
        const prefix = `${String(data.turn)}:${String(data.step)}:`
        const streamed = [...streamRows.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, rowIndex]) => rowIndex)
        for (const key of [...streamRows.keys()]) {
          if (key.startsWith(prefix)) streamRows.delete(key)
        }
        const content = Array.isArray((data.message as { content?: unknown } | undefined)?.content)
          ? (data.message as { content: readonly unknown[] }).content
          : []
        const settled: SidechatTranscriptRow[] = content.flatMap((block): SidechatTranscriptRow[] => {
          if (block === null || typeof block !== 'object') return []
          const candidate = block as { type?: unknown; text?: unknown }
          if (candidate.type === 'reasoning' && typeof candidate.text === 'string' && candidate.text !== '') {
            return [{ kind: 'reasoning', seq: event.seq, text: candidate.text, settled: true }]
          }
          if (candidate.type === 'text' && typeof candidate.text === 'string' && candidate.text !== '') {
            return [{ kind: 'assistant', seq: event.seq, text: candidate.text, settled: true }]
          }
          return []
        })
        if (streamed.length === 0) rows.push(...settled)
        else rows.splice(Math.min(...streamed), streamed.length, ...settled)
        break
      }
      case 'tool/call': {
        const callId = data.callId
        const name = typeof data.name === 'string' ? data.name : 'tool'
        const args = typeof data.arguments === 'string' ? data.arguments : undefined
        const rowIndex = rows.length
        if (typeof callId === 'string') callRows.set(callId, rowIndex)
        rows.push({ kind: 'tool', seq: event.seq, name, failed: false, args, executing: true })
        break
      }
      case 'tool/result': {
        const source = data.message as { source?: { callId?: unknown } } | undefined
        const callId = typeof source?.source?.callId === 'string' ? source.source.callId : undefined
        const rowIndex = callId === undefined ? undefined : callRows.get(callId)
        const failed = data.error !== undefined
        const resultText = resultTextOf(data)
        if (rowIndex !== undefined) {
          const row = rows[rowIndex]
          if (row !== undefined && row.kind === 'tool') {
            rows[rowIndex] = {
              ...row,
              failed: row.failed || failed,
              resultText: resultText === '' ? row.resultText : resultText,
              executing: false,
            }
          }
        } else if (failed || resultText !== '') {
          // Orphan result (no call row in the window): surface it so the row
          // stays informative and expandable.
          rows.push({
            kind: 'tool',
            seq: event.seq,
            name: callId === undefined ? 'tool' : `tool:${callId.slice(0, 8)}`,
            failed,
            resultText: resultText === '' ? undefined : resultText,
          })
        }
        break
      }
      default: {
        break
      }
    }
  }
  return rows
}
