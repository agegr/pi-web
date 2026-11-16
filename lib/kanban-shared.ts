import { KANBAN_NOTICE_TEMPLATE_MAX, KANBAN_REMINDER_TURNS_MAX } from "./kanban-tool-limits";
import {
  makeKanbanId,
  normalizeKanbanPrefix,
  type KanbanAction,
  type KanbanBoard,
  type KanbanBoardNotice,
  type KanbanCard,
  type KanbanLane,
} from "./kanban-types";

// The board's rules as pure reducers, shared by the route (the authority) and
// the client cache (optimistic application). No I/O, and no clock: callers
// pass `now`. Every mutation returns a new board and leaves its argument
// alone; a mutation that changes nothing returns the SAME board object, so a
// caller can tell "no change" by identity. `null` means refused: a guard was
// violated and the board is left as it was.
//
// The first lane is the fixed "backlog": it is never renamed, moved or
// removed, and the cards that rest there hold no session. The lanes after it
// are work lanes.

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export function laneById(board: KanbanBoard, laneId: string | null): KanbanLane | null {
  if (!laneId) return null;
  return board.lanes.find((lane) => lane.id === laneId) ?? null;
}

export function laneIndex(board: KanbanBoard, laneId: string): number {
  return board.lanes.findIndex((lane) => lane.id === laneId);
}

/**
 * A lane's cards in board order. A card's position inside its lane IS its
 * position in `board.cards` (there is no position field), so a manual move or
 * a reorder is an insertion into that one array (`placeCard`, `moveCardToLane`).
 */
export function cardsOfLane(board: KanbanBoard, laneId: string): KanbanCard[] {
  return board.cards.filter((card) => card.laneId === laneId);
}

export function cardForSession(board: KanbanBoard, sessionId: string | null): KanbanCard | null {
  if (!sessionId) return null;
  return board.cards.find((card) => card.sessionId === sessionId) ?? null;
}

export function firstWorkLane(board: KanbanBoard): KanbanLane | null {
  return board.lanes.find((lane) => !lane.fixed) ?? null;
}

/** The lane a card sits in, for views that only need the name and position. */
export function cardLaneOf(board: KanbanBoard, card: KanbanCard | null): KanbanLane | null {
  return card ? laneById(board, card.laneId) : null;
}

/**
 * The number the next new card takes. `board.nextCardNumber` is the source of
 * truth (it never moves back, so a deleted card's number is never handed out
 * again); the cards are a floor only for a hand-edited board.
 */
export function nextCardNumber(board: KanbanBoard): number {
  let highest = 0;
  for (const card of board.cards) if (card.number > highest) highest = card.number;
  return Math.max(1, board.nextCardNumber || 0, highest + 1);
}

/**
 * The card a reference names: its storage id, its key (`PIW-42`, case
 * insensitive, any prefix this board ever had) or, within one board, its bare
 * number (`42`). Null for a reference that names nothing here — a key of
 * another project's prefix included, so a stray reference never resolves to
 * this board's card of the same number.
 */
export function resolveKanbanCardRef(board: KanbanBoard, ref: string | null | undefined): KanbanCard | null {
  const value = (ref ?? "").trim();
  if (!value) return null;
  const byId = board.cards.find((card) => card.id === value);
  if (byId) return byId;
  const key = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/.exec(value);
  if (key) {
    const prefix = key[1].toUpperCase();
    const known = [board.cardPrefix, ...(board.cardPrefixAliases ?? [])].map((entry) => entry.toUpperCase());
    if (!known.includes(prefix)) return null;
    const number = Number(key[2]);
    return board.cards.find((card) => card.number === number) ?? null;
  }
  if (/^\d{1,9}$/.test(value)) return board.cards.find((card) => card.number === Number(value)) ?? null;
  return null;
}

/** A reference as the storage id it names, or the reference itself when it names nothing (the reducer then refuses). */
function refCardId(board: KanbanBoard, ref: string): string {
  return resolveKanbanCardRef(board, ref)?.id ?? ref;
}

