import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("../bin/max-body-size.mjs");
}

test("defaults to 128 MB when the env var is unset or blank", async () => {
  const { resolveMaxBodySize, DEFAULT_MAX_BODY_SIZE_BYTES } = await loadSubject();
  assert.equal(resolveMaxBodySize(undefined), DEFAULT_MAX_BODY_SIZE_BYTES);
  assert.equal(resolveMaxBodySize(""), DEFAULT_MAX_BODY_SIZE_BYTES);
  assert.equal(resolveMaxBodySize("   "), DEFAULT_MAX_BODY_SIZE_BYTES);
});

test("parses human-readable sizes and raw byte counts", async () => {
  const { parseMaxBodySize } = await loadSubject();
  assert.equal(parseMaxBodySize("128mb"), 128 * 1024 * 1024);
  assert.equal(parseMaxBodySize("128MB"), 128 * 1024 * 1024);
  assert.equal(parseMaxBodySize("1gb"), 1024 * 1024 * 1024);
  assert.equal(parseMaxBodySize("512kb"), 512 * 1024);
  assert.equal(parseMaxBodySize("2048"), 2048);
  assert.equal(parseMaxBodySize("1.5mb"), Math.round(1.5 * 1024 * 1024));
});

test("falls back to the default for malformed or out-of-range values", async () => {
  const { resolveMaxBodySize, DEFAULT_MAX_BODY_SIZE_BYTES } = await loadSubject();
  for (const value of ["abc", "-1", "12xb", "0", "1.2.3mb", "mb", "1mb extra"]) {
    assert.equal(resolveMaxBodySize(value), DEFAULT_MAX_BODY_SIZE_BYTES);
  }
});
