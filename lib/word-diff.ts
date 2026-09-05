/**
 * Word-level (inline) diff for two lines of a removed/added pair.
 *
 * Delegates to jsdiff's `diffWords` which tokenizes words and finds the
 * longest common sequence with battle-tested edge-case handling.
 * White-space-only changes are left unpainted so a pure indentation tweak
 * doesn't turn a whole line red/green.
 */

import { diffWords } from "diff";

export type InlineDiffSegment = { type: "common" | "removed" | "added"; text: string };

export interface InlineDiffResult {
  left: InlineDiffSegment[];
  right: InlineDiffSegment[];
}

/** Append a typed slice, merging neighbors and skipping whitespace-only paint. */
function pushSlice(target: InlineDiffSegment[], type: InlineDiffSegment["type"], text: string): void {
  if (type !== "common" && /^\s+$/.test(text)) type = "common";
  const last = target[target.length - 1];
  if (last && last.type === type) {
    last.text += text;
  } else {
    target.push({ type, text });
  }
}

export function inlineWordDiff(leftText: string, rightText: string): InlineDiffResult {
  const parts = diffWords(leftText, rightText);
  const left: InlineDiffSegment[] = [];
  const right: InlineDiffSegment[] = [];
  for (const part of parts) {
    if (part.added) {
      pushSlice(right, "added", part.value);
    } else if (part.removed) {
      pushSlice(left, "removed", part.value);
    } else {
      pushSlice(left, "common", part.value);
      pushSlice(right, "common", part.value);
    }
  }
  return { left, right };
}