/**
 * The route's actions with their card references resolved to storage ids, so a
 * browser (or a stale tab) may name a card `PIW-42` wherever an id is taken.
 * The client-chosen ids of `add-card` / `create-card-for-session` are left
 * alone: they name a card that does not exist yet. An unresolvable reference
 * is passed through unchanged, and the reducer refuses it as an unknown card.
 */
export function resolveKanbanActionRefs(board: KanbanBoard, action: KanbanAction): KanbanAction {
  switch (action.action) {
    case "edit-card":
    case "delete-card":
    case "advance-card":
    case "link-session":
    case "unlink-session": {
      const cardId = refCardId(board, action.cardId);
      return cardId === action.cardId ? action : { ...action, cardId };
    }
    case "move-card": {
      const cardId = refCardId(board, action.cardId);
      const beforeCardId = action.beforeCardId ? refCardId(board, action.beforeCardId) : action.beforeCardId;
      return cardId === action.cardId && beforeCardId === action.beforeCardId ? action : { ...action, cardId, beforeCardId };
    }
    default:
      return action;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function replaceCard(board: KanbanBoard, cardId: string, change: (card: KanbanCard) => KanbanCard): KanbanBoard {
  return { ...board, cards: board.cards.map((card) => (card.id === cardId ? change(card) : card)) };
}

/**
 * `cards` with `card` inserted into `laneId` immediately before `beforeCardId`
 * — or, when that anchor is absent, gone, or in another lane (a concurrent
 * writer took it), at the end of the lane.
 */
function placeCard(cards: KanbanCard[], card: KanbanCard, laneId: string, beforeCardId: string | null): KanbanCard[] {
  const rest = cards.filter((c) => c.id !== card.id);
  const anchor = beforeCardId ? rest.findIndex((c) => c.id === beforeCardId && c.laneId === laneId) : -1;
  if (anchor >= 0) return [...rest.slice(0, anchor), card, ...rest.slice(anchor)];
  let end = -1;
  for (let i = 0; i < rest.length; i += 1) if (rest[i].laneId === laneId) end = i;
  // An empty lane: the end of the array, so no other lane's order moves.
  return end >= 0 ? [...rest.slice(0, end + 1), card, ...rest.slice(end + 1)] : [...rest, card];
}

/** Whether two card arrays give every lane the same cards in the same order (the global array is not the point). */
function sameLaneOrder(before: KanbanCard[], after: KanbanCard[]): boolean {
  if (before.length !== after.length) return false;
  for (const laneId of new Set(before.map((c) => c.laneId))) {
    const a = before.filter((c) => c.laneId === laneId);
    const b = after.filter((c) => c.laneId === laneId);
    if (a.length !== b.length || a.some((card, index) => card.id !== b[index].id)) return false;
  }
  return true;
}

/** One session, one card: every card but `exceptCardId` that carries `sessionId` drops the link (the snapshot title stays). */
function dropOtherLinks(cards: KanbanCard[], sessionId: string, exceptCardId: string | null, now: number): KanbanCard[] {
  return cards.map((card) =>
    card.sessionId === sessionId && card.id !== exceptCardId ? { ...card, sessionId: null, updatedAt: now } : card,
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * A new card at the end of `laneId`. Refused (null) for a blank title, an
 * unknown lane, or an id already on the board. A session given here moves off
 * any other card that carries it.
 */
export function addCard(
  board: KanbanBoard,
  laneId: string,
  input: { title: string; description?: string; sessionId?: string | null; sessionTitle?: string | null; id?: string },
  now: number,
): KanbanBoard | null {
  const title = input.title.trim();
  const lane = laneById(board, laneId);
  if (!title || !lane) return null;
  const id = input.id ?? makeKanbanId();
  if (board.cards.some((card) => card.id === id)) return null;
  const sessionId = input.sessionId ?? null;
  if (sessionId && lane.fixed) return null; // The backlog never takes a session.
  const card: KanbanCard = {
    id,
    number: nextCardNumber(board),
    title,
    description: (input.description ?? "").trim(),
    laneId,
    sessionId,
    sessionTitle: input.sessionTitle ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const others = sessionId ? dropOtherLinks(board.cards, sessionId, null, now) : board.cards;
  return { ...board, cards: [...others, card], nextCardNumber: card.number + 1 };
}

/**
 * The board's sessionless cards for an "attach to card" menu: newest first
 * (your recent cards are the top hits), ties keep the board's order. The list
 * self-shrinks as linking consumes cards; a busy backlog is the growth case.
 */
export function sessionlessCardsByRecency(board: KanbanBoard): KanbanCard[] {
  return board.cards
    .filter((card) => card.sessionId === null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Title and description edits. Refused (null) for an unknown card; a blank title is ignored. */
export function updateCard(
  board: KanbanBoard,
  cardId: string,
  patch: { title?: string; description?: string },
  now: number,
): KanbanBoard | null {
  const card = board.cards.find((c) => c.id === cardId);
  if (!card) return null;
  const title = patch.title?.trim();
  const nextTitle = title ? title : card.title;
  const nextDescription = patch.description !== undefined ? patch.description.trim() : card.description;
  if (nextTitle === card.title && nextDescription === card.description) return board;
  return replaceCard(board, cardId, (c) => ({ ...c, title: nextTitle, description: nextDescription, updatedAt: now }));
}

/** Removes the card; an unknown card is already gone, so the board is returned as it is. */
export function deleteCard(board: KanbanBoard, cardId: string): KanbanBoard {
  if (!board.cards.some((card) => card.id === cardId)) return board;
  return { ...board, cards: board.cards.filter((card) => card.id !== cardId) };
}

/**
/**
 * Whether the move-card rules allow `card` to rest in `lane`: a sessionless
 * card only in the fixed backlog, a linked card nowhere near it. The view
 * uses it to mark undroppable lanes during a drag (the same gate
 * moveCardToLane applies on the write).
 */
export function canRestInLane(card: KanbanCard, lane: KanbanLane): boolean {
  return (card.sessionId === null) === !!lane.fixed;
}

/**
 * Moves a card to `laneId` and, when `beforeCardId` names a card of that lane,
 * puts it right before it — the drop a drag-and-drop makes, anywhere in the
 * target lane (the card menu's Move up / Move down is the same move with the
 * card's own lane, one neighbour over). Without `beforeCardId` the card goes
 * last in the lane (a plain lane transition).
 *
 * Refused (null) for an unknown card or lane, for a sessionless card entering
 * a work lane (a sessionless card only rests in the backlog) and for a card
 * with a session entering the backlog (which holds none). A move that stays in
 * the card's own lane skips those entry rules — the card is already there, only
 * its position changes. The link is never touched. A move that lands exactly
 * where the card already was returns the SAME board, so the caller writes
 * nothing.
 */
export function moveCardToLane(
  board: KanbanBoard,
  cardId: string,
  laneId: string,
  now: number,
  beforeCardId: string | null = null,
): KanbanBoard | null {
  const card = board.cards.find((c) => c.id === cardId);
  const lane = laneById(board, laneId);
  if (!card || !lane) return null;
  if (card.laneId !== laneId && !canRestInLane(card, lane)) return null;
  // Anchoring a card on itself means "where it already is": a no-op, NOT the
  // lane's end (placeCard would look for the anchor among the other cards and
  // miss it, sending the card last). A stale anchor from another tab reads the
  // same way as a gone one: the lane's end.
  if (beforeCardId === cardId) return board;
  const placed = placeCard(board.cards, { ...card, laneId, updatedAt: now }, laneId, beforeCardId);
  // Landing exactly where the card already was writes nothing.
  return sameLaneOrder(board.cards, placed) ? board : { ...board, cards: placed };
}

/**
 * The model's decision: the card's stage is done, it moves to the next lane,
 * last in it (a card's place inside a lane is its board position).
 * Refused (null) for an unknown card or a card already in the last lane.
 */
export function advanceCard(board: KanbanBoard, cardId: string, now: number): KanbanBoard | null {
  const card = board.cards.find((c) => c.id === cardId);
  if (!card) return null;
  const index = laneIndex(board, card.laneId);
  const next = board.lanes[index + 1];
  if (index < 0 || !next) return null;
  return { ...board, cards: placeCard(board.cards, { ...card, laneId: next.id, updatedAt: now }, next.id, null) };
}

/**
 * Links a session to a card; the session's card elsewhere drops the link (one
 * session, one card). Refused (null) for an unknown card or a card in the
 * fixed backlog, which never takes a session.
 */
export function linkCard(
  board: KanbanBoard,
  cardId: string,
  sessionId: string,
  sessionTitle: string,
  now: number,
): KanbanBoard | null {
  const card = board.cards.find((c) => c.id === cardId);
  if (!card) return null;
  if (laneById(board, card.laneId)?.fixed) return null;
  const others = dropOtherLinks(board.cards, sessionId, cardId, now);
  return {
    ...board,
    cards: others.map((c) => (c.id === cardId ? { ...c, sessionId, sessionTitle, updatedAt: now } : c)),
  };
}

/** Clears the card's session id only: the snapshot title stays for display. */
export function unlinkCard(board: KanbanBoard, cardId: string, now: number): KanbanBoard {
  const card = board.cards.find((c) => c.id === cardId);
  if (!card || card.sessionId === null) return board;
  return replaceCard(board, cardId, (c) => ({ ...c, sessionId: null, updatedAt: now }));
}

/**
 * A session that started "tracked on board": a new card for it in the lane the
 * composer picked, falling back to the first work lane. A session that already
 * has a card keeps it (and its lane): only the title refreshes. No work lane
 * and no card: the board is returned as it is.
 */
export function createCardForSession(
  board: KanbanBoard,
  sessionId: string,
  sessionTitle: string,
  laneId: string | null,
  now: number,
  cardId?: string,
): KanbanBoard {
  const existing = cardForSession(board, sessionId);
  if (existing) {
    if (existing.sessionTitle === sessionTitle) return board;
    return replaceCard(board, existing.id, (c) => ({ ...c, sessionTitle, updatedAt: now }));
  }
  const wanted = laneId ? board.lanes.find((l) => l.id === laneId && !l.fixed) : null;
  const lane = wanted ?? firstWorkLane(board);
  if (!lane) return board;
  return addCard(board, lane.id, { title: sessionTitle.trim() || sessionId, sessionId, sessionTitle, id: cardId }, now) ?? board;
}

/**
 * Unlinks every card whose session is not in `alive`. A card keeps its lane and
 * its snapshot title. The same board comes back when nothing was dead.
 */
export function pruneDeadLinks(board: KanbanBoard, alive: Set<string>, now: number): KanbanBoard {
  if (!board.cards.some((card) => card.sessionId !== null && !alive.has(card.sessionId))) return board;
  return {
    ...board,
    cards: board.cards.map((card) =>
      card.sessionId !== null && !alive.has(card.sessionId) ? { ...card, sessionId: null, updatedAt: now } : card,
    ),
  };
}

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

/** A new work lane at the end. Refused (null) for a blank name or an id already used. */
export function addLane(board: KanbanBoard, name: string, description = "", id: string = makeKanbanId()): KanbanBoard | null {
  const trimmed = name.trim();
  if (!trimmed || board.lanes.some((lane) => lane.id === id)) return null;
  return { ...board, lanes: [...board.lanes, { id, name: trimmed, description: description.trim() }] };
}

/** Refused (null) for a blank name, an unknown lane or the fixed backlog; the same name changes nothing. */
export function renameLane(board: KanbanBoard, laneId: string, name: string): KanbanBoard | null {
  const trimmed = name.trim();
  const lane = laneById(board, laneId);
  if (!trimmed || !lane || lane.fixed) return null;
  if (lane.name === trimmed) return board;
  return { ...board, lanes: board.lanes.map((l) => (l.id === laneId ? { ...l, name: trimmed } : l)) };
}

/**
 * A work lane's text: `description` (UI text) and/or `instructions`
 * (model-facing, injected while the card is in it or in a lane before it). An empty string
 * clears; omitted fields stay as they are. Refused (null) for an unknown lane
 * or the fixed backlog; a patch that changes nothing returns the SAME board.
 */
export function editLane(
  board: KanbanBoard,
  laneId: string,
  patch: { description?: string; instructions?: string },
): KanbanBoard | null {
  const lane = laneById(board, laneId);
  if (!lane || lane.fixed) return null;
  const description = patch.description !== undefined ? patch.description.trim() : lane.description;
  const instructions = patch.instructions !== undefined ? patch.instructions.trim() : (lane.instructions ?? "");
  if (description === lane.description && instructions === (lane.instructions ?? "")) return board;
  return {
    ...board,
    lanes: board.lanes.map((l) => {
      if (l.id !== laneId) return l;
      const next: KanbanLane = { ...l, description, instructions };
      // An empty string clears to "absent", the shape an untouched lane keeps.
      if (!instructions) delete next.instructions;
      return next;
    }),
  };
}

/** One step left (-1) or right (1). Refused (null) off the ends, for the fixed lane, or past it. */
export function moveLane(board: KanbanBoard, laneId: string, direction: -1 | 1): KanbanBoard | null {
  const index = laneIndex(board, laneId);
  const target = index + direction;
  const lane = board.lanes[index];
  const other = board.lanes[target];
  if (index < 0 || !lane || !other || lane.fixed || other.fixed) return null;
  const lanes = [...board.lanes];
  lanes[index] = other;
  lanes[target] = lane;
  return { ...board, lanes };
}

/**
 * Moves a work lane to a final position. `toIndex` is the lane's index in the
 * lanes array AFTER the move: 0 belongs to the fixed backlog, so a 0 asked
 * for lands right after it (like a too-far index, clamped to the end).
 * Refused (null) for an unknown lane, the fixed backlog, or a non-integer
 * index; the same position changes nothing.
 */
export function reorderLane(board: KanbanBoard, laneId: string, toIndex: number): KanbanBoard | null {
  const from = laneIndex(board, laneId);
  const lane = board.lanes[from];
  if (from < 0 || !lane || lane.fixed) return null;
  if (!Number.isInteger(toIndex)) return null;
  const target = Math.min(Math.max(toIndex, 1), board.lanes.length - 1);
  if (target === from) return board;
  const lanes = board.lanes.filter((l) => l.id !== laneId);
  lanes.splice(target, 0, lane);
  return { ...board, lanes };
}

/**
 * Removes a work lane. Its cards are relocated to the backlog, which holds no
 * session: a card that carried one is unlinked (the snapshot title stays).
 * Refused (null) for an unknown lane or the fixed backlog.
 */export function deleteLane(board: KanbanBoard, laneId: string, now: number): KanbanBoard | null {
  const lane = laneById(board, laneId);
  const backlog = board.lanes.find((l) => l.fixed);
  if (!lane || lane.fixed || !backlog) return null;
  return {
    ...board,
    lanes: board.lanes.filter((l) => l.id !== laneId),
    cards: board.cards.map((card) =>
      card.laneId === laneId ? { ...card, laneId: backlog.id, sessionId: null, updatedAt: now } : card,
    ),
  };
}

// ---------------------------------------------------------------------------
// Card keys
// ---------------------------------------------------------------------------

/** How many former prefixes a board keeps resolving after a rename. */
export const KANBAN_PREFIX_ALIAS_LIMIT = 5;

/**
 * The board's card-key prefix (`PIW`, so cards read `PIW-42`). Renaming it
 * renames every card at once — no card row holds a key — and the previous
 * prefix stays as an alias, so a reference written before the rename still
 * resolves. Refused (null) for a value that is not a prefix; the same prefix
 * changes nothing.
 */
export function setCardPrefix(board: KanbanBoard, prefix: string): KanbanBoard | null {
  const normalized = normalizeKanbanPrefix(prefix);
  if (!normalized) return null;
  if (normalized === board.cardPrefix) return board;
  const aliases: string[] = [];
  for (const candidate of [board.cardPrefix, ...(board.cardPrefixAliases ?? [])]) {
    if (!candidate || candidate === normalized || aliases.includes(candidate)) continue;
    aliases.push(candidate);
    if (aliases.length >= KANBAN_PREFIX_ALIAS_LIMIT) break;
  }
  const next: KanbanBoard = { ...board, cardPrefix: normalized };
  if (aliases.length > 0) next.cardPrefixAliases = aliases;
  else delete next.cardPrefixAliases;
  return next;
}

// ---------------------------------------------------------------------------
// The agent notice
// ---------------------------------------------------------------------------

/**
 * The card line a run gets when the user has not written one. It names the lane
 * the card sits in — the one fact a model has to compare against what it is
 * doing — and says how to move it. `{…}` are the template's placeholders, filled
 * from `kanbanNoticeValues()`; a template is plain text, never Markdown (it is
 * injected as context, not drawn).
 */
export const KANBAN_NOTICE_TEMPLATE_DEFAULT =
  "Kanban: this session is on card {cardKey} in {lane} ({laneId}). Keep that lane matching what you are actually doing, "
  + "and move it with kanban update (no cardId) as soon as it stops matching — one lane at a time as the work advances, "
  + "never straight to the last lane.";

/**
 * The line a delegated session gets. Its caller's card is not its own, so the
 * owner's line is wrong twice over: it says "this session is on card" about
 * someone else's card, and it says to move it with no cardId — which for a child
 * names nothing. A fixed line, never the board's template: the template is the
 * owner's wording for the owner's facts.
 */
export const KANBAN_DELEGATED_NOTICE_TEMPLATE =
  "Kanban: you are working on card {cardKey} in {lane} ({laneId}), delegated by the session that owns it. "
  + "Comment with kanban comment, and move it with kanban update passing cardId \"{cardKey}\" — one lane at a time, "
  + "forward only. Leave its title and description to its owner.";

/** A board's notice, with the defaults a board that never stored one reads as. */
export function kanbanBoardNotice(board: Pick<KanbanBoard, "notice">): KanbanBoardNotice {
  return { template: board.notice?.template ?? "", reminderTurns: board.notice?.reminderTurns ?? 0 };
}

/** What a template's placeholders resolve to. */
export interface KanbanNoticeValues {
  /** The card's human key (`PIWEB-38`). */
  cardKey: string;
  cardId: string;
  title: string;
  /** The lane's current name, and its id — the handle `kanban update` takes. */
  lane: string;
  laneId: string;
}

/** The placeholders of one card: the only values a template may interpolate. */
export function kanbanNoticeValues(lanes: KanbanLane[], card: KanbanCard, cardKey: string): KanbanNoticeValues {
  return {
    cardKey,
    cardId: card.id,
    title: card.title,
    lane: lanes.find((entry) => entry.id === card.laneId)?.name ?? card.laneId,
    laneId: card.laneId,
  };
}

/**
 * A template with its placeholders filled. A blank template is the built-in
 * line, and an unknown `{token}` is left as it is: a typo the user can see in
 * the dialog's preview rather than a silently empty sentence in a run.
 */
export function renderKanbanNoticeTemplate(template: string, values: KanbanNoticeValues): string {
  const text = template.trim() || KANBAN_NOTICE_TEMPLATE_DEFAULT;
  return text.replace(/\{(cardKey|cardId|title|lane|laneId)\}/g, (_token, name: keyof KanbanNoticeValues) => values[name]);
}

/**
 * The board's agent notice (`set-notice`): the card line's template and the
 * reminder's turn count. Refused (null) for a turn count that is not a positive
 * integer within the cap or zero; an empty template with no reminder drops the
 * field entirely, so the board reads as one that never stored a notice.
 */
export function setNotice(
  board: KanbanBoard,
  patch: { template?: string; reminderTurns?: number },
): KanbanBoard | null {
  const current = kanbanBoardNotice(board);
  const template = patch.template === undefined
    ? current.template
    : [...patch.template.trim()].slice(0, KANBAN_NOTICE_TEMPLATE_MAX).join("");
  const turns = patch.reminderTurns === undefined ? current.reminderTurns : patch.reminderTurns;
  if (!Number.isInteger(turns) || turns < 0 || turns > KANBAN_REMINDER_TURNS_MAX) return null;
  if (template === current.template && turns === current.reminderTurns) return board;
  const next: KanbanBoard = { ...board };
  if (!template && turns === 0) delete next.notice;
  else next.notice = { template, reminderTurns: turns };
  return next;
}

// ---------------------------------------------------------------------------
// A new session's card
// ---------------------------------------------------------------------------

/** What a fresh composer's "Track on board" choice asks for once its session exists. */
export type KanbanSessionCardPick = { cardId: string } | { laneId: string };

/**
 * The card a brand-new session starts on, applied **before** its first prompt
 * runs (the route that sends the prompt owns this write). It is the same pair
 * of rules the composer used to apply afterwards, in one step: a backlog card
 * advances one lane first (the backlog never takes a session), a work-lane card
 * is linked as it is, and a "new card in {lane}" creates the session's card in
 * that lane (a lane that vanished falls back to the first work lane).
 *
 * Null when the rules refuse it: an unknown card, a card another session owns,
 * or a card that cannot leave the backlog. A session's own card is reused, so a
 * retried prompt is not a second card.
 */
export function attachSessionCard(
  board: KanbanBoard,
  sessionId: string,
  sessionTitle: string,
  pick: KanbanSessionCardPick,
  now: number,
): KanbanBoard | null {
  if ("laneId" in pick) return createCardForSession(board, sessionId, sessionTitle, pick.laneId, now);
  const card = board.cards.find((c) => c.id === pick.cardId);
  if (!card) return null;
  if (card.sessionId !== null && card.sessionId !== sessionId) return null;
  // Backlog first, then link: `linkCard` refuses a fixed lane.
  const moved = laneById(board, card.laneId)?.fixed ? advanceCard(board, card.id, now) : board;
  if (!moved) return null;
  return linkCard(moved, card.id, sessionId, sessionTitle, now);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Applies one route action with the matching reducer; null when the rules refuse it. */
export function applyKanbanAction(board: KanbanBoard, request: KanbanAction, now: number): KanbanBoard | null {
  switch (request.action) {
    case "add-card":
      return addCard(
        board,
        request.laneId,
        { title: request.title, description: request.description, sessionId: request.sessionId, sessionTitle: request.sessionTitle, id: request.cardId },
        now,
      );
    case "edit-card":
      return updateCard(board, request.cardId, { title: request.title, description: request.description }, now);
    case "delete-card":
      return deleteCard(board, request.cardId);
    case "move-card":
      return moveCardToLane(board, request.cardId, request.laneId, now, request.beforeCardId ?? null);
    case "advance-card":
      return advanceCard(board, request.cardId, now);
    case "link-session":
      return linkCard(board, request.cardId, request.sessionId, request.sessionTitle, now);
    case "unlink-session":
      return unlinkCard(board, request.cardId, now);
    case "create-card-for-session":
      return createCardForSession(board, request.sessionId, request.sessionTitle, request.laneId, now, request.cardId);
    case "add-lane":
      return addLane(board, request.name, request.description ?? "", request.laneId);
    case "rename-lane":
      return renameLane(board, request.laneId, request.name);
    case "edit-lane":
      return editLane(board, request.laneId, { description: request.description, instructions: request.instructions });
    case "move-lane":
      return moveLane(board, request.laneId, request.direction);
    case "reorder-lane":
      return reorderLane(board, request.laneId, request.toIndex);
    case "delete-lane":
      return deleteLane(board, request.laneId, now);
    case "set-card-prefix":
      return setCardPrefix(board, request.prefix);
    case "set-notice":
      return setNotice(board, { template: request.template, reminderTurns: request.reminderTurns });
  }
}
