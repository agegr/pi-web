import type { FileLineRange } from "@/lib/file-links";
import type { FileViewerState } from "@/lib/file-viewer-state";
import type { Tab } from "./TabBar";

export interface FileWorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  open: boolean;
}

// A parked workspace keeps the generation its tabs were live in: the viewer
// that unmounts after the switch reports under it, so its state lands in these
// tabs even when the workspace switched to has the same file open.
export interface ParkedFileWorkspace extends FileWorkspaceState {
  generation: number;
}

export function switchFileWorkspace(
  states: Map<string, ParkedFileWorkspace>,
  currentKey: string | null,
  nextKey: string,
  current: FileWorkspaceState,
  generation: number,
): FileWorkspaceState {
  if (currentKey === nextKey) return current;
  if (currentKey) states.set(currentKey, { ...current, generation });
  const parked = states.get(nextKey);
  if (!parked) return { tabs: [], activeTabId: null, open: false };
  // Live tabs are never parked: the map holds only the workspaces left.
  states.delete(nextKey);
  return { tabs: parked.tabs, activeTabId: parked.activeTabId, open: parked.open };
}

interface OpenFileTabInput {
  fileName: string;
  filePath: string;
  modeHint?: "diff";
  page?: number;
  lines?: FileLineRange;
  sourceSessionId?: string | null;
  tabId: string;
}

// A link to lines shows them in the source, whatever mode the tab was in.
function lineLinkViewerState(previous?: FileViewerState): FileViewerState {
  return {
    displayMode: "source",
    // An explicit wrap choice carries over; an unmade one stays unmade.
    wrapLines: previous?.wrapLines,
    scrollTop: 0,
    scrollLeft: 0,
  };
}

export function openFileTab(tabs: Tab[], input: OpenFileTabInput): Tab[] {
  const existing = tabs.find((tab) => tab.id === input.tabId);
  if (!existing) {
    return [...tabs, {
      id: input.tabId,
      label: input.fileName,
      filePath: input.filePath,
      sourceSessionId: input.sourceSessionId,
      initialDisplayMode: input.modeHint,
      page: input.page,
      lines: input.lines,
      viewerState: input.lines ? lineLinkViewerState() : input.modeHint ? {
        displayMode: input.modeHint,
        scrollTop: 0,
        scrollLeft: 0,
      } : undefined,
      viewerRevision: 0,
    }];
  }

  const sourceChanged = Boolean(
    input.sourceSessionId && existing.sourceSessionId !== input.sourceSessionId,
  );
  const sourceUnchanged = !sourceChanged;
  const pageChanged = existing.page !== input.page;
  // Every click on a line link goes to its lines again, even the same ones.
  if (sourceUnchanged && !input.modeHint && !pageChanged && !input.lines) return tabs;

  return tabs.map((tab) => {
    if (tab.id !== input.tabId) return tab;
    const next: Tab = { ...tab };
    let bumpRevision = false;
    if (sourceChanged) {
      next.sourceSessionId = input.sourceSessionId;
      bumpRevision = true;
    }
    if (pageChanged) {
      next.page = input.page;
      bumpRevision = true;
    }
    if (input.modeHint) {
      next.initialDisplayMode = input.modeHint;
      next.viewerState = {
        displayMode: input.modeHint,
        // An explicit wrap choice carries over; an unmade one stays unmade so
        // the file's own kind still decides in the diff view too.
        wrapLines: tab.viewerState?.wrapLines,
        scrollTop: 0,
        scrollLeft: 0,
      };
      bumpRevision = true;
    }
    if (input.lines) {
      next.lines = input.lines;
      next.viewerState = lineLinkViewerState(tab.viewerState);
      bumpRevision = true;
    }
    if (bumpRevision) next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    return next;
  });
}

export function saveParkedFileViewerState(
  states: Map<string, ParkedFileWorkspace>,
  generation: number,
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): void {
  for (const [key, workspace] of states) {
    if (workspace.generation !== generation) continue;
    states.set(key, { ...workspace, tabs: saveFileViewerState(workspace.tabs, tabId, viewerRevision, viewerState) });
    return;
  }
}

export function saveFileViewerState(
  tabs: Tab[],
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || (tabs[index].viewerRevision ?? 0) !== viewerRevision) return tabs;

  const next = [...tabs];
  // The viewer went to the link's lines on mount; from here on its own scroll
  // is the place to come back to.
  const tab: Tab = { ...next[index], viewerState };
  delete tab.lines;
  next[index] = tab;
  return next;
}

/** Where `filePath` is after `from` moved to `to`: the entry itself, or anything below a moved folder. */
export function movedFilePath(filePath: string, from: string, to: string): string | null {
  if (filePath === from) return to;
  for (const separator of ["/", "\\"]) {
    const prefix = from.endsWith(separator) ? from : from + separator;
    if (filePath.startsWith(prefix)) return to + filePath.slice(from.length);
  }
  return null;
}

/** The explorer moved or renamed `from`: its open tabs follow, keeping their viewer state. */
export function retargetFileTabs(tabs: Tab[], from: string, to: string): Tab[] {
  let changed = false;
  const next = tabs.map((tab) => {
    if (tab.kind) return tab;
    const filePath = movedFilePath(tab.filePath, from, to);
    if (filePath === null) return tab;
    changed = true;
    const label = filePath.split(/[\\/]/).at(-1) || tab.label;
    return { ...tab, id: `file:${filePath}`, filePath, label };
  });
  return changed ? next : tabs;
}

/** The explorer deleted `deleted`: tabs of it, or of anything below it, close. */
export function dropDeletedFileTabs(tabs: Tab[], deleted: string): Tab[] {
  const next = tabs.filter((tab) => tab.kind || movedFilePath(tab.filePath, deleted, deleted) === null);
  return next.length === tabs.length ? tabs : next;
}

/** A tab id after `from` moved to `to`, or the id unchanged. */
export function retargetFileTabId(tabId: string, from: string, to: string): string {
  if (!tabId.startsWith("file:")) return tabId;
  const filePath = movedFilePath(tabId.slice("file:".length), from, to);
  return filePath === null ? tabId : `file:${filePath}`;
}
