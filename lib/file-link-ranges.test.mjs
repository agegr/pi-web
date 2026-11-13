import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalFileHref } from "./file-links.ts";

test("line-range links open the underlying file", () => {
  assert.equal(resolveLocalFileHref("/repo/src/app.ts:12-18", "/repo"), "/repo/src/app.ts");
  assert.equal(resolveLocalFileHref("src/app.ts:12-18", "/repo"), "/repo/src/app.ts");
  assert.equal(resolveLocalFileHref("C:/repo/app.ts:12-18", "C:/repo"), "C:/repo/app.ts");
  assert.equal(resolveLocalFileHref("/repo/app.ts:12:3", "/repo"), "/repo/app.ts");
  assert.equal(resolveLocalFileHref("/repo/report:final", "/repo"), "/repo/report:final");
});
