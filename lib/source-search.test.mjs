import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { findSourceMatches, SOURCE_SEARCH_MAX_MATCHES } = await jiti.import("./source-search.ts");

test("finds every occurrence, case-insensitively by default", () => {
  const result = findSourceMatches(["Foo foo", "bar", "FOO"], "foo");
  assert.deepEqual(result.matches, [
    { line: 0, start: 0, end: 3 },
    { line: 0, start: 4, end: 7 },
    { line: 2, start: 0, end: 3 },
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.truncated, false);
  assert.deepEqual(findSourceMatches(["Foo"], "foo", true).matches, []);
});

test("treats the query as literal text, not a pattern", () => {
  assert.deepEqual(findSourceMatches(["a.b", "axb"], "a.b").matches, [{ line: 0, start: 0, end: 3 }]);
  assert.deepEqual(findSourceMatches(["f(x)[0]"], "x)[0").matches, [{ line: 0, start: 2, end: 6 }]);
});

test("keeps offsets on the original line when case differs", () => {
  // Case folding of "İ" is longer than the character, so lowercasing the line
  // would move this match; a case-insensitive RegExp keeps the real offsets.
  const result = findSourceMatches(["İstanbul IST"], "ist");
  assert.deepEqual(result.matches, [{ line: 0, start: 9, end: 12 }]);
});

test("an empty query and an empty list find nothing", () => {
  assert.deepEqual(findSourceMatches(["anything"], ""), { matches: [], total: 0, truncated: false });
  assert.deepEqual(findSourceMatches([], "a"), { matches: [], total: 0, truncated: false });
});

test("counts past the stored-match limit and reports truncation", () => {
  const lines = ["aaaa", "aaaa"];
  const result = findSourceMatches(lines, "a", false, 3);
  assert.equal(result.total, 8);
  assert.equal(result.matches.length, 3);
  assert.equal(result.truncated, true);
  assert.equal(SOURCE_SEARCH_MAX_MATCHES, 5_000);
});
