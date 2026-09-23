import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");

test("the picker dialog owns the worktree create/remove affordances (moved from the sidebar)", () => {
  // pi#45: worktree create/remove live in the DirectoryPicker now.
  assert.match(source, /onRemoveEntry/);
  assert.match(source, /onRenameEntry/);
});

test("the new-folder flow posts to the files API mkdir branch and surfaces errors inline", () => {
  assert.match(source, /\?type=mkdir/);
  assert.match(source, /mkdirError/);
  // The request carries the folder name as JSON.
  assert.match(source, /JSON\.stringify\(\{ name/);
});

test("manage mode renders the directory entries with rename and remove affordances", () => {
  // Managed rows show the entry (display name or path) plus rename/remove.
  assert.match(source, /entry\.displayName \|\| entry\.path|entry\.path/);
  assert.match(source, /onRename\b/);
  assert.match(source, /onRemove\b/);
});
