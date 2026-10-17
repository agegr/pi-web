import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  TITLE_THINKING_LEVELS,
  preferenceWithLevel,
  preferenceWithModel,
  titleMenuEntries,
  titleModelOf,
} = await jiti.import("./title-menu.ts");

const cheap = { provider: "cheap", modelId: "small", name: "Small", levels: ["off", "low"] };
const big = { provider: "big", modelId: "large", name: "Large", levels: ["minimal", "high"] };

const levelsOf = (entries) => entries.filter((entry) => entry.kind === "level").map((entry) => entry.level);
const checked = (entries, kind) => entries.filter((entry) => entry.kind === kind && entry.checked).length;

test("no choice yet follows the session's own model at its cheapest level", () => {
  const entries = titleMenuEntries({ preference: null, models: [cheap, big], failed: false });

  assert.deepEqual(entries[0], { kind: "header", id: "model" });
  assert.equal(checked(entries, "session-model"), 1);
  assert.equal(checked(entries, "model"), 0);
  // The session's own model is not part of this menu, so every level is offered.
  assert.deepEqual(levelsOf(entries), [null, ...TITLE_THINKING_LEVELS]);
  assert.equal(checked(entries, "level"), 1);
});

test("a chosen model is marked, and offers only the levels it supports", () => {
  const entries = titleMenuEntries({
    preference: { provider: "cheap", modelId: "small", thinkingLevel: "low" },
    models: [cheap, big],
    failed: false,
  });

  assert.equal(checked(entries, "session-model"), 0);
  assert.deepEqual(
    entries.filter((entry) => entry.kind === "model").map((entry) => [entry.name, entry.checked]),
    [["Small", true], ["Large", false]],
  );
  assert.deepEqual(levelsOf(entries), [null, "off", "low"]);
  // "A level survives clearing the model" is what keeps this row's check meaningful.
  assert.deepEqual(entries.filter((entry) => entry.kind === "level" && entry.checked), [{ kind: "level", level: "low", checked: true }]);
});

test("a level on its own still names with the session's own model", () => {
  const entries = titleMenuEntries({ preference: { thinkingLevel: "high" }, models: [cheap], failed: false });

  assert.equal(checked(entries, "session-model"), 1);
  assert.deepEqual(levelsOf(entries), [null, ...TITLE_THINKING_LEVELS]);
  // The "cheapest level" row is not the chosen one; the level itself is.
  assert.deepEqual(entries.filter((entry) => entry.kind === "level" && entry.checked), [{ kind: "level", level: "high", checked: true }]);
});

test("a model list that could not be read says so instead of showing none", () => {
  const failed = titleMenuEntries({ preference: null, models: null, failed: true });
  assert.equal(failed.filter((entry) => entry.kind === "header").some((entry) => entry.id === "unavailable"), true);
  const loading = titleMenuEntries({ preference: null, models: null, failed: false });
  assert.equal(loading.some((entry) => entry.kind === "header" && entry.id === "unavailable"), false);
});

test("each choice keeps the other half of the preference", () => {
  assert.deepEqual(preferenceWithModel({ thinkingLevel: "high" }, cheap), {
    provider: "cheap",
    modelId: "small",
    thinkingLevel: "high",
  });
  assert.deepEqual(preferenceWithModel({ provider: "cheap", modelId: "small" }, null), null);
  assert.deepEqual(preferenceWithModel({ provider: "cheap", modelId: "small", thinkingLevel: "high" }, null), {
    thinkingLevel: "high",
  });

  assert.deepEqual(preferenceWithLevel({ provider: "cheap", modelId: "small" }, "max"), {
    provider: "cheap",
    modelId: "small",
    thinkingLevel: "max",
  });
  assert.deepEqual(preferenceWithLevel({ provider: "cheap", modelId: "small", thinkingLevel: "max" }, null), {
    provider: "cheap",
    modelId: "small",
  });
  assert.equal(preferenceWithLevel({ thinkingLevel: "max" }, null), null);
  assert.equal(preferenceWithLevel(null, null), null);

  // A half model is no model, whichever side of the menu it arrives on.
  assert.equal(titleModelOf({ provider: "cheap" }), null);
  assert.deepEqual(titleModelOf({ provider: "cheap", modelId: "small", thinkingLevel: "high" }), {
    provider: "cheap",
    modelId: "small",
  });
});
