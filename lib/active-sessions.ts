import type { SessionInfo } from "./types";
import { listSessionFamilies, type SessionFamily } from "./session-family";
import { workspaceKeyOf } from "./workspace-memory";

export interface ActiveProject {
  key: string;
  path: string;
  families: SessionFamily[];
}

/** A bounded cross-project view over the same catalogue used by Projects. */
export function getActiveProjects(
  sessions: readonly SessionInfo[],
  runningIds: ReadonlySet<string>,
  unreadIds: ReadonlySet<string>,
  selectedId: string | null,
  now = Date.now(),
): ActiveProject[] {
  const recentAfter = now - 30 * 60_000;
  const families = listSessionFamilies(sessions)
    .map((family) => {
      const ids = [family.root, ...family.subagents].map((session) => session.id);
      return {
        family,
        running: ids.some((id) => runningIds.has(id)),
        unread: ids.some((id) => unreadIds.has(id)),
        selected: ids.includes(selectedId ?? ""),
      };
    })
    .filter(({ family, running, unread, selected }) =>
      running || unread || selected || Date.parse(family.latestModified) >= recentAfter)
    .sort((a, b) => Number(b.running) - Number(a.running)
      || Number(b.unread) - Number(a.unread)
      || Number(b.selected) - Number(a.selected)
      || b.family.latestModified.localeCompare(a.family.latestModified));
  const forced = families.filter(({ running, unread, selected }) => running || unread || selected);
  const recent = families.filter(({ running, unread, selected }) => !running && !unread && !selected).slice(0, 10);

  // ponytail: Keep every running/unread family; virtualize this view if large active sets slow rendering.
  const groups = new Map<string, ActiveProject>();
  for (const { family } of [...forced, ...recent]) {
    const key = workspaceKeyOf(family.root);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { key, path: family.root.projectRoot ?? family.root.cwd, families: [] };
      groups.set(key, group);
    }
    group.families.push(family);
  }
  return [...groups.values()];
}
