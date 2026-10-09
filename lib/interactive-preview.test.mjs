import assert from "node:assert/strict";
import test from "node:test";
import { interactivePreviewDocument, interactivePreviewHostDocument, interactivePreviewError, interactivePreviewHeight } from "./interactive-preview.ts";

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

test("preview errors accept only supported kinds and bounded plain text", () => {
  for (const value of [undefined, null, "oops", [], {}, { kind: "runtime" }, { kind: "other", message: "oops" }, { kind: "promise", message: {} }]) {
    assert.equal(interactivePreviewError(value), null);
  }
  assert.deepEqual(interactivePreviewError({ kind: "runtime", message: " \u0000\u001b\u202e<img src=x>错误\u2069 " }), {
    kind: "runtime", message: "<img src=x>错误",
  });
  assert.equal(interactivePreviewError({ kind: "promise", message: "x".repeat(2000) }).message.length, 1000);
  assert.deepEqual(interactivePreviewError({ kind: "promise", message: "" }), { kind: "promise", message: "" });
});

test("preview error locations refer to original HTML, not the injected bootstrap", () => {
  const offset = interactivePreviewDocument("").split("\n").length - 1;
  assert.deepEqual(interactivePreviewError({ kind: "runtime", message: "oops", line: offset + 3, column: 12 }), {
    kind: "runtime", message: "oops", line: 3, column: 12,
  });
  for (const line of [undefined, "3", NaN, Infinity, 0, -1, 3.5, 1_000_001, offset]) {
    assert.deepEqual(interactivePreviewError({ kind: "runtime", message: "oops", line, column: 12 }), { kind: "runtime", message: "oops" });
  }
  for (const column of [undefined, "12", NaN, 0, -1, 12.5, 1_000_001]) {
    assert.deepEqual(interactivePreviewError({ kind: "promise", message: "oops", line: offset + 2, column }), {
      kind: "promise", message: "oops", line: 2,
    });
  }
});

test("the trusted host serializes generated HTML without allowing markup or script breakout", () => {
  const code = '</script><script>parent.attack()</script><iframe src="https://example.invalid"></iframe>';
  const host = interactivePreviewHostDocument(code);
  assert.ok(host.includes("frame-src 'none'"));
  assert.ok(host.includes("frame.sandbox = 'allow-scripts'"));
  assert.equal((host.match(/<script>/g) ?? []).length, 1);
  assert.equal((host.match(/<\/script>/g) ?? []).length, 1);
  assert.equal(host.includes(code), false);
  const literal = /frame\.srcdoc = ("[^\n]+");/.exec(host)[1];
  assert.equal(JSON.parse(literal), interactivePreviewDocument(code));
});
