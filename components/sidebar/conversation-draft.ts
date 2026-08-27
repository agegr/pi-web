import type { Context } from './context-types'

export function appendToDraft(ctx: Context, sessionId: string, text: string): boolean {
  try {
    if (typeof ctx.conversation?.setDraft === 'function') {
      ctx.conversation.setDraft(text)
      return true
    }
    return false
  } catch (error) {
    console.warn('[dsh-better-sidebar] draft insert failed:', error)
    return false
  }
}
