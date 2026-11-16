import { cardForSession, moveCardToLane, nextCardNumber, resolveKanbanCardRef } from "./kanban-shared";
import { cardMatchesQuery, kanbanDescriptionExcerpt } from "./kanban-search";
import {
  KANBAN_ACTIVITY_READ_LIMIT,
  KANBAN_CARD_EXCERPT_BUDGET,
  KANBAN_COMMENT_BUDGET,
  KANBAN_COMMENT_MAX,
  KANBAN_COMMENT_READ_LIMIT,
  KANBAN_SEARCH_DEFAULT_LIMIT,
  KANBAN_SEARCH_MAX_LIMIT,
} from "./kanban-tool-limits";
import type { KanbanFailureCode } from "./kanban-store";
import { kanbanCardKey, type KanbanActivity, type KanbanActivityKind, type KanbanBoard, type KanbanCard, type KanbanComment, type KanbanLane } from "./kanban-types";

/** Agent requests are deliberately separate from the browser's link-stealing actions. */
export type KanbanToolRequest =
  | { action: "read"; cardId?: string }
  | { action: "search"; query?: string; laneId?: string; limit?: number }
  | { action: "create"; title: string; description?: string; laneId?: string }
  | { action: "update"; cardId?: string; title?: string; description?: string; laneId?: string }
  | { action: "comment"; cardId?: string; body: string };
export type KanbanToolSearch = Extract<KanbanToolRequest, { action: "search" }>;
/** Board edits: the shared reducers' business. A comment is not a board row. */
export type KanbanToolMutation = Extract<KanbanToolRequest, { action: "create" | "update" }>;
export type KanbanToolComment = Extract<KanbanToolRequest, { action: "comment" }>;
export type KanbanToolActor = {
  sessionId: string;
  sessionTitle?: string | null;
  /**
   * The session that delegated this work — a subagent run's caller
   * (`readSessionDelegatedFrom`). Filled by the store, never by the caller of
   * the tool: a model cannot claim a delegation it was not given. A delegated
   * session may act on its caller's card, and only the ways a helper may.
   */
  delegatedFrom?: string | null;
};
export type KanbanToolFailure = { ok: false; code: KanbanFailureCode | "invalid-request" | "read-only"; error: string };
// Mapped data types also satisfy Pi's JsonValue contract (interfaces have no index signature).
// A card the tool sends carries its `key` too: the handle people use (`PIW-42`).
type CardData = { [K in keyof KanbanCard]: KanbanCard[K] } & { key: string };
type LaneData = { [K in keyof KanbanLane]: KanbanLane[K] };
/** One comment as a card read sends it: the head of a long note, never the whole thread. */
type CommentData = { [K in keyof KanbanComment]: KanbanComment[K] };
/** One activity line as a card read sends it: no ids, no timestamps beyond `at`, one line each. */
export type KanbanActivityLineData = {
  kind: KanbanActivityKind;
  at: number;
  /** The value left behind (previous lane, old title, unlinked session); omitted when none. */
  from?: string;
  /** The value arrived at (new lane, new title, linked session); omitted when none. */
  to?: string;
  /** The session whose tool call made the change, when the agent did it. */
  actor?: string;
};
/** A lane without its cards: enough to choose one, cheap enough to always send. */
export type KanbanLaneOverviewData = { id: string; name: string; description: string; fixed?: boolean; cardCount: number };
/** One search hit: no id-less body, just the field a model picks a card with. */
export type KanbanCardSummaryData = { id: string; key: string; title: string; laneId: string; linked?: true; excerpt: string };
export type KanbanToolResult = KanbanToolFailure | {
  ok: true;
  action: "read";
  projectDir: string;
  /** The board's card-key prefix, so a model can speak `PIW-42` without reading a card first. */
  cardPrefix: string;
  lanes: KanbanLaneOverviewData[];
  totalCards: number;
  currentCard: CardData | null;
  revision: number;
} | {
  ok: true;
  action: "read";
  projectDir: string;
  card: CardData;
  lane: LaneData;
  nextLaneId: string | null;
  currentCardId: string | null;
  revision: number;
  /** The newest entries, oldest first, each body bounded; `commentCount` counts them all. */
  comments: CommentData[];
  commentCount: number;
  /** The newest activity rows, oldest first, one line each; `activityTotal` counts them all. */
  activity: KanbanActivityLineData[];
  activityTotal: number;
} | {
  ok: true;
  action: "comment";
  projectDir: string;
  comment: CommentData;
  card: CardData;
  lane: LaneData;
  nextLaneId: string | null;
  currentCardId: string | null;
  revision: number;
} | {
  ok: true;
  action: "search";
  projectDir: string;
  lanes: Array<{ id: string; name: string; cardCount: number }>;
  cards: KanbanCardSummaryData[];
  matched: number;
  total: number;
  hasMore: boolean;
  hint?: string;
  currentCardId: string | null;
  revision: number;
} | {
  ok: true;
  action: "create" | "update";
  card: CardData;
  lane: LaneData;
  nextLaneId: string | null;
  currentCardId: string | null;
  revision: number;
};

