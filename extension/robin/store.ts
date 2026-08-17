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
import type { Link } from "./links.ts";
import { dataPath, readJsonArray, readJsonObject, writeJsonArray, writeJsonObject } from "./paths.ts";

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
export { dataDir, newId } from "./paths.ts";

const TODOS_FILE = "todos.json";
const LINKS_FILE = "links.json";
const EVENTS_FILE = "events.json";
const ASSISTANT_FILE = "assistant.json";
const TELEGRAM_STATE_FILE = "telegram-state.json";

/** See ./dates.ts for why `due` and `createdAt` are different kinds of value. */
export interface Todo {
  id: string;
  title: string;
  done: boolean;
  /** Local calendar date, YYYY-MM-DD. Never a timestamp. */
  due?: string;
  /** UTC instant, ISO 8601. */
  createdAt: string;
  /** UTC instant, ISO 8601. */
  completedAt?: string;
}

export function todosPath(): string {
  return dataPath(TODOS_FILE);
}

export function readTodos(): Todo[] {
  return readJsonArray<Todo>(TODOS_FILE);
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

export interface DailyAgendaDelivery {
  date: string;
  chatIds: number[];
}

export function readDailyAgendaDelivery(): DailyAgendaDelivery | null {
  return readJsonObject<DailyAgendaDelivery>(TELEGRAM_STATE_FILE);
}

/** Record each successful chat separately so a partial broadcast can resume safely. */
export function markDailyAgendaSent(date: string, chatId: number): void {
  const current = readDailyAgendaDelivery();
  const chatIds = current?.date === date ? current.chatIds : [];
  if (chatIds.includes(chatId)) return;
  writeJsonObject(TELEGRAM_STATE_FILE, { date, chatIds: [...chatIds, chatId] });
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
