import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getWebUrlLabel, normalizeWebUrl } = await createJiti(import.meta.url).import("./web-url.ts");

test("normalizes a bare web host to HTTPS", () => {
  assert.equal(normalizeWebUrl("www.google.com"), "https://www.google.com/");
  assert.equal(normalizeWebUrl("  example.com/docs?q=1  "), "https://example.com/docs?q=1");
});

test("keeps HTTP(S) URLs and rejects unsafe or malformed schemes", () => {
  assert.equal(normalizeWebUrl("http://localhost:3000"), "http://localhost:3000/");
  assert.equal(normalizeWebUrl("javascript:alert(1)"), null);
  assert.equal(normalizeWebUrl("file:///etc/passwd"), null);
  assert.equal(normalizeWebUrl("not a valid address"), null);
});

test("uses a compact host label for web tabs", () => {
  assert.equal(getWebUrlLabel("https://www.google.com/search?q=pi"), "google.com");
});
