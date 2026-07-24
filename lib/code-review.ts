import type { GitReviewFile, GitReviewResponse } from "./git-types";

export interface ReviewNavigationItem {
  key: string;
  fileId: string;
  hunkId?: string;
  actionable: boolean;
  pending: boolean;
}

export function getReviewNavigationItems(review: GitReviewResponse): ReviewNavigationItem[] {
  return review.files.flatMap((file) => {
    if (file.granular && file.hunks.length > 0) {
      return file.hunks.map((hunk) => ({
        key: `${file.id}:${hunk.id}`,
        fileId: file.id,
        hunkId: hunk.id,
        actionable: file.actionable,
        pending: hunk.decision === "pending",
      }));
    }
    return [{
      key: file.id,
      fileId: file.id,
      actionable: file.actionable,
      pending: file.actionable && file.decision === "pending",
    }];
  });
}

export function nextReviewItemKey(
  review: GitReviewResponse,
  currentKey: string | null,
  options: { pendingOnly?: boolean; direction?: 1 | -1 } = {},
): string | null {
  const items = getReviewNavigationItems(review);
  if (items.length === 0) return null;
  const direction = options.direction ?? 1;
  const currentIndex = items.findIndex((item) => item.key === currentKey);
  if (currentIndex === -1) {
    const candidates = items.filter((item) => !options.pendingOnly || item.pending);
    return direction === 1 ? candidates[0]?.key ?? null : candidates[candidates.length - 1]?.key ?? null;
  }
  for (let offset = 1; offset <= items.length; offset++) {
    const candidate = items[(currentIndex + direction * offset + items.length * 2) % items.length];
    if (!options.pendingOnly || candidate.pending) return candidate.key;
  }
  return null;
}

export function findReviewFile(review: GitReviewResponse, key: string | null): GitReviewFile | null {
  if (!key) return review.files[0] ?? null;
  const item = getReviewNavigationItems(review).find((candidate) => candidate.key === key);
  return review.files.find((file) => file.id === item?.fileId) ?? review.files[0] ?? null;
}

export function reviewCounts(review: GitReviewResponse): { total: number; pending: number; accepted: number; rejected: number } {
  const actionable = getReviewNavigationItems(review).filter((item) => item.actionable);
  let accepted = 0;
  let rejected = 0;
  for (const file of review.files) {
    if (file.granular) {
      accepted += file.hunks.filter((hunk) => hunk.decision === "accepted").length;
      rejected += file.hunks.filter((hunk) => hunk.decision === "rejected").length;
    } else if (file.actionable) {
      if (file.decision === "accepted") accepted++;
      if (file.decision === "rejected") rejected++;
    }
  }
  return { total: actionable.length, pending: actionable.filter((item) => item.pending).length, accepted, rejected };
}
