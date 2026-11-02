import type { SessionInfo } from "@/lib/types";

export interface SideTab {
  sessionId: string;
  label: string;
  side: true;
}

export interface SideTabsState {
  tabs: SideTab[];
  activeId: string | null;
  open: boolean;
}

export const sideTabsKey = (rootSessionId: string) => `pi-web:side-tabs:${rootSessionId}`;

export function restoreSideTabs(raw: string | null, rootSessionId: string, sessions: readonly SessionInfo[]): SideTabsState {
  try {
    const saved = JSON.parse(raw ?? "null");
    const tabs: SideTab[] = [];
    for (const tab of Array.isArray(saved?.tabs) ? saved.tabs : []) {
      if (typeof tab?.sessionId !== "string" || typeof tab.label !== "string") continue;
      const session = sessions.find((item) => item.id === tab.sessionId);
      if (session?.relation?.kind !== "side" || session.relation.parentSessionId !== rootSessionId || tabs.some((item) => item.sessionId === tab.sessionId)) continue;
      tabs.push({ sessionId: tab.sessionId, label: tab.label, side: true });
    }
    const activeId = tabs.some((tab) => `agent:${tab.sessionId}` === saved?.activeId) ? saved.activeId as string : null;
    return { tabs, activeId, open: saved?.open === true };
  } catch {
    return { tabs: [], activeId: null, open: false };
  }
}
