import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { detectLineSeparator, readTextFileForEditing, textContentReadOnlyReason } = await jiti.import("./file-edit.ts");

test("detects the one line separator a file uses", () => {
  assert.equal(detectLineSeparator(""), "\n");
  assert.equal(detectLineSeparator("no newline"), "\n");
  assert.equal(detectLineSeparator("a\nb\n"), "\n");
  assert.equal(detectLineSeparator("a\r\nb\r\n"), "\r\n");
  assert.equal(detectLineSeparator("a\r\nb\n"), null);
  assert.equal(detectLineSeparator("a\rb"), null);
});

test("keeps a byte order mark and accepts any valid UTF-8", () => {
  assert.equal(textContentReadOnlyReason(Buffer.from("\uFEFFhello\n", "utf8")), null);
  assert.equal(textContentReadOnlyReason(Buffer.from("grüße 😀\n", "utf8")), null);
});

test("a file only a session reference authorized reads as read-only", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-edit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "referenced.txt");
  fs.writeFileSync(file, "\uFEFFtext\n");
  const result = readTextFileForEditing(file, false);
  assert.equal(result.editable, false);
  assert.equal(result.readOnlyReason, "outside-roots");
  assert.equal(result.content, "\uFEFFtext\n");
});
