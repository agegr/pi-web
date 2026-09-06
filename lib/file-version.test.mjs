import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  createFileVersion,
  fileVersionHeaders,
  matchesIfModifiedSince,
  matchesIfNoneMatch,
} = await jiti.import("./file-version.ts");

function stat(overrides = {}) {
  return {
    size: 12,
    mtimeMs: 1_700_000_000_123,
    ctimeMs: 1_700_000_000_456,
    ino: 42,
    mtime: new Date("2023-11-14T22:13:20.123Z"),
    ...overrides,
  };
}

test("file versions are stable and change with every identity field", () => {
  const base = createFileVersion(stat());
  assert.equal(createFileVersion(stat()).etag, base.etag);
  for (const changed of [
    stat({ size: 13 }),
    stat({ mtimeMs: 1_700_000_000_124 }),
    stat({ ctimeMs: 1_700_000_000_457 }),
    stat({ ino: 43 }),
  ]) {
    assert.notEqual(createFileVersion(changed).etag, base.etag);
  }
  assert.doesNotMatch(base.etag, /home|session|content/i);
});

test("missing and zero-byte files have distinct serializable versions", () => {
  const missing = createFileVersion();
  const empty = createFileVersion(stat({ size: 0 }));
  assert.equal(missing.exists, false);
  assert.equal(missing.lastModified, null);
  assert.equal(empty.exists, true);
  assert.notEqual(missing.etag, empty.etag);
});

test("If-None-Match accepts strong, weak, list, and wildcard validators", () => {
  const { etag } = createFileVersion(stat());
  assert.equal(matchesIfNoneMatch(etag, etag), true);
  assert.equal(matchesIfNoneMatch(`W/${etag}`, etag), true);
  assert.equal(matchesIfNoneMatch(`"other", ${etag}`, etag), true);
  assert.equal(matchesIfNoneMatch("*", etag), true);
  assert.equal(matchesIfNoneMatch('"other"', etag), false);
  assert.equal(matchesIfNoneMatch(null, etag), false);
});

test("If-Modified-Since accepts current or newer validators only", () => {
  const lastModified = "Tue, 14 Nov 2023 22:13:20 GMT";
  assert.equal(matchesIfModifiedSince(lastModified, lastModified), true);
  assert.equal(matchesIfModifiedSince("Tue, 14 Nov 2023 22:13:21 GMT", lastModified), true);
  assert.equal(matchesIfModifiedSince("Tue, 14 Nov 2023 22:13:19 GMT", lastModified), false);
  assert.equal(matchesIfModifiedSince("invalid", lastModified), false);
  assert.equal(matchesIfModifiedSince(null, lastModified), false);
  assert.equal(matchesIfModifiedSince(lastModified, null), false);
});

test("version headers are private validators without path data", () => {
  const version = createFileVersion(stat());
  const headers = fileVersionHeaders(version);
  assert.equal(headers.get("etag"), version.etag);
  assert.equal(headers.get("cache-control"), "private, no-cache");
  assert.equal(headers.get("last-modified"), "Tue, 14 Nov 2023 22:13:20 GMT");
});
