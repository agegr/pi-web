import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeMarkdownFile, MAX_MARKDOWN_EDIT_BYTES } from "./markdown-file.ts";

function fixture(t, content = "original\r\n") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-markdown-test-"));
  const file = path.join(dir, "note.md");
  fs.writeFileSync(file, content);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return file;
}

test("writes the matching version and truncates only after validation", (t) => {
  const file = fixture(t);
  assert.equal(writeMarkdownFile(file, "短\n", "original\r\n", () => true).conflict, false);
  assert.equal(fs.readFileSync(file, "utf8"), "短\n");
});
test("a stale baseline returns latest content without overwriting", (t) => {
  const file = fixture(t, "external\n");
  assert.deepEqual(writeMarkdownFile(file, "local\n", "old\n", () => true), { conflict: true, content: "external\n" });
  assert.equal(fs.readFileSync(file, "utf8"), "external\n");
});
test("never creates missing files and refuses denied paths", (t) => {
  const file = fixture(t);
  assert.throws(() => writeMarkdownFile(file + ".missing", "x", "", () => true));
  assert.equal(fs.existsSync(file + ".missing"), false);
  assert.throws(() => writeMarkdownFile(file, "x", "original\r\n", () => false), /Access denied/);
  assert.equal(fs.readFileSync(file, "utf8"), "original\r\n");
});
test("oversized originals, invalid UTF-8 and binary data are never overwritten", (t) => {
  for (const content of [Buffer.alloc(MAX_MARKDOWN_EDIT_BYTES + 1, 65), Buffer.from([0xff, 0xfe, 65]), Buffer.from("a\0b")]) {
    const file = fixture(t, content);
    assert.throws(() => writeMarkdownFile(file, "x", content.toString("utf8"), () => true));
    assert.deepEqual(fs.readFileSync(file), content);
  }
});
