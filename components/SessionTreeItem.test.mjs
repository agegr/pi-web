import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// SessionItem used to live inside SessionSidebar.tsx; it was extracted into
// this file (alongside SessionTreeItem) so both SessionSidebar and
// SessionFolderTree can render sessions with the same rename/delete/move
// interactions. These assertions moved with it.
const source = await readFile(new URL("./SessionTreeItem.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("move-to-folder action is opt-in and delegates entirely to the caller", () => {
  assert.match(sessionItemSource, /onMoveToFolder\?: \(folderId: string \| null\) => void/);
  const menuSource = source.slice(source.indexOf("function MoveToFolderMenu"), source.indexOf("export function SessionTreeItem"));
  // The menu only ever calls the callback prop — it must never touch a
  // session file itself (that would defeat the point of a display-only folder layer).
  assert.doesNotMatch(menuSource, /fetch\(/);
});
