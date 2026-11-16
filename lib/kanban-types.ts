/**
 * Client-safe types and constants of the kanban domain: one board per project,
 * stored server-side under pi's shared agent storage
 * (`<agentDir>/kanban/<encoded-project-root>/kanban.json`, `lib/kanban-store.ts`).
 * No node: imports here; the rules live in `lib/kanban-shared.ts`.
 */

export interface KanbanLane {
  id: string;
  name: string;
  /** UI text, shown in the board views. Never injected into a run. */
  description: string;
  /**
   * Model-facing "how to work here" text, injected as one custom message when
   * a session's card is in this lane or short of it — a card still in Todo
   * hears Plan's text before it gets there (`lib/kanban-extension.ts`). Absent
   * or blank means none; capped at `KANBAN_LANE_INSTRUCTIONS_MAX` characters.
   */
  instructions?: string;
  /** The first lane, "backlog": never renamed, moved or removed. */
  fixed?: boolean;
}

export interface KanbanCard {
  id: string;
  /**
   * The card's number on this board: 1, 2, 3… assigned once at creation, never
   * reused after a delete, and never changed by an edit. `0` only appears on a
   * hand-edited row the reader repairs. The human handle is the key the board
   * renders from this number (`PIW-42`); the `id` stays the storage key.
   */
  number: number;
  title: string;
  description: string;
  laneId: string;
  /** The linked pi session id, or null for a sessionless card. */
  sessionId: string | null;
  /** Display name of the session, snapshotted at link time and kept after an unlink. */
  sessionTitle: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * The board's agent notice, as the project's Configure dialog edits it: the line
 * a run gets about its card (a template with placeholders) and how often that
 * line is repeated while the run keeps going (every N turns, 0 = never).
 * Absent from a board that never stored one — the injected face of the board's
 * rules, kept beside the lanes' instructions rather than in a global setting so
 * one project can be tuned without touching the others.
 */
export interface KanbanBoardNotice {
  /** The card line's template; `""` means the built-in line (`KANBAN_NOTICE_TEMPLATE_DEFAULT`). */
  template: string;
  /** Re-send the card line every N turns of a session; `0` is off. */
  reminderTurns: number;
}

export interface KanbanBoard {
  projectDir: string;
  lanes: KanbanLane[];
  cards: KanbanCard[];
  /**
   * The board's card-key prefix (`PIW`, so a card reads `PIW-42`). One per
   * project, stored in the board file, rendered never stored on a card: a
   * rename therefore renames every card at once without touching a row.
   */
  cardPrefix: string;
  /** The number the next new card takes. Monotonic: a deleted card's number is never reused. */
  nextCardNumber: number;
  /** Prefixes this board used before a rename, so old references still resolve. Never rendered. */
  cardPrefixAliases?: string[];
  /** What a run is told about its card, and how often. Absent: the built-in line, no reminder. */
  notice?: KanbanBoardNotice;
}

/**
 * One entry of a card's comment thread: the note a person or a session leaves
 * for whoever works the card next. Kept in its own table (never on the card
 * row), read per card, and never part of the board payload.
 */
export interface KanbanComment {
  id: string;
  cardId: string;
  /** Who wrote it: the person in the browser, or the agent of a pi session. */
  author: "user" | "agent";
  /** The writing session, for an agent entry. */
  sessionId: string | null;
  sessionTitle: string | null;
  body: string;
  createdAt: number;
}

/** What `GET /api/kanban/comments` answers: one card's thread, oldest first. */
export interface KanbanCommentsResponse {
  cardId: string;
  comments: KanbanComment[];
  /** Every entry of the card, including the ones this page left out. */
  total: number;
  revision: number;
}

/**
 * One automatic entry of a card's history: what the board did to the card,
 * derived from the write that did it (never posted by a browser). It is stored
 * in its own table beside the comments, read per card, and kept out of the
 * board payload and the run notice exactly like a thread.
 */
export interface KanbanActivity {
  id: string;
  cardId: string;
  kind: KanbanActivityKind;
  /** Where it came from: the previous lane name, the old title, the unlinked session's name. */
  from: string | null;
  /** Where it arrived: the new lane name, the new title, the linked session's name. */
  to: string | null;
  /** The session whose tool call made the change; null for a person in the browser. */
  actorSessionId: string | null;
  actorSessionTitle: string | null;
  createdAt: number;
}

/**
 * - `created`: the card was added to a lane.
 * - `moved`: it changed lane (a drag, a menu move, the demo advance, `kanban update`).
 * - `title` / `description`: its text was edited.
 * - `linked` / `unlinked`: a session came or went.
 * - `lane-deleted`: its lane was removed and the card relocated — one row, not a move plus an unlink.
 *
 * A position-only reorder inside a lane is not an event: it would add a row to
 * every drag with nothing for a reader to learn.
 */
export type KanbanActivityKind = "created" | "moved" | "title" | "description" | "linked" | "unlinked" | "lane-deleted";

/** What `GET /api/kanban/activity` answers: one card's history, oldest first. */
export interface KanbanActivityResponse {
  cardId: string;
  activity: KanbanActivity[];
  /** Every entry of the card, including the ones this page left out. */
  total: number;
  revision: number;
}

/** `GET /api/kanban/activity` answers at most this many rows per request. */
export const KANBAN_ACTIVITY_PAGE_LIMIT = 50;

/** Events kept per card; the oldest are dropped as new ones are written. */
export const KANBAN_ACTIVITY_KEEP = 200;

/** The SQLite board file's schema stamp (`PRAGMA user_version`). */
export const KANBAN_SCHEMA_VERSION = 5;

/** A card key's prefix: 2–10 characters, a letter first, then letters and digits (no dash — it is the separator). */
export const KANBAN_PREFIX_MIN = 2;
export const KANBAN_PREFIX_MAX = 10;
const PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9]{1,9}$/;

