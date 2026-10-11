import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("directory rows act as precise drag-and-drop upload targets", () => {
  // Only directory rows accept file drags; file rows let the event bubble
  // to the explorer background handler.
  const dragOverStart = source.indexOf("onDragOver={node.isDir ? (event) => {");
  const dropStart = source.indexOf("onDrop={node.isDir ? (event) => {");
  assert.notEqual(dragOverStart, -1);
  assert.notEqual(dropStart, -1);

  const dragOverBlock = source.slice(dragOverStart, source.indexOf("} : undefined}", dragOverStart));
  assert.match(dragOverBlock, /event\.dataTransfer\.types\.includes\("Files"\)/);
  assert.match(dragOverBlock, /event\.stopPropagation\(\)/);
  assert.match(dragOverBlock, /event\.dataTransfer\.dropEffect = "copy"/);
  assert.match(dragOverBlock, /onDropTargetChange\?\.\(node\.fullPath\)/);

  const dropBlock = source.slice(dropStart, source.indexOf("} : undefined}", dropStart));
  assert.match(dropBlock, /event\.stopPropagation\(\)/);
  assert.match(dropBlock, /onDropFiles\?\.\(node\.fullPath, droppedFiles\)/);
});

test("the active drop target directory row is visually highlighted", () => {
  assert.match(source, /const isDropTarget = node\.isDir && dropTargetPath === node\.fullPath;/);
  assert.match(source, /outline: isDropTarget \? "1px dashed var\(--accent\)" : "none",/);
  assert.match(source, /color-mix\(in srgb, var\(--accent\) 16%, transparent\)/);
});

test("uploads flow through a parameterized target directory", () => {
  // The check, the upload itself, the conflict prompt, and the result
  // summary all carry the directory the files were dropped onto.
  assert.match(source, /const prepareUpload = useCallback\(async \(files: File\[\], directory: string\) =>/);
  assert.match(source, /encodeFilePathForApi\(directory\)\}\?type=upload-check/);
  assert.match(source, /await uploadFiles\(directory, files, strategy, setUploadProgress\)/);
  assert.match(source, /await performUpload\(files, "error", directory\)/);
  assert.match(source, /applyUploadResult\(data, directory\)/);
  assert.match(source, /setUploadSummary\(\{ directory, uploaded, skipped, errors \}\)/);
  assert.match(source, /performUpload\(pendingConflict\.files, "overwrite", pendingConflict\.directory\)/);
  assert.match(source, /performUpload\(pendingConflict\.files, "skip", pendingConflict\.directory\)/);
  assert.match(source, /joinFilePath\(uploadSummary\.directory, name\)/);
});

test("dropping on the explorer background falls back to the project root", () => {
  assert.match(source, /const target = dropTargetPath \?\? cwd;/);
  // The picker keeps uploading straight into the cwd.
  assert.match(source, /void prepareUpload\(files, cwd\);/);
  // Directory rows swallow dragover events, so the background handler
  // clears any stale directory target instead of overwriting it.
  const dragOver = source.indexOf("const handleExplorerDragOver = useCallback(");
  const block = source.slice(dragOver, source.indexOf("}, []);", dragOver));
  assert.match(block, /setDropTargetPath\(\(prev\) => \(prev === null \? prev : null\)\)/);
});

test("the drag hint banner shows which directory receives the drop", () => {
  assert.match(source, /t\("files\.dropToUpload", \{/);
  assert.match(source, /getRelativeFilePath\(dropTargetPath, cwd\) \|\| dropTargetPath/);
});
