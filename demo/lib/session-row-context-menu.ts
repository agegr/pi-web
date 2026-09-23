export const SESSION_ROW_CONTEXT_MENU_EVENT = "pi-web:session-row-contextmenu";

export interface SessionRowContextMenuDetail {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  clientX: number;
  clientY: number;
  refresh: () => void;
}

declare global {
  interface WindowEventMap {
    "pi-web:session-row-contextmenu": CustomEvent<SessionRowContextMenuDetail>;
  }
}

/** Returns true when a synchronous listener claims the context menu. */
export function dispatchSessionRowContextMenu(
  detail: SessionRowContextMenuDetail,
  target: EventTarget = window,
): boolean {
  const event = new CustomEvent<SessionRowContextMenuDetail>(SESSION_ROW_CONTEXT_MENU_EVENT, {
    cancelable: true,
    detail,
  });
  return !target.dispatchEvent(event);
}
