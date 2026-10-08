// Unsaved edits from the file viewer, by absolute file path. Only the active
// file tab's viewer is mounted, so an editor that unmounts with changes parks
// its text here, and the next viewer of that file picks it up. The set of
// paths with unsaved changes drives the tab bar's marker, the close-tab
// confirmation and the page's beforeunload prompt.

export interface FileEditDraft {
  /** The editor's text, parked when the viewer unmounted; null while a viewer holds it. */
  content: string | null;
  /** Hash of the version on disk the edits started from. */
  baseHash: string;
}

const drafts = new Map<string, FileEditDraft>();
const listeners = new Set<() => void>();
let dirtyPaths: ReadonlySet<string> = new Set();
const NO_DIRTY_PATHS: ReadonlySet<string> = new Set();

function emitIfPathsChanged(): void {
  if (drafts.size === dirtyPaths.size && [...drafts.keys()].every((key) => dirtyPaths.has(key))) return;
  dirtyPaths = new Set(drafts.keys());
  for (const listener of listeners) listener();
}

export function getFileEditDraft(filePath: string): FileEditDraft | undefined {
  return drafts.get(filePath);
}

/** Record (or with null, forget) unsaved edits of `filePath`. */
export function setFileEditDraft(filePath: string, draft: FileEditDraft | null): void {
  if (draft) drafts.set(filePath, draft);
  else drafts.delete(filePath);
  emitIfPathsChanged();
}

export function hasFileEditDrafts(): boolean {
  return drafts.size > 0;
}

export function subscribeFileEditDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for `useSyncExternalStore`: a new Set only when the paths change. */
export function getDirtyFilePaths(): ReadonlySet<string> {
  return dirtyPaths;
}

export function getServerDirtyFilePaths(): ReadonlySet<string> {
  return NO_DIRTY_PATHS;
}
