import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("the source view is the lazily loaded CodeMirror editor", () => {
  // Static highlighting is gone from the file viewer; chat code blocks keep it.
  assert.doesNotMatch(source, /react-syntax-highlighter/);
  assert.match(source, /const CodeEditor = dynamic\(\(\) => import\("\.\/CodeEditor"\), \{ ssr: false \}\);/);
  assert.match(source, /import type \{ CodeEditorHandle, SelectedLineRange \} from "\.\/CodeEditor";/);
  // Read-only until the Edit switch, and only for files the server marked editable.
  assert.match(source, /readOnly=\{!editing \|\| !canEdit\}/);
  assert.match(source, /const canEdit = data\?\.editable === true && !isDeletedDiff;/);
});

test("the editor stays mounted while a preview or diff is shown", () => {
  // Unmounting it would drop unsaved text and undo history.
  assert.match(source, /display: showSource \? "block" : "none"/);
  assert.match(source, /const previewSource = previewDraft \?\? data\?\.content \?\? "";/);
});

test("reads ask for the editable whole file; saves never carry a session reference", () => {
  assert.match(source, /getFileApiUrl\(filePath, "read", sourceSessionId, offset \? \{ offset \} : \{ edit: 1 \}\)/);
  assert.match(source, /fetch\(getFileApiUrl\(filePath, "save"\), \{/);
  assert.match(source, /body: JSON\.stringify\(\{ content, baseHash \}\)/);
});

test("a successful save refreshes the explorer's Git status", () => {
  const save = source.slice(source.indexOf("const save = useCallback("));
  assert.match(save, /handle\.markSaved\(content\);\s*recordDraft\(\);\s*onFileSaved\?\.\(\);/);
});

test("a save holds live synchronization until its response lands", () => {
  const synchronize = source.slice(source.indexOf("const synchronize = useCallback("));
  assert.match(synchronize, /if \(savingRef\.current\) \{\s*pendingSyncRef\.current = true;\s*return;/);
  const save = source.slice(source.indexOf("const save = useCallback("));
  assert.match(save, /contentRequestRef\.current\+\+;/);
  assert.match(save, /if \(pendingSyncRef\.current\) \{\s*pendingSyncRef\.current = false;\s*synchronize\(\);/);
});

test("a change on disk under unsaved edits becomes a conflict, never a silent reload", () => {
  const apply = source.slice(source.indexOf("const applyDiskVersion = useCallback("));
  assert.match(apply, /if \(next\.hash && next\.hash === baseHashRef\.current\) return;\s*if \(dirtyRef\.current\) \{\s*setDiskConflict\(\{ kind: "changed", disk: next \}\);/);
});

test("only editable file tabs own drafts, not special read-only tabs for the same path", async () => {
  const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const tabs = await readFile(new URL("./TabBar.tsx", import.meta.url), "utf8");
  assert.match(shell, /if \(closingTab && !closingTab\.kind && getFileEditDraft\(closingTab\.filePath\)\)/);
  assert.match(tabs, /const isDirty = !tab\.kind && dirtyPaths\.has\(tab\.filePath\);/);
});

test("markdown preview keeps app links and opens web and app links in a new tab (#1108)", () => {
  assert.match(source, /urlTransform=\{onOpenFile \? markdownUrlTransform : markdownAppUrlTransform\}/);
  assert.match(
    source,
    /return isExternalMarkdownHref\(href\)\s*\? <a href=\{href\} \{\.\.\.props\} target="_blank" rel="noopener noreferrer">\{children\}<\/a>\s*: <a href=\{href\} \{\.\.\.props\}>\{children\}<\/a>;/,
  );
});

test("markdown preview links carry PDF page fragments", () => {
  assert.match(source, /parsePdfPageFragment/);
  assert.match(source, /onOpenFile\(linkedFile, parsePdfPageFragment\(href\) \?\? undefined\)/);
});
