import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");
const viewer = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const directory = await readFile(new URL("./DirectoryViewer.tsx", import.meta.url), "utf8");

test("metadata recognizes directories after existing authorization checks", () => {
  const meta = route.indexOf('if (type === "meta")');
  assert.ok(route.indexOf("isExistingFilePathAllowed(existingAuthorizationPath, allowedRoots)") < meta);
  assert.match(route.slice(meta), /stat\?\.isDirectory\(\)[\s\S]*?isDirectory: true/);
});

test("right panel dispatches directories by metadata rather than filename extension", () => {
  assert.match(viewer, /data\.isDirectory \? "directory" : "file"/);
  assert.match(viewer, /kind === "directory"[\s\S]*?<DirectoryViewer/);
  assert.match(directory, /\?type=list/);
  assert.match(directory, /onOpenFile\?\.\(childPath\)/);
  assert.match(directory, /controller\.abort\(\)/);
});
