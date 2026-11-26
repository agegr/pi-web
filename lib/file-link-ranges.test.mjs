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

test("a line suffix names the lines the link points at", async () => {
  const { resolveLocalFileLink } = await import("./file-links.ts");
  const lines = (href, base = "/repo") => resolveLocalFileLink(href, base)?.target?.lines;

  assert.deepEqual(lines("src/app.ts:42"), { start: 42, end: 42 });
  // A column is a place inside the line.
  assert.deepEqual(lines("/repo/app.ts:42:7"), { start: 42, end: 42 });
  assert.deepEqual(lines("src/app.ts:10-20"), { start: 10, end: 20 });
  // A range written backwards is its first line.
  assert.deepEqual(lines("src/app.ts:20-10"), { start: 20, end: 20 });
  assert.deepEqual(lines("app.ts:42"), { start: 42, end: 42 });
  assert.deepEqual(lines("C:/repo/app.ts:12-18", "C:/repo"), { start: 12, end: 18 });
  assert.deepEqual(lines("file:///repo/app.ts:5"), { start: 5, end: 5 });
  // No line to go to: the path still opens.
  assert.deepEqual(resolveLocalFileLink("src/app.ts:0", "/repo"), { path: "/repo/src/app.ts", target: undefined });
  assert.deepEqual(resolveLocalFileLink("src/app.ts", "/repo"), { path: "/repo/src/app.ts", target: undefined });
  assert.deepEqual(resolveLocalFileLink("/repo/report:final", "/repo"), { path: "/repo/report:final", target: undefined });
});

test("a PDF link keeps its page beside the path", async () => {
  const { resolveLocalFileLink } = await import("./file-links.ts");
  assert.deepEqual(resolveLocalFileLink("docs/report.pdf#page=12", "/repo"), {
    path: "/repo/docs/report.pdf",
    target: { page: 12, lines: undefined },
  });
});
