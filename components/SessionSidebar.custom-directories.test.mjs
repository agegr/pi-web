import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../lib/custom-directories.ts", import.meta.url), "utf8");

test("the sidebar renders the user's custom directory list (not the legacy pin store)", () => {
  assert.match(source, /listCustomDirectories\(\)/);
  assert.match(source, /customDirectoryIdentity\(entry\.path\)/);
  // The legacy pin store reader is gone from the sidebar entirely.
  assert.doesNotMatch(source, /getPinnedProjects\(\)/);
});

test("the directory entry manages rename and remove through the custom-directories store", () => {
  assert.match(source, /renameCustomDirectory/);
  assert.match(source, /removeCustomDirectory/);
  // The store's rename/remove persist through the same writer.
  assert.match(storeSource, /export function renameCustomDirectory/);
  assert.match(storeSource, /export function removeCustomDirectory/);
});

test("the manage affordances open the picker dialog in manage mode (entries passed)", () => {
  // The dialog receives the entries list and the rename/remove callbacks.
  assert.match(source, /entries=\{/);
  assert.match(source, /onRenameEntry=/);
  assert.match(source, /onRemoveEntry=/);
});
