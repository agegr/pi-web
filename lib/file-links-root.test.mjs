import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalFilePath, resolveLocalFileHref } from "./file-links.ts";

test("parent segments cannot consume the Windows drive or UNC share root", () => {
  assert.equal(resolveLocalFilePath("C:/../notes.txt"), "C:/notes.txt");
  assert.equal(resolveLocalFilePath("C:/work/../../notes.txt"), "C:/notes.txt");
  assert.equal(resolveLocalFilePath("C:/"), "C:/");
  assert.equal(resolveLocalFilePath("\\\\server\\share\\..\\notes.txt"), "//server/share/notes.txt");
  assert.equal(resolveLocalFileHref("file:///C:/work/../../notes.txt"), "C:/notes.txt");
  assert.equal(resolveLocalFilePath("/work/../../notes.txt"), "/notes.txt");
});
