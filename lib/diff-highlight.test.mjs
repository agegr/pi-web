import test from "node:test";
import assert from "node:assert/strict";
import { highlightCodeRows } from "./diff-highlight.ts";

test("splits highlighted code into one row per line, preserving empty lines", () => {
  const code = "const a = 1;\n\nconst b = 2;";
  const rows = highlightCodeRows(code, "javascript", {});
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], []);
  // Token spans are produced for recognized code (keyword "const" on line 1).
  assert.ok(rows[0].length > 0);
});

test("keeps row count aligned with input", () => {
  const code = "a = 1\n# comment";
  const rows = highlightCodeRows(code, "python", {});
  assert.equal(rows.length, 2);
});

test("falls back to plain text rows for unknown languages", () => {
  const rows = highlightCodeRows("hello\nworld", "not-a-language", {});
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 1);
});

test("returns no rows for empty input", () => {
  assert.deepEqual(highlightCodeRows("", "javascript", {}), []);
});
