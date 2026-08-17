import type { DashboardEvent } from "./events.ts";
import type { Link } from "./links.ts";
import type { Todo } from "./store.ts";

export interface DashboardSearchData {
  links: Link[];
  todos: Todo[];
  events: DashboardEvent[];
}

export type DashboardSearchResult =
  | { kind: "link"; item: Link }
  | { kind: "todo"; item: Todo }
  | { kind: "event"; item: DashboardEvent };

interface RankedResult {
  result: DashboardSearchResult;
  title: string;
  text: string;
}

/** Search every dashboard collection, preferring title matches over metadata. */
export function searchDashboard(
  data: DashboardSearchData,
  query: string,
  limit = 8,
): DashboardSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const candidates: RankedResult[] = [
    ...data.links.map((item) => ({
      result: { kind: "link" as const, item },
      title: item.title,
      text: `${item.title} ${item.url} ${item.group ?? ""}`,
    })),
    ...data.todos.map((item) => ({
      result: { kind: "todo" as const, item },
      title: item.title,
      text: `${item.title} ${item.due ?? ""}`,
    })),
    ...data.events.map((item) => ({
      result: { kind: "event" as const, item },
      title: item.title,
      text: `${item.title} ${item.date} ${item.endDate ?? ""} ${item.start ?? ""} ${item.location ?? ""}`,
    })),
  ];

  return candidates
    .map((candidate) => {
      const title = candidate.title.toLocaleLowerCase();
      const text = candidate.text.toLocaleLowerCase();
      const score = title === needle ? 0 : title.startsWith(needle) ? 1 : title.includes(needle) ? 2 : 3;
      return { ...candidate, score, matches: text.includes(needle) };
    })
    .filter(({ matches }) => matches)
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ result }) => result);
}
