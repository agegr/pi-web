export type ChatScrollPosition =
  | { atBottom: true }
  | {
      atBottom: false;
      anchorEntryId: string;
      anchorOffset: number;
      oldestEntryId: string | null;
    };

export interface ChatScrollAnchorCandidate {
  entryId: string;
  top: number;
  bottom: number;
}

export function findChatScrollAnchor(
  candidates: ChatScrollAnchorCandidate[],
  viewportTop: number,
): Pick<Extract<ChatScrollPosition, { atBottom: false }>, "anchorEntryId" | "anchorOffset"> | null {
  let candidate = candidates[0];
  for (const item of candidates) {
    if (item.top > viewportTop) break;
    candidate = item;
  }
  if (!candidate) return null;
  return {
    anchorEntryId: candidate.entryId,
    anchorOffset: candidate.top - viewportTop,
  };
}
