import assert from "node:assert/strict";
import { test } from "node:test";
import { groupLinks, normalizeUrl } from "./links.ts";

test("normalizeUrl defaults a missing scheme to https", () => {
  assert.equal(normalizeUrl("github.com/agegr/pi-web"), "https://github.com/agegr/pi-web");
  assert.equal(normalizeUrl("  example.com  "), "https://example.com/");
});

test("normalizeUrl keeps http, https, and mailto", () => {
  assert.equal(normalizeUrl("http://localhost:3000/x"), "http://localhost:3000/x");
  assert.equal(normalizeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(normalizeUrl("mailto:someone@example.com"), "mailto:someone@example.com");
});

test("normalizeUrl rejects schemes that execute in an href", () => {
  assert.throws(() => normalizeUrl("javascript:alert(1)"), /Unsupported URL scheme/);
  assert.throws(() => normalizeUrl("JavaScript:alert(1)"), /Unsupported URL scheme/);
  assert.throws(() => normalizeUrl("data:text/html,<script>"), /Unsupported URL scheme/);
  assert.throws(() => normalizeUrl("file:///etc/passwd"), /Unsupported URL scheme/);
  assert.throws(() => normalizeUrl("   "), /empty/);
});

test("groupLinks buckets by group and preserves first-seen order", () => {
  const link = (id, group) => ({ id, title: id, url: "https://x", createdAt: "", ...(group ? { group } : {}) });
  const grouped = groupLinks([link("a", "Apps"), link("b", "Reading"), link("c", "Apps"), link("d")]);
  assert.deepEqual(
    grouped.map((g) => [g.group, g.links.map((l) => l.id)]),
    [["Apps", ["a", "c"]], ["Reading", ["b"]], ["Other", ["d"]]],
  );
});
