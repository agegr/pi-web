export const CHAT_PROJECT_STATE_STORAGE_KEY = "pi-web:chat-project-state";
export const CHAT_PROJECT_STATE_VERSION = 1;

export const CHAT_PROJECT_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
] as const;

export interface ChatProject {
  id: string;
  name: string;
  color: string;
}

export interface ChatProjectState {
  version: typeof CHAT_PROJECT_STATE_VERSION;
  projects: ChatProject[];
  assignments: Record<string, string>;
  pinnedSessionIds: string[];
  archivedSessionIds: string[];
}

type ChatProjectStorage = Pick<Storage, "getItem" | "setItem">;

export function emptyChatProjectState(): ChatProjectState {
  return {
    version: CHAT_PROJECT_STATE_VERSION,
    projects: [],
    assignments: {},
    pinnedSessionIds: [],
    archivedSessionIds: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) return null;
  return [...new Set(value)];
}

export function parseChatProjectState(raw: string | null): ChatProjectState {
  if (!raw) return emptyChatProjectState();

  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== CHAT_PROJECT_STATE_VERSION || !Array.isArray(value.projects)) {
      return emptyChatProjectState();
    }

    const projects: ChatProject[] = [];
    const projectIds = new Set<string>();
    for (const project of value.projects) {
      if (!isRecord(project)
        || typeof project.id !== "string"
        || !project.id
        || projectIds.has(project.id)
        || typeof project.name !== "string"
        || !project.name.trim()
        || typeof project.color !== "string"
        || !/^#[0-9a-f]{6}$/i.test(project.color)) {
        return emptyChatProjectState();
      }
      projectIds.add(project.id);
      projects.push({ id: project.id, name: project.name.trim(), color: project.color });
    }

    if (!isRecord(value.assignments)) return emptyChatProjectState();
    const assignments: Record<string, string> = {};
    for (const [sessionId, projectId] of Object.entries(value.assignments)) {
      if (!sessionId || typeof projectId !== "string") return emptyChatProjectState();
      if (projectIds.has(projectId)) {
        Object.defineProperty(assignments, sessionId, {
          value: projectId,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }

    const pinnedSessionIds = uniqueStrings(value.pinnedSessionIds);
    const archivedSessionIds = uniqueStrings(value.archivedSessionIds);
    if (!pinnedSessionIds || !archivedSessionIds) return emptyChatProjectState();

    return {
      version: CHAT_PROJECT_STATE_VERSION,
      projects,
      assignments,
      pinnedSessionIds,
      archivedSessionIds,
    };
  } catch {
    return emptyChatProjectState();
  }
}

function browserStorage(): ChatProjectStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadChatProjectState(storage: ChatProjectStorage | null = browserStorage()): ChatProjectState {
  if (!storage) return emptyChatProjectState();
  try {
    return parseChatProjectState(storage.getItem(CHAT_PROJECT_STATE_STORAGE_KEY));
  } catch {
    return emptyChatProjectState();
  }
}

export function saveChatProjectState(
  state: Omit<ChatProjectState, "version">,
  storage: ChatProjectStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CHAT_PROJECT_STATE_STORAGE_KEY, JSON.stringify({
      ...state,
      version: CHAT_PROJECT_STATE_VERSION,
    }));
    return true;
  } catch {
    return false;
  }
}

export function moveChatProject(projects: readonly ChatProject[], projectId: string, offset: -1 | 1): ChatProject[] {
  const from = projects.findIndex((project) => project.id === projectId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= projects.length) return [...projects];
  const next = [...projects];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function moveChatProjectTo(projects: readonly ChatProject[], projectId: string, targetId: string): ChatProject[] {
  const from = projects.findIndex((project) => project.id === projectId);
  const to = projects.findIndex((project) => project.id === targetId);
  if (from < 0 || to < 0 || from === to) return [...projects];
  const next = [...projects];
  const [project] = next.splice(from, 1);
  next.splice(to, 0, project);
  return next;
}