const REQUEST_KEYS = {
  read: ["action", "cardId"],
  search: ["action", "query", "laneId", "limit"],
  create: ["action", "title", "description", "laneId"],
  update: ["action", "cardId", "title", "description", "laneId"],
  comment: ["action", "cardId", "body"],
} as const;

/** Do not trust SDK validation alone: nested/programmatic callers must obey the same contract. */
export function parseKanbanToolRequest(input: unknown): { ok: true; request: KanbanToolRequest } | KanbanToolFailure {
  const invalid = (error: string): KanbanToolFailure => ({ ok: false, code: "invalid-request", error });
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("kanban expects an object with action read, search, create, or update.");
  const raw = input as Record<string, unknown>;
  const action = raw.action;
  if (action !== "read" && action !== "search" && action !== "create" && action !== "update" && action !== "comment") {
    return invalid("action must be read, search, create, update, or comment.");
  }
  const keys: readonly string[] = REQUEST_KEYS[action];
  for (const key of Object.keys(raw)) {
    if (!keys.includes(key)) return invalid(`Unknown field "${key}" for kanban ${action}. Allowed fields: ${keys.join(", ")}.`);
  }
  if (action === "search") {
    for (const key of ["query", "laneId"] as const) {
      if (raw[key] === undefined) continue;
      if (typeof raw[key] !== "string" || (key === "laneId" && !(raw[key] as string).trim())) {
        return invalid(`${key} must be ${key === "laneId" ? "a nonblank string" : "a string (empty matches every card)"}.`);
      }
    }
    if (raw.limit !== undefined && (typeof raw.limit !== "number" || !Number.isInteger(raw.limit)
      || raw.limit < 1 || raw.limit > KANBAN_SEARCH_MAX_LIMIT)) {
      return invalid(`limit must be a whole number from 1 to ${KANBAN_SEARCH_MAX_LIMIT}. Narrow with query or laneId instead.`);
    }
    return { ok: true, request: { ...raw } as KanbanToolSearch };
  }
  for (const key of Object.keys(raw)) {
    if (key !== "action" && (typeof raw[key] !== "string" || (key !== "description" && !(raw[key] as string).trim()))) {
      return invalid(`${key} must be ${key === "description" ? "a string (empty clears it)" : "a nonblank string"}.`);
    }
  }
  if (action === "create" && typeof raw.title !== "string") return invalid("create requires a nonblank title.");
  if (action === "update" && !["title", "description", "laneId"].some((key) => Object.hasOwn(raw, key))) {
    return invalid("update requires at least one of title, description, or laneId.");
  }
  if (action === "comment" && (typeof raw.body !== "string" || !raw.body.trim())) return invalid("comment requires a nonblank body.");
  if (action === "comment" && typeof raw.body === "string" && [...raw.body].length > KANBAN_COMMENT_MAX) {
    return invalid(`comment body must be at most ${KANBAN_COMMENT_MAX} characters; put long text in the card's description.`);
  }
  return { ok: true, request: { ...raw } as KanbanToolRequest };
}

function refused(error: string): KanbanToolFailure & { code: "refused" } {
  return { ok: false, code: "refused", error };
}

/** A card as every projection sends it: the row plus the key a person reads. */
function cardData(board: KanbanBoard, card: KanbanCard): CardData {
  return { ...card, key: kanbanCardKey(board, card) };
}

