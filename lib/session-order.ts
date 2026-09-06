export const SESSION_ORDER_VERSION = 1;
export const MAX_SESSION_ORDER_PROJECTS = 512;
export const MAX_PINNED_SESSIONS_PER_PROJECT = 512;
const MAX_PROJECT_KEY_LENGTH = 2048;
const MAX_SESSION_ID_LENGTH = 256;

export interface SessionOrderPreferences {
  version: typeof SESSION_ORDER_VERSION;
  projects: Record<string, string[]>;
}

export function emptySessionOrderPreferences(): SessionOrderPreferences {
  return {
    version: SESSION_ORDER_VERSION,
    projects: Object.create(null) as Record<string, string[]>,
  };
}

function sanitizePinnedSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_SESSION_ID_LENGTH || seen.has(item)) {
      continue;
    }
    seen.add(item);
    ids.push(item);
    if (ids.length >= MAX_PINNED_SESSIONS_PER_PROJECT) break;
  }
  return ids;
}

export function normalizeSessionOrderPreferences(value: unknown): SessionOrderPreferences {
  const normalized = emptySessionOrderPreferences();
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalized;
  const record = value as { version?: unknown; projects?: unknown };
  if (record.version !== undefined && record.version !== SESSION_ORDER_VERSION) return normalized;
  const projects = record.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) return normalized;

  for (const [projectKey, pinnedIds] of Object.entries(projects)) {
    if (projectKey.length === 0 || projectKey.length > MAX_PROJECT_KEY_LENGTH) continue;
    normalized.projects[projectKey] = sanitizePinnedSessionIds(pinnedIds);
    if (Object.keys(normalized.projects).length >= MAX_SESSION_ORDER_PROJECTS) break;
  }
  return normalized;
}

export function setProjectPinnedSessionIds(
  preferences: SessionOrderPreferences,
  projectKey: string,
  pinnedSessionIds: readonly string[],
): SessionOrderPreferences {
  if (projectKey.length === 0 || projectKey.length > MAX_PROJECT_KEY_LENGTH) {
    throw new Error("Invalid project key");
  }
  const nextProjects = Object.assign(Object.create(null), preferences.projects) as Record<string, string[]>;
  const sanitized = sanitizePinnedSessionIds(pinnedSessionIds);
  if (sanitized.length > 0) nextProjects[projectKey] = sanitized;
  else delete nextProjects[projectKey];
  return { version: SESSION_ORDER_VERSION, projects: nextProjects };
}

export function setSessionPinned(
  pinnedSessionIds: readonly string[],
  sessionId: string,
  pinned: boolean,
): string[] {
  const withoutSession = pinnedSessionIds.filter((id) => id !== sessionId);
  return pinned ? [sessionId, ...withoutSession] : withoutSession;
}

export function movePinnedSession(
  pinnedSessionIds: readonly string[],
  sourceId: string,
  targetId: string,
  afterTarget: boolean,
): string[] {
  if (sourceId === targetId) return [...pinnedSessionIds];
  const next = pinnedSessionIds.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex === -1) return [...pinnedSessionIds];
  next.splice(targetIndex + (afterTarget ? 1 : 0), 0, sourceId);
  return next;
}

export function compareSessionRootOrder(
  a: { id: string; modified: string },
  b: { id: string; modified: string },
  pinnedIndexes: ReadonlyMap<string, number>,
): number {
  const aPinned = pinnedIndexes.get(a.id);
  const bPinned = pinnedIndexes.get(b.id);
  if (aPinned !== undefined && bPinned !== undefined) return aPinned - bPinned;
  if (aPinned !== undefined) return -1;
  if (bPinned !== undefined) return 1;
  return b.modified.localeCompare(a.modified);
}
