"use client";

import { useEffect } from "react";
import { copyText } from "@/lib/clipboard";

const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true']";

export function useAutoCopySelection() {
  useEffect(() => {
    let lastCopied = "";
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const handleSelectionChange = () => {
      const selection = window.getSelection();

      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
      }

      const text = selection.toString();

      if (!text.trim()) {
        return;
      }

      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;

      const anchorElement =
        anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;

      const focusElement =
        focusNode instanceof Element ? focusNode : focusNode?.parentElement;

      if (
        anchorElement?.closest(EDITABLE_SELECTOR) ||
        focusElement?.closest(EDITABLE_SELECTOR)
      ) {
        return;
      }

      if (text === lastCopied) {
        return;
      }

      lastCopied = text;

      if (resetTimer) clearTimeout(resetTimer);

      resetTimer = setTimeout(() => {
        lastCopied = "";
      }, 500);

      void copyText(text).catch(() => {
        lastCopied = "";
      });
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);
}
