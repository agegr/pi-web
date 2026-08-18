/**
 * The email-review model: how today's mail is categorised and shown.
 *
 * Client-safe: no `node:fs` here, so the dashboard imports the category list
 * and types directly while the store and the Gmail client stay server-only.
 * This is what turns a raw message list into "here is what came in today and
 * which of it needs you" — the thing Gmail's own inbox does not give you.
 */

export const MAIL_CATEGORIES = [
  "important",
  "interview",
  "oa",
  "appointment",
  "delivery",
  "deadline",
  "document",
  "other",
] as const;

export type MailCategory = (typeof MAIL_CATEGORIES)[number];

/** What the review turn actually created for an item, so the page can badge it. */
export const MAIL_ACTIONS = ["none", "todo", "event", "both"] as const;
export type MailAction = (typeof MAIL_ACTIONS)[number];

export interface MailReviewItem {
  /** Gmail message id, used to link back into the thread. */
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  /** Arrival time as a UTC ISO instant. */
  date: string;
  category: MailCategory;
  /** One line, in the user's language: what this is and what (if anything) to do. */
  summary: string;
  action: MailAction;
}

export interface MailReview {
  /** Local calendar date the review covers. */
  day: string;
  /** UTC ISO instant the review was saved. */
  reviewedAt: string;
  items: MailReviewItem[];
  /** The assistant's plain report, in the user's language — rendered as markdown. */
  report?: string;
}

export function isMailCategory(value: string): value is MailCategory {
  return (MAIL_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeCategory(value: unknown): MailCategory {
  return typeof value === "string" && isMailCategory(value) ? value : "other";
}

export function isMailAction(value: string): value is MailAction {
  return (MAIL_ACTIONS as readonly string[]).includes(value);
}

export function normalizeAction(value: unknown): MailAction {
  return typeof value === "string" && isMailAction(value) ? value : "none";
}

/** How many todos and calendar events a review says it auto-created. */
export function countReviewActions(review: MailReview): { todos: number; events: number } {
  let todos = 0;
  let events = 0;
  for (const item of review.items) {
    if (item.action === "todo" || item.action === "both") todos += 1;
    if (item.action === "event" || item.action === "both") events += 1;
  }
  return { todos, events };
}
