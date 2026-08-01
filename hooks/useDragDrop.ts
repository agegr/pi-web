"use client";

import { useState, useCallback, useRef } from "react";

export function useDragDrop(onDrop: (files: File[], dataTransfer: DataTransfer | null) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragHasImages, setDragHasImages] = useState(false);
  const counterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const items = Array.from(e.dataTransfer.items);
    if (!items.some((item) => item.kind === "file")) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
    setDragHasImages(items.some((item) => item.type.startsWith("image/")));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const items = Array.from(e.dataTransfer.items);
    if (!items.some((item) => item.kind === "file")) return;
    e.preventDefault();
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
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    onDrop(files, e.dataTransfer);
  }, [onDrop]);

  return { isDragOver, dragHasImages, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
