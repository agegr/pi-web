import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
test("mutable text, metadata, media/download and DOCX responses cannot be stored", () => {
  assert.equal((source.match(/"Cache-Control": "private, no-store, max-age=0"/g) ?? []).length, 4);
  const stream = source.slice(source.indexOf("function streamFile"), source.indexOf("function escapeHtml"));
  assert.match(stream, /"Cache-Control": "private, no-store, max-age=0"/);
  for (const type of ["read", "meta", "preview"]) {
    const start = source.indexOf(`if (type === "${type}")`);
    const next = source.indexOf('\n    if (type === ', start + 1);
    assert.match(source.slice(start, next), /"Cache-Control": "private, no-store, max-age=0"/, type);
  }
  assert.match(source, /"Cache-Control": "no-cache, no-transform"/, "SSE headers stay unchanged");
});
