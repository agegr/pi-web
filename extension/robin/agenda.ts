import { groupEventsByDate, type CalendarEvent } from "./events.ts";
import type { Todo } from "./store.ts";

export interface AgendaDay<TEvent extends CalendarEvent> {
  date: string;
  events: TEvent[];
  todos: Todo[];
}

/** Merge calendar entries and dated, unfinished todos into chronological days. */
export function groupAgendaItems<TEvent extends CalendarEvent>(
  events: TEvent[],
  todos: Todo[],
): AgendaDay<TEvent>[] {
  const days = new Map<string, AgendaDay<TEvent>>(
    groupEventsByDate(events).map(({ date, events: dayEvents }) => [
      date,
      { date, events: dayEvents, todos: [] },
    ]),
  );

  for (const todo of todos) {
    if (todo.done || !todo.due) continue;
    const day = days.get(todo.due);
    if (day) day.todos.push(todo);
    else days.set(todo.due, { date: todo.due, events: [], todos: [todo] });
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
