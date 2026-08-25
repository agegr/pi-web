import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");

test("provides a debounced file search UI and opens selected results", () => {
  assert.match(source, /searchQuery/);
  assert.match(source, /type=search&q=\$\{encodeURIComponent\(query\)\}/);
  assert.match(source, /setTimeout\(\(\) =>/);
  assert.match(source, /onOpenFile\(joinFilePath\(cwd, node\.path\), node\.name\)/);
});

test("renders search results as an expandable directory tree", () => {
  assert.match(source, /buildSearchTree/);
  assert.match(source, /FolderIcon size=\{14\} open=\{open\}/);
  assert.match(source, /onToggleExpanded\(node\.path, !open\)/);
  assert.match(source, /expandedPaths=\{searchExpanded\}/);
});

test("search result rows offer mention and download actions like the file tree", () => {
  assert.match(source, /onAtMention\(node\.path, node\.isDir\)/);
  assert.match(source, /<MentionIcon \/>/);
  assert.match(source, /encodeFilePathForApi\(joinFilePath\(cwd, node\.path\)\)\}\?type=download/);
});

test("file search endpoint wires the search handler to the route", () => {
  assert.match(apiSource, /type === "search"/);
  assert.match(apiSource, /searchFiles\(filePath, query\)/);
  assert.match(apiSource, /import \{ IGNORED_NAMES, IGNORED_SUFFIXES, searchFiles \} from "@\/lib\/file-search"/);
});
