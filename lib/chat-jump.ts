// Resolving a jump target (search result) to something the chat can scroll to.
//
// Only user and assistant messages get their own DOM row; tool results, bash
// executions, and summaries are folded into the surrounding turn, and a turn's
// process messages collapse into one group container. So a jump target is
// mapped to the nearest row at or before it, expressed as the index into
// ChatWindow's `messageRefs` (which counts user/assistant messages in order).

import type { MatchMode } from "./text-match";

/** Where the chat should jump, and what to highlight once it gets there. */
export interface ChatJumpTarget {
  entryId: string;
  /** Query to highlight inside the message. Omitted for a plain jump. */
  query?: string;
  mode?: MatchMode;
  caseSensitive?: boolean;
}

/** Roles that ChatWindow renders as their own scrollable row. */
export function isRenderedRow(role: string): boolean {
  return role === "user" || role === "assistant";
}

/**
 * Index into `messageRefs` for the row that shows `targetEntryId`.
 *
 * Returns -1 when the entry is not loaded or nothing renderable precedes it.
 * `roles[i]` must describe the same message as `entryIds[i]`.
 */
export function findRowIndexForEntry(
  roles: readonly string[],
  entryIds: readonly string[],
  targetEntryId: string,
): number {
  const targetIndex = entryIds.indexOf(targetEntryId);
  if (targetIndex === -1) return -1;

  let rowsSeen = 0;
  let lastRowAtOrBefore = -1;
  const limit = Math.min(roles.length, entryIds.length);
  for (let i = 0; i < limit; i += 1) {
    if (!isRenderedRow(roles[i])) continue;
    if (i <= targetIndex) lastRowAtOrBefore = rowsSeen;
    else break;
    rowsSeen += 1;
  }
  return lastRowAtOrBefore;
}

/**
 * Pick the element to scroll to: the exact entry row when the DOM has it,
 * otherwise the nearest earlier row, because the target may be folded into a
 * collapsed process group whose container is registered at a lower row index.
 */
export function resolveJumpElement(
  rows: ReadonlyArray<HTMLElement | null>,
  rowIndex: number,
  exactElement: HTMLElement | null,
): HTMLElement | null {
  if (exactElement) return exactElement;
  for (let i = Math.min(rowIndex, rows.length - 1); i >= 0; i -= 1) {
    const element = rows[i];
    if (element) return element;
  }
  return null;
}
