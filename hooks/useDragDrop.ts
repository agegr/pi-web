"use client";

import { useState, useCallback, useRef } from "react";

export type DragDropEntries = (FileSystemEntry | null)[];

/**
 * Shared drag/drop state for the chat surface. The overlay opens for any
 * dropped file or folder (not just images); the consumer decides whether a
 * drop attaches image content or turns the items into file references.
 *
 * `entries` are snapshotted synchronously in the drop handler because
 * `DataTransferItem.webkitGetAsEntry()` is only valid during the event.
 */
export function useDragDrop(
  onDrop: (files: File[], entries: DragDropEntries, uriList: string) => void,
) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const hasDraggedFiles = useCallback((e: React.DragEvent) => (
    Array.from(e.dataTransfer.items).some((item) => item.kind === "file")
  ), []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, [hasDraggedFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, [hasDraggedFiles]);

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
    const entries: DragDropEntries = Array.from(e.dataTransfer.items).map((item) => (
      item.kind === "file" ? item.webkitGetAsEntry() : null
    ));
    const files = Array.from(e.dataTransfer.files);
    // Some browsers expose the original `file://` path(s) here; it is the only
    // way to recover a dropped file's real directory.
    const uriList = e.dataTransfer.getData("text/uri-list")
      || e.dataTransfer.getData("text/plain")
      || "";
    onDrop(files, entries, uriList);
  }, [onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
