/**
 * File-backed stores for the Robin dashboard.
 *
 * Server-only: this module reaches `node:fs` through ./paths.ts, so it must
 * never be imported for its *values* by a client component. Pure logic the
 * browser also needs lives in ./dates.ts and ./links.ts; importing a `type`
 * from here is fine, since type imports are erased.
 *
 * Deliberately dependency-free: extensions are loaded by jiti with a fixed
 * alias map (pi SDK packages + typebox only), so anything else would have to be
 * installed separately.
 */
import { dueBucket, localDate, type DueBucket } from "./dates.ts";
import type { CalendarEvent } from "./events.ts";
import { EVENT_COLOR_KEYS, type EventColorKey } from "./eventColors.ts";
import type { MailReview } from "./mail.ts";
import { DEFAULT_JOB_PROFILE, type Job, type JobProfile } from "./jobs.ts";
import type { Link } from "./links.ts";
import { createDeliveryLedger } from "./delivery-ledger.ts";
import { dataPath, readJsonArray, readJsonObject, writeJsonArray, writeJsonObject } from "./paths.ts";

export type { DeliveryLedger } from "./delivery-ledger.ts";

export { addDays, dueBucket, localDate, normalizeDue, parseLocalDate, type DueBucket } from "./dates.ts";
export {
  compareEvents,
  eventsInRange,
  formatEventTime,
  groupEventsByDate,
  normalizeTime,
  type CalendarEvent,
} from "./events.ts";
export { groupLinks, iconFallback, normalizeUrl, reorderLinkGroups, type Link } from "./links.ts";
export {
  DEFAULT_JOB_PROFILE,
  EXCLUDE_PRESETS,
  JOB_STATUSES,
  LOCATION_PRESETS,
  STARTER_COMPANIES,
  TITLE_PRESETS,
  digestCandidates,
  formatJob,
  formatJobDigest,
  jobKey,
  pendingJobs,
  sortJobs,
  type Job,
  type JobProfile,
  type JobStatus,
  type TrackedCompany,
} from "./jobs.ts";
export { dataDir, newId } from "./paths.ts";

const TODOS_FILE = "todos.json";
const LINKS_FILE = "links.json";
const EVENTS_FILE = "events.json";
const ASSISTANT_FILE = "assistant.json";
const TELEGRAM_STATE_FILE = "telegram-state.json";
const JOBS_FILE = "jobs.json";
const JOB_PROFILE_FILE = "job-profile.json";
const JOB_SCAN_FILE = "job-scan.json";
const JOB_DIGEST_STATE_FILE = "job-digest-state.json";
const GMAIL_DIGEST_STATE_FILE = "gmail-digest-state.json";
const MAIL_REVIEW_FILE = "mail-review.json";
const REMINDER_STATE_FILE = "reminder-state.json";
const COMPLETED_TODO_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Which chats have already received which run, per feed.
 *
 * One shape for all four: the daily agenda, the job digest (morning/evening/
 * sweep share one ledger), the email digest, and event reminders. The bridge
 * and its tests build in-memory adapters of the same `DeliveryLedger`
 * interface.
 *
 * The reminder ledger is keyed by event rather than by time of day, so its
 * history turns over much faster than the others — see the trimming in
 * delivery-ledger.ts, which keeps only the most recent keys.
 */
export const dailyAgendaLedger = createDeliveryLedger(TELEGRAM_STATE_FILE);
export const jobLedger = createDeliveryLedger(JOB_DIGEST_STATE_FILE);
export const gmailLedger = createDeliveryLedger(GMAIL_DIGEST_STATE_FILE);
export const reminderLedger = createDeliveryLedger(REMINDER_STATE_FILE);
const JOB_SWEEP_FILE = "job-sweep.json";
const JOB_SCORING_FILE = "job-scoring.json";

