import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  getPreferredThinkingLevel,
  setPreferredThinkingLevel,
  resolveThinkingPreference,
} = await createJiti(import.meta.url).import("./thinking-level-preference.ts");

test("explicit high and auto persist immediately without creating a session", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(getPreferredThinkingLevel(storage), null);
  for (const level of ["high", "auto", "off", "max"]) {
    setPreferredThinkingLevel(level, storage);
    assert.equal(getPreferredThinkingLevel(storage), level);
  }
  values.set("pi-thinking-level", "invalid");
  assert.equal(getPreferredThinkingLevel(storage), null);
});

test("unavailable storage remains safe", () => {
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };

  assert.equal(getPreferredThinkingLevel(blocked), null);
  assert.equal(getPreferredThinkingLevel(null), null);
  assert.doesNotThrow(() => setPreferredThinkingLevel("high", blocked));
  assert.doesNotThrow(() => setPreferredThinkingLevel("high", null));
});

test("new sessions respect explicit choices, scope pins and remembered levels", () => {
  const base = { explicit: null, preferred: "high", supported: ["off", "low", "medium", "high"] };
  assert.deepEqual(resolveThinkingPreference(base), { level: "high", override: "high" });
  assert.deepEqual(resolveThinkingPreference({ ...base, pinned: "low" }), { level: "low", override: null });
  assert.deepEqual(resolveThinkingPreference({ ...base, pinned: "low", explicit: "high" }), { level: "high", override: "high" });
  assert.deepEqual(resolveThinkingPreference({ ...base, pinned: "low", explicit: "auto" }), { level: "auto", override: null });
  assert.deepEqual(resolveThinkingPreference({ ...base, preferred: "auto", pinned: "low" }), { level: "low", override: null });
});

test("unsupported memory falls back without destroying the original preference", () => {
  const base = { explicit: null, preferred: "high" };
  assert.deepEqual(resolveThinkingPreference({ ...base, supported: ["off"] }), { level: "auto", override: null });
  assert.deepEqual(resolveThinkingPreference({ ...base, supported: ["low"] }), { level: "auto", override: null });
  assert.deepEqual(resolveThinkingPreference({ ...base, supported: ["high"] }), { level: "high", override: "high" });
});
