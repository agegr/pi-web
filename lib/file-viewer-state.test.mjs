import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveInitialFileDisplayMode,
  resolveInitialWrapLines,
  wrapsByDefault,
} from "./file-viewer-state.ts";

test("a restored display mode wins over a stale open hint", () => {
  const state = {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 80,
    scrollLeft: 0,
  };

  assert.equal(resolveInitialFileDisplayMode(state, "diff"), "source");
});

test("the open hint is used only before viewer state has been saved", () => {
  assert.equal(resolveInitialFileDisplayMode(undefined, "diff"), "diff");
  assert.equal(resolveInitialFileDisplayMode(), "source");
});

test("prose files open wrapped and source code does not", () => {
  // A long prose line is the same sentence: horizontal scroll hides its end.
  for (const path of ["/repo/README.md", "/repo/notes.MARKDOWN", "/repo/a/b.mdx", "/x/rst.rst", "/repo/notes.md.txt", "/repo/notes.txt"]) {
    assert.equal(wrapsByDefault(path), true, path);
    assert.equal(resolveInitialWrapLines(undefined, path), true, path);
  }
  // Code keeps one line per row, as an editor does: indentation is the cue. A log
  // line is a column too — wrap one and the next line's timestamp lands where its
  // message was.
  for (const path of ["/repo/a.ts", "/repo/b.py", "/repo/c.jsonl", "/repo/Makefile", "/repo/app.log", "/repo/noext"]) {
    assert.equal(wrapsByDefault(path), false, path);
    assert.equal(resolveInitialWrapLines(undefined, path), false, path);
  }
  assert.equal(wrapsByDefault(undefined), false);
});

test("an explicit wrap choice beats the file's kind in either direction", () => {
  const state = { displayMode: "source", scrollTop: 0, scrollLeft: 0 };

  assert.equal(resolveInitialWrapLines({ ...state, wrapLines: false }, "/repo/README.md"), false);
  assert.equal(resolveInitialWrapLines({ ...state, wrapLines: true }, "/repo/a.ts"), true);
  // An unmade choice (undefined) still follows the kind.
  assert.equal(resolveInitialWrapLines({ ...state, wrapLines: undefined }, "/repo/README.md"), true);
});
