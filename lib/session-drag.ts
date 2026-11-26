// Dragging a session row into the composer (#1716): the row writes the session
// as JSON under its own type, so a drop tells a quoted session apart from a
// file, and one dragged from another app (a link, a text selection) is never
// mistaken for one of ours.

import { isRecord } from "./is-record";
import type { SessionReferenceTarget } from "./session-reference-target";

export const SESSION_DRAG_MIME = "application/x-pi-web-session";

/** The drag payload for a row: what the chip needs, nothing that could go stale. */
export function sessionDragData(target: SessionReferenceTarget): string {
  return JSON.stringify({
    id: target.id,
    title: target.title,
    cwd: target.cwd ?? "",
    modified: target.modified ?? "",
  });
}

interface DragSource {
  types: readonly string[];
  getData(format: string): string;
}

/** The dragged session, or null when this drag is not one of ours. */
export function readSessionDrag(dataTransfer: DragSource): SessionReferenceTarget | null {
  if (!dataTransfer.types.includes(SESSION_DRAG_MIME)) return null;
  try {
    const parsed: unknown = JSON.parse(dataTransfer.getData(SESSION_DRAG_MIME));
    if (!isRecord(parsed)) return null;
    const { id, title, cwd, modified } = parsed;
    if (typeof id !== "string" || !id) return null;
    return {
      id,
      title: typeof title === "string" ? title : "",
      cwd: typeof cwd === "string" && cwd ? cwd : undefined,
      modified: typeof modified === "string" && modified ? modified : undefined,
    };
  } catch {
    return null;
  }
}