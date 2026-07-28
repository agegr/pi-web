import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { scanFilePaths } = await jiti.import("./file-path-scan.ts");

function paths(text) {
  return scanFilePaths(text).map((match) => match.path);
}

test("finds a unix absolute path", () => {
  assert.deepEqual(paths("Generated /Users/me/out/report.html for you"), [
    "/Users/me/out/report.html",
  ]);
});

test("does not match windows drive-letter paths", () => {
  assert.deepEqual(paths("see C:/Users/me/a.html"), []);
  assert.deepEqual(paths("see C:\\Users\\me\\a.md"), []);
});

test("ignores paths without a previewable extension", () => {
  assert.deepEqual(paths("installed to /usr/bin and /opt/local"), []);
  assert.deepEqual(paths("wrote /tmp/data.xyz"), []);
});

test("ignores extensionless binary paths", () => {
  assert.deepEqual(paths("run /bin/bash or /usr/bin/env python"), []);
  assert.deepEqual(paths("installed at /opt/homebrew/bin/go"), []);
});

test("ignores special-name files without an extension", () => {
  assert.deepEqual(paths("edit /repo/Makefile please"), []);
  assert.deepEqual(paths("see /repo/Dockerfile"), []);
});

test("requires the dot in the basename, not a parent directory", () => {
  assert.deepEqual(paths("see /etc/conf.d/bash and /opt/py.d/go"), []);
  assert.deepEqual(paths("at /home/a.b/c"), []);
});

test("ignores non-path slash usage", () => {
  assert.deepEqual(paths("and/or, n/a, 24/7"), []);
});

test("strips trailing ascii punctuation", () => {
  assert.deepEqual(paths("see /tmp/a.html."), ["/tmp/a.html"]);
  assert.deepEqual(paths("see (/tmp/a.html)"), ["/tmp/a.html"]);
});

test("strips trailing chinese punctuation", () => {
  assert.deepEqual(paths("已生成：/tmp/a.html。"), ["/tmp/a.html"]);
  assert.deepEqual(paths("文件在 /tmp/a.md，请查看"), ["/tmp/a.md"]);
});

test("strips simplified chinese quotation marks", () => {
  assert.deepEqual(paths('已生成“/tmp/out/report.html”，请查看'), ["/tmp/out/report.html"]);
  assert.deepEqual(paths("见‘/tmp/a.md’"), ["/tmp/a.md"]);
});

test("finds several paths separated by chinese punctuation", () => {
  assert.deepEqual(
    paths("已生成报告：/tmp/out/report.html，另见 /tmp/out/data.json。"),
    ["/tmp/out/report.html", "/tmp/out/data.json"],
  );
});

test("keeps line and column suffixes", () => {
  assert.deepEqual(paths("at /tmp/a.ts:42"), ["/tmp/a.ts:42"]);
  assert.deepEqual(paths("at /tmp/a.ts:42:8"), ["/tmp/a.ts:42:8"]);
  assert.deepEqual(paths("at /tmp/a.ts:42."), ["/tmp/a.ts:42"]);
});

test("finds several paths on one line", () => {
  assert.deepEqual(paths("wrote /tmp/a.html and /tmp/b.md"), [
    "/tmp/a.html",
    "/tmp/b.md",
  ]);
});

test("ignores urls and protocol-relative paths", () => {
  assert.deepEqual(paths("see https://example.com/a.html"), []);
  assert.deepEqual(paths("see //example.com/a.html"), []);
});

test("ignores a path glued to a preceding word", () => {
  assert.deepEqual(paths("see/tmp/a.html"), []);
});

test("reports offsets that slice back to the path", () => {
  const text = "已生成：/tmp/a.html。";
  const [match] = scanFilePaths(text);
  assert.equal(text.slice(match.start, match.end), "/tmp/a.html");
});

test("returns an empty array when nothing matches", () => {
  assert.deepEqual(scanFilePaths(""), []);
  assert.deepEqual(scanFilePaths("no paths here"), []);
});