/** The card a mutation acts on: an explicit id, or this session's own linked
 * card. Refused for an unknown card, and for a card another session owns —
 * a link is never stolen, and a foreign card is never edited. An unlinked card
 * is fair game (text edits, a claim, a comment). `cardId` may be the card's id,
 * its key (`PIW-42`) or, within this board, its number.
 */
export function resolveKanbanToolCard(
  board: KanbanBoard,
  cardId: string | undefined,
  actor: KanbanToolActor,
): { ok: true; card: KanbanCard; delegated: boolean } | (KanbanToolFailure & { code: "refused" }) {
  const card = cardId === undefined ? cardForSession(board, actor.sessionId) : resolveKanbanCardRef(board, cardId);
  if (!card) {
    return refused(cardId === undefined
      ? "This session has no linked card. Read the board, then specify cardId and a work laneId to claim a free card."
      : "Card not found in this project's board. Use its key (like PIW-42), an id from kanban read, or search to discover current cards.");
  }
  // A delegated session reaches its caller's card only by naming it: the
  // cardId-less default always stays this session's own card, so "your card"
  // never means two things.
  const delegated = card.sessionId !== null && card.sessionId !== actor.sessionId;
  if (delegated && card.sessionId !== actor.delegatedFrom) {
    return refused(`Card "${kanbanCardKey(board, card)}" belongs to another session. Choose an unlinked card; links cannot be stolen.`);
  }
  return { ok: true, card, delegated };
}

/** Pure guarded patch/claim/move. The caller supplies identity/time; never silently drops another link. */
export function applyKanbanToolMutation(
  board: KanbanBoard,
  request: KanbanToolMutation,
  actor: KanbanToolActor,
  now: number,
  newCardId: string,
): { ok: true; board: KanbanBoard; cardId: string } | (KanbanToolFailure & { code: "refused" }) {
  const current = cardForSession(board, actor.sessionId);
  if (request.action === "create") {
    const lane = request.laneId === undefined ? board.lanes[0] : board.lanes.find((l) => l.id === request.laneId);
    if (!lane) return refused("Lane not found. Use kanban read to discover the current lane IDs.");
    if (!lane.fixed && current) return refused(`This session already owns card "${kanbanCardKey(board, current)}". Update it, or create an independent task in Backlog.`);
    if (board.cards.some((c) => c.id === newCardId)) return refused("The new card ID already exists. Read the board before trying again.");
    const number = nextCardNumber(board);
    const card: KanbanCard = {
      id: newCardId, number, title: request.title.trim(), description: (request.description ?? "").trim(), laneId: lane.id,
      sessionId: lane.fixed ? null : actor.sessionId,
      sessionTitle: lane.fixed ? null : actor.sessionTitle ?? actor.sessionId,
      createdAt: now, updatedAt: now,
    };
    return { ok: true, board: { ...board, cards: [...board.cards, card], nextCardNumber: number + 1 }, cardId: card.id };
  }
  const resolved = resolveKanbanToolCard(board, request.cardId, actor);
  if (!resolved.ok) return resolved;
  const card = resolved.card;
  const lane = board.lanes.find((l) => l.id === (request.laneId ?? card.laneId));
  if (!lane) return refused("Lane not found. Use kanban read to discover the current lane IDs.");
  if (lane.fixed && card.sessionId !== null) return refused("A linked card cannot enter Backlog. Keep it in a work lane; create independent tasks in Backlog.");
  // A helper's powers are deliberately narrow: no text, and no going back. The
  // owner keeps the card's words and its direction; a helper that disagrees
  // with a lane says so in a comment instead of racing the owner.
  if (resolved.delegated) {
    const key = kanbanCardKey(board, card);
    if (request.title !== undefined || request.description !== undefined) {
      return refused(`Card "${key}" belongs to the session that delegated to you: comment on it or move it forward, and leave its title and description to its owner.`);
    }
    const from = board.lanes.findIndex((l) => l.id === card.laneId);
    const to = board.lanes.findIndex((l) => l.id === lane.id);
    if (to < from) {
      return refused(`A delegated session may move card "${key}" forward only (next lane: ${board.lanes[from + 1]?.id ?? "none"}). Comment instead of moving it back.`);
    }
  }
  const claiming = request.laneId !== undefined && !lane.fixed && card.sessionId === null;
  if (claiming && current) return refused(`This session already owns card "${kanbanCardKey(board, current)}". Update that card instead of claiming another.`);
  const title = request.title === undefined ? card.title : request.title.trim();
  const description = request.description === undefined ? card.description : request.description.trim();
  let next = board;
  if (claiming || title !== card.title || description !== card.description) {
    const patched: KanbanCard = { ...card, title, description, updatedAt: now };
    if (claiming) {
      patched.sessionId = actor.sessionId;
      patched.sessionTitle = actor.sessionTitle ?? actor.sessionId;
    }
    next = { ...board, cards: board.cards.map((c) => c.id === card.id ? patched : c) };
  }
  // The browser mover's default is "end of lane"; never call it for same-lane retries.
  if (lane.id !== card.laneId) {
    const moved = moveCardToLane(next, card.id, lane.id, now);
    if (!moved) return refused("That lane move is not allowed. Read the board before choosing another lane.");
    next = moved;
  }
  return { ok: true, board: next, cardId: card.id };
}