/** Uppercases and validates a prefix; null when it cannot be a card prefix. */
export function normalizeKanbanPrefix(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  return PREFIX_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * The prefix a board starts with, derived from the project root's own name:
 * letters and digits of the last path segment, uppercased and shortened
 * (`pi-web` → `PIWEB`). Only the initial default — the user may rename it.
 */
export function defaultCardPrefix(projectDir: string): string {
  const segment = projectDir.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
  const letters = segment.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (letters.length >= KANBAN_PREFIX_MIN) return letters.slice(0, 5);
  // A folder called `1` or `…` has no usable name: CARD is honest, and unique
  // enough once the store's collision suffix is applied.
  return "CARD";
}

/** The human handle of a card: `PIW-42`. Rendered from the board, never stored. */
export function kanbanCardKey(board: Pick<KanbanBoard, "cardPrefix">, card: Pick<KanbanCard, "number">): string {
  return `${board.cardPrefix}-${card.number}`;
}


/**
 * The last version the replaced JSON storage wrote. Its files are frozen at 1
 * and imported leniently (`parseJsonBoard` in `lib/kanban-store.ts`); a JSON
 * board claiming a higher version is from a newer pi-web and stays in place.
 */
export const KANBAN_JSON_SCHEMA_VERSION = 1;

/** What the board's legacy shared `kanban.json` (schema 1) held. */
export interface KanbanEnvelope {
  schemaVersion: number;
  board: KanbanBoard;
}

/** The id of the fixed first lane of every board. */
export const KANBAN_BACKLOG_LANE_ID = "lane-backlog";

/**
 * What a fresh composer's session will do on the board once it exists: nothing,
 * a new card in a lane, or a link onto an existing sessionless card. The
 * composer's "Track on board" control picks it, and the board card menu's
 * "Start session" pre-picks the attach form, so both directions meet in this
 * one control. Before the session exists it is only a plan; the shell applies
 * it when pi answers with the real session id.
 */
export type KanbanNewSessionPick =
  | { kind: "off" }
  | { kind: "new-card"; laneId: string }
  | { kind: "attach"; cardId: string; cardTitle: string };

/** A pick held by the shell, pinned to the board (project root) it was made for. */
export type KanbanNewSessionPending =
  | { kind: "off" }
  | { kind: "new-card"; projectDir: string; laneId: string }
  | { kind: "attach"; projectDir: string; cardId: string; cardTitle: string };

export const KANBAN_OFF_PENDING: KanbanNewSessionPending = { kind: "off" };

export function makeKanbanId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `kb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultLanes(): KanbanLane[] {
  return [
    { id: KANBAN_BACKLOG_LANE_ID, name: "Backlog", description: "Waiting work, no session yet", fixed: true },
    { id: "lane-todo", name: "Todo", description: "Ready to start" },
    { id: "lane-plan", name: "Plan", description: "Planned" },
    { id: "lane-implement", name: "Implement", description: "In progress" },
    { id: "lane-deploy", name: "Deploy", description: "Shipping" },
    { id: "lane-done", name: "Done", description: "Finished" },
  ];
}

/**
 * One board mutation, as the route's POST body carries it (minus `cwd`). The
 * optional `cardId` / `laneId` on the creating actions let a client pick the
 * id, so an optimistic card and the server's card agree.
 */
export type KanbanAction =
  | { action: "add-card"; laneId: string; title: string; description?: string; sessionId?: string | null; sessionTitle?: string | null; cardId?: string }
  | { action: "edit-card"; cardId: string; title?: string; description?: string }
  | { action: "delete-card"; cardId: string }
  | { action: "move-card"; cardId: string; laneId: string; beforeCardId?: string | null }
  | { action: "advance-card"; cardId: string }
  | { action: "link-session"; cardId: string; sessionId: string; sessionTitle: string }
  | { action: "unlink-session"; cardId: string }
  | { action: "create-card-for-session"; sessionId: string; sessionTitle: string; laneId: string | null; cardId?: string }
  | { action: "add-lane"; name: string; description?: string; laneId?: string }
  | { action: "rename-lane"; laneId: string; name: string }
  | { action: "edit-lane"; laneId: string; description?: string; instructions?: string }
  | { action: "move-lane"; laneId: string; direction: -1 | 1 }
  | { action: "reorder-lane"; laneId: string; toIndex: number }
  | { action: "delete-lane"; laneId: string }
  | { action: "set-card-prefix"; prefix: string }
  | { action: "set-notice"; template?: string; reminderTurns?: number };

/**
 * A write about a card's comments. It is deliberately NOT a `KanbanAction`: a
 * comment is not a row of the board, the shared reducers never see it, and the
 * store writes the comment table in the same lock and transaction as the board
 * (plus one revision bump), so both kinds of write share one queue.
 */
export type KanbanCommentAction =
  | { action: "add-comment"; cardId: string; body: string }
  | { action: "delete-comment"; commentId: string };

/** Everything `POST /api/kanban` accepts. */
export type KanbanRequest = KanbanAction | KanbanCommentAction;

export type KanbanActionName = KanbanAction["action"];

export const KANBAN_ACTION_NAMES: readonly KanbanActionName[] = [
  "add-card",
  "edit-card",
  "delete-card",
  "move-card",
  "advance-card",
  "link-session",
  "unlink-session",
  "create-card-for-session",
  "add-lane",
  "rename-lane",
  "edit-lane",
  "move-lane",
  "reorder-lane",
  "delete-lane",
  "set-card-prefix",
  "set-notice",
];

/** The route's answer to a read and to every successful mutation. */
export interface KanbanBoardResponse {
  board: KanbanBoard;
  revision: number;
}

/**
 * What `POST /api/agent/[id]` did with a fresh composer's "Track on board" pick.
 * It is applied before the prompt runs, so the run's own board notice already
 * names the card; the client adopts the board it answers with instead of posting
 * a second link.
 */
export type KanbanAttachOutcome =
  | { ok: true; board: KanbanBoard; revision: number }
  | { ok: false; error: string; code?: string };
