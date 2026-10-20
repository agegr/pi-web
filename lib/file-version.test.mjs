import assert from "node:assert/strict";
import test from "node:test";

const { fileVersion, fileVersionChanged } = await import("./file-version.ts");

test("meta reads and watch change events of the same file give the same version", () => {
  const mtime = "2026-10-16T08:00:00.000Z";
  assert.equal(fileVersion({ size: 12, mtime, language: "text", mime: "image/png" }), fileVersion({ size: 12, mtime }));
  assert.notEqual(fileVersion({ size: 12, mtime }), fileVersion({ size: 13, mtime }));
  assert.notEqual(fileVersion({ size: 12, mtime }), fileVersion({ size: 12, mtime: "2026-10-16T08:00:01.000Z" }));
});

test("a version with a part missing is none", () => {
  for (const meta of [null, undefined, {}, { size: 1 }, { mtime: "x" }, { size: "1", mtime: "x" }, { error: "Not a file" }]) {
    assert.equal(fileVersion(meta), null);
  }
});

test("only a known, equal version counts as unchanged", () => {
  assert.equal(fileVersionChanged("1:a", "1:a"), false);
  assert.equal(fileVersionChanged("1:a", "2:a"), true);
  // Nothing shown yet (first connect, or a change event without a version), or a
  // meta read without one: load it.
  assert.equal(fileVersionChanged(null, "1:a"), true);
  assert.equal(fileVersionChanged("1:a", null), true);
  assert.equal(fileVersionChanged(null, null), true);
});
