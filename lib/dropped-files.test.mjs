import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { decodeDroppedFileUri, droppedFilePaths, droppedFileReference } = await jiti.import("./dropped-files.ts");

test("decodes POSIX file URIs", () => {
  assert.equal(decodeDroppedFileUri("file:///home/me/a%20b.txt"), "/home/me/a b.txt");
});

test("decodes Windows drive file URIs", () => {
  assert.equal(decodeDroppedFileUri("file:///C:/Users/me/a.txt"), "C:/Users/me/a.txt");
});

test("rejects non-file URIs and malformed input", () => {
  assert.equal(decodeDroppedFileUri("https://example.com/x"), null);
  assert.equal(decodeDroppedFileUri("file:///home/me/%zz"), null);
  assert.equal(decodeDroppedFileUri("file://"), null);
});

test("maps file URIs to files in order", () => {
  const files = [new File(["a"], "a.txt"), new File(["b"], "b.log")];
  const paths = droppedFilePaths(files, "file:///tmp/a.txt\r\nfile:///tmp/b.log", "");
  assert.deepEqual(paths, ["/tmp/a.txt", "/tmp/b.log"]);
});

test("ignores comments and blank lines in uri-list", () => {
  const files = [new File(["a"], "a.txt")];
  const paths = droppedFilePaths(files, "# comment\r\n\r\nfile:///tmp/a.txt", "");
  assert.deepEqual(paths, ["/tmp/a.txt"]);
});

test("falls back to null when the URI count does not match", () => {
  const files = [new File(["a"], "a.txt")];
  assert.deepEqual(droppedFilePaths(files, "file:///tmp/a.txt\r\nfile:///tmp/b.log", ""), [null]);
  assert.deepEqual(droppedFilePaths(files, "https://example.com/a.txt", ""), [null]);
});

test("uses an absolute text/plain fallback for a single file", () => {
  const files = [new File(["a"], "a.txt")];
  assert.deepEqual(droppedFilePaths(files, "", "/tmp/a.txt"), ["/tmp/a.txt"]);
  assert.deepEqual(droppedFilePaths(files, "", "C:\\Users\\me\\a.txt"), ["C:\\Users\\me\\a.txt"]);
  // Bare basenames carry no location, so they are ignored.
  assert.deepEqual(droppedFilePaths(files, "", "a.txt"), [null]);
});

test("reference falls back to the file name", () => {
  const file = new File(["a"], "notes.md");
  assert.equal(droppedFileReference(file, "/tmp/notes.md"), "/tmp/notes.md");
  assert.equal(droppedFileReference(file, null), "notes.md");
});
