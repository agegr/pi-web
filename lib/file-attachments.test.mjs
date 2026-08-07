import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { splitAttachmentLinks, appendAttachmentPaths, formatFileSize, fileBaseName } =
  await jiti.import("./file-attachments.ts");

test("passes through text without attachment lines", () => {
  assert.deepEqual(splitAttachmentLinks("hello world"), [{ type: "text", text: "hello world" }]);
});

test("splits attachment lines from surrounding text", () => {
  const segments = splitAttachmentLinks("please read\n\n[附件] /tmp/a.pdf\n\nthanks");
  assert.equal(segments.length, 3);
  assert.equal(segments[0].type, "text");
  assert.equal(segments[1].type, "attachment");
  if (segments[1].type === "attachment") assert.equal(segments[1].path, "/tmp/a.pdf");
  assert.equal(segments[2].type, "text");
});

test("handles multiple attachment lines", () => {
  const segments = splitAttachmentLinks("[附件] /a.txt\n[附件] /b.txt");
  assert.equal(segments.length, 3);
  assert.equal(segments[0].type, "attachment");
  assert.equal(segments[1].type, "text");
  assert.equal(segments[2].type, "attachment");
});

test("appends attachment paths to a message", () => {
  const message = appendAttachmentPaths("hello", [
    { path: "/tmp/a.pdf", size: 10 },
    { path: "/tmp/b.txt", size: 5 },
  ]);
  assert.equal(message, "hello\n\n[附件] /tmp/a.pdf\n\n[附件] /tmp/b.txt");
});

test("round-trips append then split", () => {
  const message = appendAttachmentPaths("hello", [{ path: "/x/a.txt", size: 1 }]);
  const segments = splitAttachmentLinks(message);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].type, "attachment");
  if (segments[1].type === "attachment") assert.equal(segments[1].path, "/x/a.txt");
});

test("formats file sizes", () => {
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(3 * 1024 * 1024), "3.0 MB");
});

test("extracts the base name from a path", () => {
  assert.equal(fileBaseName("/tmp/a b.pdf"), "a b.pdf");
  assert.equal(fileBaseName("C:\\Users\\me\\x.txt"), "x.txt");
});
