import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENT_COLOR_KEYS, eventColorKey, googleColorKey, titleColorKey } from "./eventColors.ts";

test("google standard colours map to palette keys", () => {
  assert.equal(googleColorKey("1"), "slate"); // lavender
  assert.equal(googleColorKey("2"), "sage");
  assert.equal(googleColorKey("3"), "plum"); // grape
  assert.equal(googleColorKey("5"), "honey"); // banana
  assert.equal(googleColorKey("6"), "clay"); // tangerine
  assert.equal(googleColorKey("7"), "teal"); // peacock
  assert.equal(googleColorKey("11"), "clay"); // tomato
});

test("custom or absent google colours do not map", () => {
  assert.equal(googleColorKey(undefined), null);
  assert.equal(googleColorKey("custom-id"), null);
  assert.equal(googleColorKey("12"), null);
});

test("title hash is deterministic and in-palette", () => {
  const a = titleColorKey("Design review");
  const b = titleColorKey("Design review");
  assert.equal(a, b);
  assert.ok(EVENT_COLOR_KEYS.includes(a));
});

test("eventColorKey prefers a valid stored key, else hashes the title", () => {
  assert.equal(eventColorKey({ colorKey: "clay", title: "x" }), "clay");
  assert.equal(eventColorKey({ colorKey: "not-a-key", title: "x" }), titleColorKey("x"));
  assert.equal(eventColorKey({ title: "y" }), titleColorKey("y"));
});
