/**
 * Byte budgets of the agent-facing `kanban` tool, kept apart from the schema and
 * the reducers so both read the same numbers. A board in a large project holds
 * hundreds of cards with long descriptions; the tool answers with projections so
 * a question costs a few hundred tokens instead of the whole board.
 */

/** `search` returns at most this many cards without an explicit `limit`. */
export const KANBAN_SEARCH_DEFAULT_LIMIT = 20;

/** The `limit` ceiling: past it, narrow with `query` / `laneId` instead. */
export const KANBAN_SEARCH_MAX_LIMIT = 50;

/** Code points of a card's description in a search row. */
export const KANBAN_CARD_EXCERPT_BUDGET = 120;

/** A notice names at most this many lanes before it defers to `kanban read`. */
export const KANBAN_NOTICE_LANE_LIMIT = 24;

/**
 * Characters a lane's model-facing instructions may hold — the route's cap
 * (`app/api/kanban/route.ts` refuses longer) and the injection's own bound
 * (`lib/kanban-extension.ts` truncates with a marker, for hand-edited files).
 * 2000 characters is roughly 500 tokens, paid once per lane entry and per lane edit.
 */
export const KANBAN_LANE_INSTRUCTIONS_MAX = 2000;

/**
 * Characters the whole lane-instructions block may hold: the card's lane and every
 * instructed lane after it. One lane's cap would let a six-lane board ask for 12000.
 */
export const KANBAN_LANE_INSTRUCTIONS_TOTAL_MAX = 4000;

/**
 * Characters the board's notice template may hold — the route's cap and the
 * injection's own bound. One line of instructions is the point; a paragraph
 * paid once per link change is still cheap, a document is not.
 */
export const KANBAN_NOTICE_TEMPLATE_MAX = 1200;

/**
 * The reminder's turn ceiling: 0 is off, and past this the notice is once a
 * session that a user can better tune with the template itself.
 */
export const KANBAN_REMINDER_TURNS_MAX = 100;

/**
 * Code points one comment may hold — the route's write cap and the agent tool's
 * (a note is a handoff paragraph or a short list, not a document; the card's
 * description is where the long text goes).
 */
export const KANBAN_COMMENT_MAX = 4000;

/** `read { cardId }` sends at most this many of the card's newest comments. */
export const KANBAN_COMMENT_READ_LIMIT = 10;

/** Code points of one comment body inside a card read: the head of a long note. */
export const KANBAN_COMMENT_BUDGET = 800;

/** `GET /api/kanban/comments` answers the newest rows, up to this many. */
export const KANBAN_COMMENT_PAGE_LIMIT = 100;

/**
 * `read { cardId }` sends at most this many activity rows: enough to see what
 * just happened to the card, cheap enough to ride on every one-card read
 * (~20 tokens a row). Older history is the detail tab's, not a run's.
 */
export const KANBAN_ACTIVITY_READ_LIMIT = 5;