/** See ./dates.ts for why `due` and `createdAt` are different kinds of value. */
export interface Todo {
  id: string;
  title: string;
  done: boolean;
  /** Local calendar date, YYYY-MM-DD. Never a timestamp. */
  due?: string;
  /** User-selected title hue keyed to the calendar palette. */
  color?: EventColorKey;
  /** UTC instant, ISO 8601. */
  createdAt: string;
  /** UTC instant, ISO 8601. */
  completedAt?: string;
}

export function todosPath(): string {
  return dataPath(TODOS_FILE);
}

export function normalizeTodoColor(value: string): EventColorKey {
  const color = value.trim().toLowerCase();
  if (!(EVENT_COLOR_KEYS as readonly string[]).includes(color)) {
    throw new Error(`Unknown todo colour: ${value}`);
  }
  return color as EventColorKey;
}

export function pruneCompletedTodos(todos: Todo[], now = Date.now()): Todo[] {
  const cutoff = now - COMPLETED_TODO_RETENTION_MS;
  return todos.filter((todo) => {
    if (!todo.done) return true;
    const completed = Date.parse(todo.completedAt ?? todo.createdAt);
    return !Number.isFinite(completed) || completed > cutoff;
  });
}

export function readTodos(): Todo[] {
  const todos = readJsonArray<Todo>(TODOS_FILE);
  const retained = pruneCompletedTodos(todos);
  if (retained.length !== todos.length) writeJsonArray(TODOS_FILE, retained);
  return retained;
}

export function writeTodos(todos: Todo[]): void {
  writeJsonArray(TODOS_FILE, todos);
}

export function linksPath(): string {
  return dataPath(LINKS_FILE);
}

export function readLinks(): Link[] {
  return readJsonArray<Link>(LINKS_FILE);
}

export function writeLinks(links: Link[]): void {
  writeJsonArray(LINKS_FILE, links);
}

export function eventsPath(): string {
  return dataPath(EVENTS_FILE);
}

export function readEvents(): CalendarEvent[] {
  return readJsonArray<CalendarEvent>(EVENTS_FILE);
}

export function writeEvents(events: CalendarEvent[]): void {
  writeJsonArray(EVENTS_FILE, events);
}

/**
 * The pi session the dashboard assistant talks to, remembered across server
 * restarts so the conversation keeps its context ("move it to Thursday").
 */
interface AssistantState {
  sessionId?: string;
  dailyAgendaSessionId?: string;
  /**
   * Kept apart from the conversational session on purpose: the scoring turn
   * reads employer-authored job descriptions, and anything a posting tries to
   * talk the model into must not survive into the session you chat with later.
   */
  jobScorerSessionId?: string;
  /**
   * Same isolation for the mail review: email is untrusted third-party text,
   * so the turn that reads it and writes todos/events runs in its own session.
   */
  mailReviewSessionId?: string;
  updatedAt?: string;
}

function readAssistantState(): AssistantState {
  return readJsonObject<AssistantState>(ASSISTANT_FILE) ?? {};
}