/** One line of a description: whitespace flattened, first query hit centered, ellipses only at cuts. */
export function kanbanCardExcerpt(description: string, query = "", budget = KANBAN_CARD_EXCERPT_BUDGET): string {
  const flat = description.replace(/\s+/gu, " ").trim();
  if (!flat) return "";
  const { text, leading, trailing } = kanbanDescriptionExcerpt(flat, query, budget);
  return `${leading ? "…" : ""}${text}${trailing ? "…" : ""}`;
}

/** The rows a search sends: id, key, title, lane and a bounded excerpt, never the full body. */
export function kanbanCardSummary(board: KanbanBoard, card: KanbanCard, query = ""): KanbanCardSummaryData {
  return {
    id: card.id,
    key: kanbanCardKey(board, card),
    title: card.title,
    laneId: card.laneId,
    ...(card.sessionId === null ? {} : { linked: true as const }),
    excerpt: kanbanCardExcerpt(card.description, query),
  };
}

const laneCardCounts = (board: KanbanBoard): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const card of board.cards) counts.set(card.laneId, (counts.get(card.laneId) ?? 0) + 1);
  return counts;
};

/**
 * The cheap entry point: lanes with their counts, the board total, and this
 * session's own card in full. No other card body is sent, whatever the board
 * size — and no lane instructions either: those are injected with the card's
 * notice (its lane and the lanes ahead of it), not listed on every read.
 */
export function kanbanToolOverview(board: KanbanBoard, revision: number, sessionId: string): KanbanToolResult {
  const counts = laneCardCounts(board);
  const current = cardForSession(board, sessionId);
  return {
    ok: true,
    action: "read",
    projectDir: board.projectDir,
    cardPrefix: board.cardPrefix,
    lanes: board.lanes.map((lane) => ({
      id: lane.id,
      name: lane.name,
      description: lane.description,
      ...(lane.fixed ? { fixed: true as const } : {}),
      cardCount: counts.get(lane.id) ?? 0,
    })),
    totalCards: board.cards.length,
    currentCard: current ? cardData(board, current) : null,
    revision,
  };
}

/**
 * `read { cardId }`: exactly one card, in full, with the lane it sits in, the
 * newest comments (bounded) and the newest activity rows — the handoff a
 * session needs to pick the work up without reading its predecessor's
 * transcript.
 */
export function kanbanToolRead(
  board: KanbanBoard,
  revision: number,
  sessionId: string,
  cardId: string,
  comments: { comments: readonly KanbanComment[]; total: number } = { comments: [], total: 0 },
  activity: { activity: readonly KanbanActivity[]; total: number } = { activity: [], total: 0 },
): KanbanToolResult {
  const card = resolveKanbanCardRef(board, cardId);
  if (!card) return refused("Card not found in this project's board. Use its key (like PIW-42), an id from kanban read, or search to discover current cards.");
  const index = board.lanes.findIndex((l) => l.id === card.laneId);
  if (index < 0) return refused("That card's lane is missing from this board. Read the board before continuing.");
  return {
    ok: true,
    action: "read",
    projectDir: board.projectDir,
    card: cardData(board, card),
    lane: board.lanes[index],
    nextLaneId: board.lanes[index + 1]?.id ?? null,
    currentCardId: cardForSession(board, sessionId)?.id ?? null,
    revision,
    comments: kanbanToolComments(comments.comments),
    commentCount: comments.total,
    activity: kanbanToolActivity(activity.activity),
    activityTotal: activity.total,
  };
}

