import {
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "./image-attachments";
import {
  normalizeSelectionContext,
  normalizeSessionReference,
  type SelectionContext,
  type SessionReference,
} from "./composer-context";

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  /** Composer-only selection metadata; omitted by legacy drafts. */
  contexts?: SelectionContext[];
  /** Composer-only historical session references; omitted by legacy drafts. */
  sessionReferences?: SessionReference[];
}

const drafts = new Map<string, ChatDraft>();

function cloneDraft(draft: ChatDraft): ChatDraft {
  const contexts = draft.contexts?.map((context) => ({ ...context }));
  const sessionReferences = draft.sessionReferences?.map((reference) => ({ ...reference }));
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
    ...(draft.contexts !== undefined ? { contexts } : {}),
    ...(draft.sessionReferences !== undefined ? { sessionReferences } : {}),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value
    && draft.images.length === 0
    && (draft.contexts?.length ?? 0) === 0
    && (draft.sessionReferences?.length ?? 0) === 0;
}

function mergeContexts(
  ...lists: Array<SelectionContext[] | undefined>
): SelectionContext[] {
  const merged: SelectionContext[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const context of list ?? []) {
      const normalized = normalizeSelectionContext(context);
      if (!normalized) continue;
      const key = [
        normalized.sourceSessionId ?? "",
        normalized.sourceEntryId ?? "",
        normalized.sourceStartOffset ?? "",
        normalized.sourceEndOffset ?? "",
        normalized.text,
      ].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...normalized });
    }
  }
  return merged;
}

function mergeSessionReferences(
  ...lists: Array<SessionReference[] | undefined>
): SessionReference[] {
  const merged: SessionReference[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const reference of list ?? []) {
      const normalized = normalizeSessionReference(reference);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      merged.push(normalized);
    }
  }
  return merged;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key);
  return draft ? cloneDraft(draft) : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, cloneDraft(draft));
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

export function mergeRestoredSubmissionText(submitted: string, current: string): string {
  if (!submitted.trim()) return current;
  if (!current.trim()) return submitted;
  return `${submitted}\n\n${current}`;
}

export function mergeRestoredSubmissionDraft(
  submittedText: string,
  submittedImages: ChatDraftImage[] | undefined,
  currentText: string,
  currentImages: ChatDraftImage[],
  submittedContexts?: SelectionContext[],
  currentContexts?: SelectionContext[],
  submittedSessionReferences?: SessionReference[],
  currentSessionReferences?: SessionReference[],
): ChatDraft {
  const images = [...(submittedImages ?? []), ...currentImages]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(({ data, mimeType }) => ({ data, mimeType }));

  const contexts = mergeContexts(submittedContexts, currentContexts);
  const sessionReferences = mergeSessionReferences(submittedSessionReferences, currentSessionReferences);
  return {
    value: mergeRestoredSubmissionText(submittedText, currentText),
    images,
    ...(submittedContexts !== undefined || currentContexts !== undefined ? { contexts } : {}),
    ...(submittedSessionReferences !== undefined || currentSessionReferences !== undefined ? { sessionReferences } : {}),
  };
}

export function restoreDraftSubmission(
  key: string,
  text: string,
  images?: ChatDraftImage[],
  contexts?: SelectionContext[],
  sessionReferences?: SessionReference[],
): ChatDraft {
  const current = getDraft(key) ?? { value: "", images: [], contexts: [], sessionReferences: [] };
  const restored = mergeRestoredSubmissionDraft(
    text,
    images,
    current.value,
    current.images,
    contexts,
    current.contexts,
    sessionReferences,
    current.sessionReferences,
  );
  setDraft(key, restored);
  return restored;
}

export function rekeyDraft(
  previousKey: string,
  nextKey: string,
  currentDraft?: ChatDraft,
): ChatDraft | null {
  if (previousKey === nextKey) return currentDraft ? cloneDraft(currentDraft) : getDraft(nextKey);

  const storedPrevious = getDraft(previousKey);
  const previous = currentDraft && !isEmptyDraft(currentDraft)
    ? cloneDraft(currentDraft)
    : (storedPrevious ?? (currentDraft ? cloneDraft(currentDraft) : null));
  const next = getDraft(nextKey);
  clearDraft(previousKey);
  if (!previous) return next;

  const merged = next
    ? mergeRestoredSubmissionDraft(
        next.value,
        next.images,
        previous.value,
        previous.images,
        next.contexts,
        previous.contexts,
        next.sessionReferences,
        previous.sessionReferences,
      )
    : previous;
  setDraft(nextKey, merged);
  return cloneDraft(merged);
}