function writeAssistantState(patch: Partial<AssistantState>): void {
  writeJsonObject(ASSISTANT_FILE, {
    ...readAssistantState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export function readAssistantSessionId(): string | null {
  return readAssistantState().sessionId ?? null;
}

export function writeAssistantSessionId(sessionId: string): void {
  writeAssistantState({ sessionId });
}

export function readDailyAgendaSessionId(): string | null {
  return readAssistantState().dailyAgendaSessionId ?? null;
}

export function writeDailyAgendaSessionId(dailyAgendaSessionId: string): void {
  writeAssistantState({ dailyAgendaSessionId });
}

export function readJobScorerSessionId(): string | null {
  return readAssistantState().jobScorerSessionId ?? null;
}

export function writeJobScorerSessionId(jobScorerSessionId: string): void {
  writeAssistantState({ jobScorerSessionId });
}

export function readMailReviewSessionId(): string | null {
  return readAssistantState().mailReviewSessionId ?? null;
}

export function writeMailReviewSessionId(mailReviewSessionId: string): void {
  writeAssistantState({ mailReviewSessionId });
}

/** The assistant sessions a caller may ask to start over. */
export const ASSISTANT_SESSION_KINDS = ["default", "readOnly", "scoring", "mail"] as const;

export type AssistantSessionKind = (typeof ASSISTANT_SESSION_KINDS)[number];

const SESSION_FIELDS: Record<AssistantSessionKind, keyof AssistantState> = {
  default: "sessionId",
  readOnly: "dailyAgendaSessionId",
  scoring: "jobScorerSessionId",
  mail: "mailReviewSessionId",
};

/**
 * Forget a remembered session id, so the next turn of that mode starts fresh.
 *
 * The session file itself is left alone: this is "start a new conversation",
 * not "delete the old one", and the transcript is still worth having. What it
 * buys is a way out of a context that has drifted or grown expensive without
 * reaching for the filesystem from a chat message.
 */
export function clearAssistantSession(kind: AssistantSessionKind): boolean {
  const field = SESSION_FIELDS[kind];
  const state = readAssistantState();
  if (state[field] === undefined) return false;
  const { [field]: _dropped, ...rest } = state;
  void _dropped;
  writeJsonObject(ASSISTANT_FILE, { ...rest, updatedAt: new Date().toISOString() });
  return true;
}

/* ──────────────────────────── jobs ──────────────────────────── */

export function jobsPath(): string {
  return dataPath(JOBS_FILE);
}

export function readJobs(): Job[] {
  return readJsonArray<Job>(JOBS_FILE);
}

export function writeJobs(jobs: Job[]): void {
  writeJsonArray(JOBS_FILE, jobs);
}

export function jobProfilePath(): string {
  return dataPath(JOB_PROFILE_FILE);
}

/**
 * Always merged over the defaults rather than returned raw. The profile grows
 * new keys as the feature does, and a file written by an older version must
 * keep working — an absent `digestSize` has to mean "the default", not
 * `undefined` reaching a `.slice()`.
 */
export function readJobProfile(): JobProfile {
  const stored = readJsonObject<Partial<JobProfile>>(JOB_PROFILE_FILE);
  return { ...DEFAULT_JOB_PROFILE, ...(stored ?? {}) };
}

export function writeJobProfile(profile: JobProfile): void {
  writeJsonObject(JOB_PROFILE_FILE, { ...profile, updatedAt: new Date().toISOString() });
}

/** What the last scan did, so the page can say when it last ran and what broke. */
export interface JobScanState {
  startedAt: string;
  finishedAt: string;
  scanned: number;
  matched: number;
  added: number;
  sources: { id: string; name: string; count: number; error?: string }[];
}

export function readJobScanState(): JobScanState | null {
  return readJsonObject<JobScanState>(JOB_SCAN_FILE);
}

export function writeJobScanState(state: JobScanState): void {
  writeJsonObject(JOB_SCAN_FILE, state);
}

/**
 * Progress of a scoring run.
 *
 * Scoring is the one step that costs money and the one step with nothing to
 * watch: the model works inside an agent session and the only outward sign is
 * rows quietly gaining a number. Without this the honest answer to "is it
 * running" is "look at the list again in a minute".
 *
 * `remaining` is re-read from the job store on each publish rather than
 * counted down, so it stays true even when something else scores in parallel.
 */
export interface JobScoringState {
  startedAt: string;
  finishedAt: string | null;
  running: boolean;
  round: number;
  totalRounds: number;
  /** Unscored count when the run began — the denominator of the bar. */
  startedWith: number;
  remaining: number;
  /** Which model did the work, so a bad batch can be traced to it. */
  model: string | null;
  error: string | null;
}

export function readJobScoringState(): JobScoringState | null {
  return readJsonObject<JobScoringState>(JOB_SCORING_FILE);
}

export function writeJobScoringState(state: JobScoringState): void {
  writeJsonObject(JOB_SCORING_FILE, state);
}

/**
 * Progress of a directory sweep.
 *
 * Written to disk rather than held in memory because the sweep outlives the
 * request that started it: the page polls this file to draw a progress bar,
 * and a server restart mid-sweep leaves a readable record of where it got to
 * instead of a spinner that never resolves.
 */
export interface JobSweepState {
  startedAt: string;
  finishedAt: string | null;
  running: boolean;
  boardsTotal: number;
  boardsDone: number;
  /** Dead slugs and failed boards. About a third of the dataset is expected. */
  unreachable: number;
  scanned: number;
  matched: number;
  added: number;
  directories: {
    id: string;
    label: string;
    status: "ok" | "stale" | "empty";
    boards: number;
    matched: number;
  }[];
  /** How far each directory got, so a killed sweep can resume. */
  cursors: Record<string, number>;
  error: string | null;
}

export function readJobSweepState(): JobSweepState | null {
  return readJsonObject<JobSweepState>(JOB_SWEEP_FILE);
}

export function writeJobSweepState(state: JobSweepState): void {
  writeJsonObject(JOB_SWEEP_FILE, state);
}

/**
 * The latest categorised email review.
 *
 * One file, keyed by day: the review is "what came in today and what it means",
 * so a second check the same day replaces the first rather than appending. The
 * items carry their own Gmail metadata, so the dashboard renders the review
 * without another Gmail call.
 */
export function readMailReview(): MailReview | null {
  return readJsonObject<MailReview>(MAIL_REVIEW_FILE);
}

export function writeMailReview(review: MailReview): void {
  writeJsonObject(MAIL_REVIEW_FILE, review);
}

/**
 * Attach the assistant's report to today's review.
 *
 * The report is the turn's final text, produced after gmail_review already
 * wrote the items — so it has to be merged in a second step. An empty inbox is
 * still a review ("no mail" is information), so a turn with no items still
 * creates a shell review rather than dropping the report.
 */
export function attachMailReport(reply: string): void {
  const report = reply.trim();
  if (!report) return;
  const review = readMailReview();
  writeMailReview(review
    ? { ...review, report }
    : { day: localDate(), reviewedAt: new Date().toISOString(), items: [], report });
}

/**
 * Resolve a todo from an id or a title substring.
 * Returns a reason instead of throwing so tools can hand the model something
 * it can act on (ambiguous matches list the candidates).
 */
export function findTodo(
  todos: Todo[],
  ref: { id?: string; title?: string },
): { todo: Todo } | { error: string } {
  if (ref.id) {
    const byId = todos.find((t) => t.id === ref.id);
    return byId ? { todo: byId } : { error: `No todo with id "${ref.id}".` };
  }
  if (!ref.title) return { error: "Provide either id or title." };

  const needle = ref.title.toLowerCase();
  const matches = todos.filter((t) => t.title.toLowerCase().includes(needle));
  if (matches.length === 0) return { error: `No todo matching "${ref.title}".` };
  if (matches.length > 1) {
    const list = matches.map((t) => `${t.id}: ${t.title}`).join("; ");
    return { error: `"${ref.title}" matches ${matches.length} todos — pass an id. Candidates: ${list}` };
  }
  return { todo: matches[0] as Todo };
}

const DUE_LABEL: Record<DueBucket, (due: string) => string> = {
  overdue: (due) => ` (overdue, was due ${due})`,
  today: () => " (due today)",
  tomorrow: () => " (due tomorrow)",
  upcoming: (due) => ` (due ${due})`,
  none: () => "",
};

export function formatTodo(todo: Todo, today: string = localDate()): string {
  const box = todo.done ? "[x]" : "[ ]";
  const bucket = todo.done ? "none" : dueBucket(todo.due, today);
  return `${box} ${todo.id}  ${todo.title}${DUE_LABEL[bucket](todo.due ?? "")}`;
}