/**
 * `search`: literal text and/or one lane, at most `limit` compact rows. Matching
 * counts are reported so a model narrows the query instead of paging the board.
 */
export function kanbanToolSearch(board: KanbanBoard, revision: number, sessionId: string, request: KanbanToolSearch): KanbanToolResult {
  if (request.laneId !== undefined && !board.lanes.some((l) => l.id === request.laneId)) {
    return refused("Lane not found. Use kanban read to discover the current lane IDs.");
  }
  const query = request.query ?? "";
  const matched = board.cards.filter((card) => (request.laneId === undefined || card.laneId === request.laneId)
    && cardMatchesQuery(card, query, kanbanCardKey(board, card)));
  const limit = request.limit ?? KANBAN_SEARCH_DEFAULT_LIMIT;
  const cards = matched.slice(0, limit).map((card) => kanbanCardSummary(board, card, query));
  const hasMore = matched.length > cards.length;
  const counts = laneCardCounts(board);
  return {
    ok: true,
    action: "search",
    projectDir: board.projectDir,
    lanes: board.lanes.map((lane) => ({ id: lane.id, name: lane.name, cardCount: counts.get(lane.id) ?? 0 })),
    cards,
    matched: matched.length,
    total: board.cards.length,
    hasMore,
    ...(hasMore ? { hint: `${cards.length} of ${matched.length} matches shown; narrow with query or laneId, or raise limit (max ${KANBAN_SEARCH_MAX_LIMIT}).` } : {}),
    currentCardId: cardForSession(board, sessionId)?.id ?? null,
    revision,
  };
}

/** The newest activity rows of a card as one line each, oldest first. */
export function kanbanToolActivity(activity: readonly KanbanActivity[]): KanbanActivityLineData[] {
  return activity.slice(-KANBAN_ACTIVITY_READ_LIMIT).map((event) => ({
    kind: event.kind,
    at: event.createdAt,
    ...(event.from === null ? {} : { from: event.from }),
    ...(event.to === null ? {} : { to: event.to }),
    ...(event.actorSessionId === null ? {} : { actor: event.actorSessionTitle ?? event.actorSessionId }),
  }));
}

/** The newest comments of a card, each body bounded, oldest first. */
export function kanbanToolComments(comments: readonly KanbanComment[]): CommentData[] {
  const shown = comments.slice(-KANBAN_COMMENT_READ_LIMIT);
  return shown.map((comment) => {
    const points = [...comment.body];
    const body = points.length > KANBAN_COMMENT_BUDGET
      ? `${points.slice(0, KANBAN_COMMENT_BUDGET).join("")}…[truncated]`
      : comment.body;
    return { ...comment, body };
  });
}

/** One written comment, answered the way a mutation answers: the card, its lane, the next lane. */
export function kanbanToolCommentResult(
  board: KanbanBoard,
  revision: number,
  sessionId: string,
  cardId: string,
  comment: KanbanComment,
): KanbanToolResult {
  const card = board.cards.find((c) => c.id === cardId);
  const index = board.lanes.findIndex((l) => l.id === card?.laneId);
  if (!card || index < 0) return refused("The commented card or its lane is missing. Read the board before continuing.");
  return {
    ok: true,
    action: "comment",
    projectDir: board.projectDir,
    comment,
    card: cardData(board, card),
    lane: board.lanes[index],
    nextLaneId: board.lanes[index + 1]?.id ?? null,
    currentCardId: cardForSession(board, sessionId)?.id ?? null,
    revision,
  };
}

export function kanbanToolMutationResult(board: KanbanBoard, revision: number, sessionId: string, cardId: string, action: "create" | "update"): KanbanToolResult {
  const card = board.cards.find((c) => c.id === cardId);
  const index = board.lanes.findIndex((l) => l.id === card?.laneId);
  if (!card || index < 0) return refused("The updated card or its lane is missing. Read the board before continuing.");
  return { ok: true, action, card: cardData(board, card), lane: board.lanes[index], nextLaneId: board.lanes[index + 1]?.id ?? null, currentCardId: cardForSession(board, sessionId)?.id ?? null, revision };
}
