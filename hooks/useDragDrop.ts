"use client";

import { useState, useCallback, useRef } from "react";
import type { DroppedItem } from "@/lib/file-upload-client";
import { readSessionDrag, SESSION_DRAG_MIME } from "@/lib/session-drag";
import type { SessionReferenceTarget } from "@/lib/session-reference-target";

/** What a drag carries: a dragged sidebar row, or files and folders. */
function draggedKind(e: React.DragEvent): "session" | "files" | null {
  if (e.dataTransfer.types.includes(SESSION_DRAG_MIME)) return "session";
  return Array.from(e.dataTransfer.items).some((item) => item.kind === "file") ? "files" : null;
}

/**
 * Reads a drop's files and folders. `webkitGetAsEntry()` only answers during
 * the drop event, so this has to run inside the handler. A folder is told by
 * its entry first: some browsers return no `File` for it.
 */
export function droppedItems(dataTransfer: DataTransfer): DroppedItem[] {
  const items: DroppedItem[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      items.push({ kind: "folder", name: entry.name });
      continue;
    }
    const file = item.getAsFile();
    if (file) items.push({ kind: "file", file });
  }
  if (items.length > 0) return items;
  return Array.from(dataTransfer.files).map((file) => ({ kind: "file", file }));
}

export function useDragDrop(onDrop: (items: DroppedItem[], session?: SessionReferenceTarget) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!draggedKind(e)) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!draggedKind(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    // A dragged session row quotes that session; anything else is files.
    const session = readSessionDrag(e.dataTransfer);
    onDrop(session ? [] : droppedItems(e.dataTransfer), session ?? undefined);
  }, [onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
