import type { SessionInfo } from "./types";

export const MAX_CHAT_PANES = 8;

export type ChatPane = {
  paneId: string;
  session: SessionInfo | null;
  newSessionCwd: string | null;
  newSessionDraftId: string | null;
  instanceKey: number;
};

export function paneDraftKey(pane: ChatPane): string | null {
  if (pane.session || !pane.newSessionCwd || !pane.newSessionDraftId) return null;
  return `new:${pane.newSessionDraftId}:${pane.newSessionCwd}`;
}

export function paneTitle(pane: ChatPane, fallback: string): string {
  const named = pane.session?.name?.trim();
  if (named) return named;
  const first = pane.session?.firstMessage?.trim();
  if (first) return first.replace(/\s+/g, " ");
  return fallback;
}

export function upsertSessionPane(
  panes: ChatPane[],
  session: SessionInfo,
): { panes: ChatPane[]; paneId: string; created: boolean } {
  const existing = panes.find((pane) => pane.session?.id === session.id);
  if (existing) {
    return {
      panes: panes.map((pane) => (
        pane.paneId === existing.paneId ? { ...pane, session } : pane
      )),
      paneId: existing.paneId,
      created: false,
    };
  }
  const pane: ChatPane = {
    paneId: session.id,
    session,
    newSessionCwd: null,
    newSessionDraftId: null,
    instanceKey: 0,
  };
  return { panes: [...panes, pane], paneId: pane.paneId, created: true };
}

export function addComposerPane(
  panes: ChatPane[],
  cwd: string,
  draftId: string,
): { panes: ChatPane[]; paneId: string; created: boolean } {
  const paneId = `new:${draftId}`;
  const existing = panes.find((pane) => pane.paneId === paneId);
  if (existing) return { panes, paneId, created: false };
  const pane: ChatPane = {
    paneId,
    session: null,
    newSessionCwd: cwd,
    newSessionDraftId: draftId,
    instanceKey: 0,
  };
  return { panes: [...panes, pane], paneId, created: true };
}

export function promoteComposerPane(
  panes: ChatPane[],
  draftKey: string,
  session: SessionInfo,
): ChatPane[] {
  return panes.map((pane) => {
    if (paneDraftKey(pane) !== draftKey) return pane;
    return {
      ...pane,
      session,
      newSessionCwd: null,
      newSessionDraftId: null,
    };
  });
}

export function bumpPaneInstance(panes: ChatPane[], paneId: string): ChatPane[] {
  return panes.map((pane) => (
    pane.paneId === paneId ? { ...pane, instanceKey: pane.instanceKey + 1 } : pane
  ));
}

export function replacePaneSession(
  panes: ChatPane[],
  paneId: string,
  session: SessionInfo,
): ChatPane[] {
  return panes.map((pane) => (
    pane.paneId === paneId
      ? {
        ...pane,
        paneId: session.id,
        session,
        newSessionCwd: null,
        newSessionDraftId: null,
        instanceKey: pane.instanceKey + 1,
      }
      : pane
  ));
}

export function evictIdlePane(
  panes: ChatPane[],
  activePaneId: string | null,
  runningIds: ReadonlySet<string>,
): ChatPane[] {
  if (panes.length < MAX_CHAT_PANES) return panes;
  const idle = panes.find((pane) => (
    pane.paneId !== activePaneId
    && !(pane.session && runningIds.has(pane.session.id))
  ));
  const target = idle ?? panes.find((pane) => pane.paneId !== activePaneId);
  if (!target) return panes;
  return panes.filter((pane) => pane.paneId !== target.paneId);
}
