export interface ConversationFolder {
  id: string;
  name: string;
  projectKey: string;
  collapsed: boolean;
}

export interface ConversationFolderState {
  folders: ConversationFolder[];
  assignments: Record<string, string | null>;
}

interface FolderableSession {
  id: string;
  parentSessionId?: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "pi-web:conversation-folders";

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function emptyConversationFolderState(): ConversationFolderState {
  return { folders: [], assignments: {} };
}

function parseConversationFolderState(value: unknown): ConversationFolderState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyConversationFolderState();
  const candidate = value as Partial<ConversationFolderState>;
  const seenIds = new Set<string>();
  const folders = Array.isArray(candidate.folders)
    ? candidate.folders.filter((folder): folder is ConversationFolder => {
        if (!folder || typeof folder !== "object") return false;
        const valid = typeof folder.id === "string"
          && folder.id.length > 0
          && !seenIds.has(folder.id)
          && typeof folder.name === "string"
          && folder.name.trim().length > 0
          && typeof folder.projectKey === "string"
          && folder.projectKey.length > 0
          && typeof folder.collapsed === "boolean";
        if (valid) seenIds.add(folder.id);
        return valid;
      })
    : [];
  const assignments: Record<string, string | null> = {};
  if (candidate.assignments && typeof candidate.assignments === "object" && !Array.isArray(candidate.assignments)) {
    for (const [sessionId, folderId] of Object.entries(candidate.assignments)) {
      if (typeof folderId === "string" || folderId === null) assignments[sessionId] = folderId;
    }
  }
  return { folders, assignments };
}

export function loadConversationFolderState(
  storage: StorageLike | null = browserStorage(),
): ConversationFolderState {
  if (!storage) return emptyConversationFolderState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? parseConversationFolderState(JSON.parse(raw) as unknown) : emptyConversationFolderState();
  } catch {
    return emptyConversationFolderState();
  }
}

export function saveConversationFolderState(
  state: ConversationFolderState,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browser storage is best-effort.
  }
}

export function deleteConversationFolder(
  state: ConversationFolderState,
  folderId: string,
): ConversationFolderState {
  const assignments = { ...state.assignments };
  for (const [sessionId, assignedFolderId] of Object.entries(assignments)) {
    if (assignedFolderId === folderId) assignments[sessionId] = null;
  }
  return {
    folders: state.folders.filter((folder) => folder.id !== folderId),
    assignments,
  };
}

export function resolveConversationFolderAssignments(
  sessions: FolderableSession[],
  assignments: Record<string, string | null>,
  validFolderIds: ReadonlySet<string>,
): Map<string, string | null> {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const resolved = new Map<string, string | null>();

  const resolveFolder = (sessionId: string, visiting: Set<string>): string | null => {
    if (resolved.has(sessionId)) return resolved.get(sessionId) ?? null;
    if (visiting.has(sessionId)) return null;
    visiting.add(sessionId);
    const explicit = assignments[sessionId];
    let folderId = Object.hasOwn(assignments, sessionId)
      ? explicit !== null && validFolderIds.has(explicit) ? explicit : null
      : null;
    if (!Object.hasOwn(assignments, sessionId)) {
      const parentId = sessionsById.get(sessionId)?.parentSessionId;
      if (parentId && sessionsById.has(parentId)) folderId = resolveFolder(parentId, visiting);
    }
    visiting.delete(sessionId);
    resolved.set(sessionId, folderId);
    return folderId;
  };

  for (const session of sessions) resolveFolder(session.id, new Set());
  return resolved;
}
