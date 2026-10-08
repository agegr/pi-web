import type { EditorState, Text } from "@codemirror/state";

// Pure helpers of the file viewer's CodeMirror editor (components/CodeEditor.tsx).

export interface SelectedLineRange {
  startLine: number;
  endLine: number;
}

/** The selected lines; a selection ending at a line's start leaves that line out. */
export function selectedLineRange(state: EditorState): SelectedLineRange | null {
  const { from, to, empty } = state.selection.main;
  if (empty) return null;
  const start = state.doc.lineAt(from);
  const end = state.doc.lineAt(to);
  const endLine = end.number > start.number && to === end.from ? end.number - 1 : end.number;
  return { startLine: start.number, endLine };
}

/** The smallest single replacement turning `current` into `next`. */
export function minimalReplacement(current: Text, next: Text): { from: number; to: number; insert: Text } | null {
  if (current.eq(next)) return null;
  const a = current.toString();
  const b = next.toString();
  const limit = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < limit && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < limit - prefix
    && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  ) suffix++;
  return { from: prefix, to: a.length - suffix, insert: next.slice(prefix, b.length - suffix) };
}
