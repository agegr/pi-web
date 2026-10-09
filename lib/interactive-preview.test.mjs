import assert from "node:assert/strict";
import test from "node:test";
import { interactivePreviewHeight } from "./interactive-preview.ts";

test("preview height follows short and tall content without a normal minimum or maximum", () => {
  for (const height of [1, 80, 160, 480, 1100, 2160, 9000, 100_000]) {
    assert.equal(interactivePreviewHeight(height), height);
  }
  assert.equal(interactivePreviewHeight(1100.25), 1101);
});

test("preview height rejects invalid and pathological reports", () => {
  for (const height of [undefined, null, "1100", {}, [], NaN, Infinity, -Infinity, 0, -1, 100_001, Number.MAX_VALUE]) {
    assert.equal(interactivePreviewHeight(height), null);
  }
});
