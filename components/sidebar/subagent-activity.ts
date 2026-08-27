/**
 * Pure derivation of the compact LIVE line shown on a running subagent card:
 * the last text output and the last tool call of the child's session events.
 * The host batch route feeds raw session events into this parser; the client
 * only receives the already-folded `LastActivity` map. Renders nothing
 * itself — the SubagentView component turns this into the card's status
 * lines. Kept framework-free so the parser is unit-testable in the node
 * environment.
 */
import type { SidebarSessionEvent } from './context-types'

/**
 * Extract the concatenated plain text of a content-block list (the durable
 * `ContentBlock[]` shape, structurally: blocks with `type: 'text'` carry
 * `text`; anything else — tool_use, image, … — contributes nothing).
 * @param content - the raw `content` field of a message event.
 * @returns the joined text, or undefined when the message carries no text.
 */
export function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      parts.push(candidate.text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

/** The live status of one subagent card (both fields optional). */
export interface LastActivity {
  /** The latest assembled assistant text output in the tail. */
  text?: string
  /** The latest tool call in the tail. */
  tool?: { name: string; args: string }
}

/**
 * Fold a session event log into the last text output + last tool call (each
 * is the LAST occurrence in event order). Lifecycle events and raw
 * `assistant/chunk` rows are ignored — the card shows what the subagent is
 * doing right now, not its plumbing. The scan runs BACKWARD from the newest
 * event and stops once both fields are found, so a long history costs only
 * the recent tail in the common case.
 * @param events - the session's append-only event log (oldest → newest).
 * @param maxMessages - optional message-boundary window: only the tail's
 *   last `maxMessages` surface messages (`user/message`, `assistant/message`)
 *   and the events between them are considered, mirroring the old
 *   `subagents.history({ maxMessages })` window. Stale activity older than
 *   the window is never surfaced, and a long log is never scanned in full.
 * @returns the last text and/or tool call; an empty object when the log has neither.
 */
export function lastActivity(
  events: readonly SidebarSessionEvent[],
  maxMessages = Infinity,
): LastActivity {
  let text: string | undefined
  let tool: { name: string; args: string } | undefined
  let messagesSeen = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (text !== undefined && tool !== undefined) break
    const event = events[index]
    if (event === undefined) continue
    const { type, data } = event
    if (type === 'user/message' || type === 'assistant/message') {
      messagesSeen += 1
      if (messagesSeen > maxMessages) break
    } else if (messagesSeen >= maxMessages) {
      // The window already holds its `maxMessages` messages: anything older
      // than the oldest in-window message sits outside the recent window.
      continue
    }
    if (text === undefined && type === 'assistant/message') {
      const message = data.message as { content?: unknown } | undefined
      const extracted = contentText(message?.content)
      if (extracted !== undefined) text = extracted
    } else if (tool === undefined && type === 'tool/call') {
      tool = {
        name: typeof data.name === 'string' ? data.name : 'tool',
        args: typeof data.arguments === 'string' ? data.arguments : '',
      }
    }
  }
  if (text === undefined && tool === undefined) return {}
  return {
    ...(text === undefined ? {} : { text }),
    ...(tool === undefined ? {} : { tool }),
  }
}
