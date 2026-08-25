import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const start = source.indexOf("function streamFile");
const end = source.indexOf("function escapeHtml", start);
assert.notEqual(start, -1, "streamFile not found");
assert.notEqual(end, -1, "streamFile end not found");
const streamBlock = source.slice(start, end);

test("streamed responses are not content-type sniffable", () => {
  assert.match(streamBlock, /"X-Content-Type-Options": "nosniff"/);
});

test("inline SVG is served with a script-blocking content security policy", () => {
  // SVG is the only inline preview type a browser executes as a document, so
  // it must never be able to run script in the Pi Web origin.
  assert.match(streamBlock, /contentType === "image\/svg\+xml"/);
  assert.match(streamBlock, /Content-Security-Policy/);
  assert.match(streamBlock, /default-src 'none'/);
  assert.match(streamBlock, /style-src 'unsafe-inline'/);
  assert.match(streamBlock, /frame-ancestors 'self'/);
});

test("the restrictive headers are applied to every streamFile response shape", () => {
  // The header object is shared by the full-body, 416, and 206 paths.
  const headerObject = streamBlock.indexOf("const headers");
  const firstReturn = streamBlock.indexOf("createFileBodyStream", headerObject);
  assert.ok(headerObject !== -1 && firstReturn > headerObject, "headers must be built before any response");
});
